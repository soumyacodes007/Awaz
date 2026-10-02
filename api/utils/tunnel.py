"""Utility for getting the cloudflared tunnel URL at runtime."""

import asyncio
import re
import time
from typing import Optional

import aiohttp
from loguru import logger

# How long a lookup result stays valid. The negative TTL matters most: when the
# cloudflared service isn't running (tunnel profile disabled), every probe costs
# a full connect timeout, and /health calls this on every request. Without a
# cache that stalls the endpoint past the UI's health-check budget.
_TUNNEL_CACHE_TTL_SECONDS = 60.0
_TUNNEL_NEGATIVE_CACHE_TTL_SECONDS = 60.0

# Connect/read budget for the metrics probe. Kept below the UI's health-check
# timeout so a cold lookup still returns in time.
_TUNNEL_PROBE_TIMEOUT_SECONDS = 2.0


class TunnelURLProvider:
    """Provider for getting tunnel URLs from cloudflared service."""

    # (urls, expires_at) — urls is None when the last probe found no tunnel.
    _cached: Optional[tuple[Optional[tuple[str, str]], float]] = None
    _lock: Optional[asyncio.Lock] = None

    @classmethod
    def _get_lock(cls) -> asyncio.Lock:
        # Created lazily so the lock binds to the running loop, not import time.
        if cls._lock is None:
            cls._lock = asyncio.Lock()
        return cls._lock

    @classmethod
    def reset_cache(cls) -> None:
        """Drop the cached lookup so the next call re-probes cloudflared."""
        cls._cached = None

    @classmethod
    async def get_tunnel_urls(cls) -> tuple[str, str]:
        """
        Get the tunnel URLs for external access.

        The lookup is cached (including the "no tunnel running" outcome) so a
        missing cloudflared service costs one probe per TTL instead of one per
        caller.

        Returns:
            tuple[str, str]: (https_url, wss_url) - Both URLs include full protocol

        Raises:
            ValueError: If no tunnel URL can be determined
        """

        urls = await cls._get_cached_urls()
        if urls:
            return urls

        raise ValueError(
            "No tunnel URL available. Please set BACKEND_API_ENDPOINT environment "
            "variable or ensure cloudflared service is running."
        )

    @classmethod
    async def _get_cached_urls(cls) -> Optional[tuple[str, str]]:
        """Return the cached lookup, probing cloudflared when it has expired."""
        cached = cls._cached
        if cached is not None and time.monotonic() < cached[1]:
            return cached[0]

        async with cls._get_lock():
            # Another caller may have refreshed while we waited for the lock.
            cached = cls._cached
            if cached is not None and time.monotonic() < cached[1]:
                return cached[0]

            try:
                urls = await cls._get_cloudflared_urls()
            except Exception as e:
                logger.warning(f"Failed to get tunnel URL from cloudflared: {e}")
                urls = None

            ttl = (
                _TUNNEL_CACHE_TTL_SECONDS
                if urls
                else _TUNNEL_NEGATIVE_CACHE_TTL_SECONDS
            )
            cls._cached = (urls, time.monotonic() + ttl)
            return urls

    @classmethod
    async def _get_cloudflared_urls(cls) -> Optional[tuple[str, str]]:
        """
        Query cloudflared metrics endpoint to get the tunnel URLs.

        Returns:
            Optional[tuple[str, str]]: (https_url, wss_url) with full protocols, or None if not found
        """
        try:
            # Try to connect to cloudflared metrics endpoint
            # The service name in docker-compose is 'cloudflared'
            metrics_url = "http://cloudflared:2000/metrics"

            async with aiohttp.ClientSession() as session:
                async with session.get(
                    metrics_url,
                    timeout=aiohttp.ClientTimeout(
                        total=_TUNNEL_PROBE_TIMEOUT_SECONDS
                    ),
                ) as response:
                    if response.status != 200:
                        logger.warning(
                            f"Cloudflared metrics returned status {response.status}"
                        )
                        return None

                    text = await response.text()

                    # Look for the tunnel URL in metrics
                    # Cloudflared exposes this in the userHostname metric
                    match = re.search(r'userHostname="([^"]+)"', text)
                    if match:
                        hostname = match.group(1)
                        # Remove https:// or wss:// if present
                        hostname = hostname.replace("https://", "").replace(
                            "wss://", ""
                        )
                        return "https://" + hostname, "wss://" + hostname

                    # Alternative: Look for trycloudflare.com domain
                    match = re.search(r"([a-z0-9-]+\.trycloudflare\.com)", text)
                    if match:
                        hostname = match.group(1)
                        hostname = hostname.replace("https://", "").replace(
                            "wss://", ""
                        )
                        return f"https://{hostname}", f"wss://{hostname}"

                    logger.warning("Could not find tunnel URL in cloudflared metrics")
                    return None

        except asyncio.TimeoutError:
            logger.warning("Timeout connecting to cloudflared metrics endpoint")
            return None
        except aiohttp.ClientError as e:
            logger.warning(f"Error connecting to cloudflared: {e}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error getting cloudflared URL: {e}")
            return None
