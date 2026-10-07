"""HubSpot CRM: the org connection (private-app token or OAuth) and contact reads.

The connection lives in organization_configurations under HUBSPOT_CONNECTION:
    {auth_type: "token" | "oauth", access_token, refresh_token?, expires_at?,
     portal_id, ui_domain, time_zone, connected_at}

OAuth needs a HubSpot public app. Set on the server:
    HUBSPOT_CLIENT_ID, HUBSPOT_CLIENT_SECRET,
    HUBSPOT_REDIRECT_URI   e.g. http://localhost:3000/api/v1/crm/hubspot/oauth/callback
    HUBSPOT_SCOPES         default "oauth crm.objects.contacts.read crm.lists.read"
                           (must match the app's requiredScopes exactly)
"""

from __future__ import annotations

import asyncio
import os
import re
from datetime import UTC, datetime, timedelta
from typing import Any, AsyncIterator

import httpx

from api.db import db_client

CONFIG_KEY = "HUBSPOT_CONNECTION"
API = "https://api.hubapi.com"
CONTACT_PAGE = 100
DEFAULT_PROPERTIES = ["firstname", "lastname", "email", "company"]
PHONE_PROPERTIES = [
    "phone",
    "mobilephone",
    "hs_calculated_phone_number",
    "hs_whatsapp_phone_number",
]


class HubSpotError(RuntimeError):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


# ── OAuth app config ────────────────────────────────────────────────────


def oauth_settings() -> dict | None:
    client_id = os.getenv("HUBSPOT_CLIENT_ID")
    secret = os.getenv("HUBSPOT_CLIENT_SECRET")
    redirect = os.getenv("HUBSPOT_REDIRECT_URI")
    if not (client_id and secret and redirect):
        return None
    return {
        "client_id": client_id,
        "client_secret": secret,
        "redirect_uri": redirect,
        "scopes": os.getenv("HUBSPOT_SCOPES")
        or "oauth crm.objects.contacts.read crm.lists.read",
    }


# ── Connection storage ──────────────────────────────────────────────────


async def get_connection(organization_id: int) -> dict | None:
    value = await db_client.get_configuration_value(organization_id, CONFIG_KEY)
    return value if isinstance(value, dict) and value.get("access_token") else None


async def save_connection(organization_id: int, connection: dict) -> dict:
    await db_client.upsert_configuration(organization_id, CONFIG_KEY, connection)
    return connection


async def delete_connection(organization_id: int) -> None:
    await db_client.delete_configuration(organization_id, CONFIG_KEY)


def public_status(connection: dict | None) -> dict:
    token = (connection or {}).get("access_token") or ""
    return {
        "connected": bool(connection),
        "auth_type": (connection or {}).get("auth_type"),
        "portal_id": (connection or {}).get("portal_id"),
        "ui_domain": (connection or {}).get("ui_domain"),
        "time_zone": (connection or {}).get("time_zone"),
        "connected_at": (connection or {}).get("connected_at"),
        "token_hint": f"…{token[-4:]}"
        if token and connection.get("auth_type") == "token"
        else None,
        "oauth_available": oauth_settings() is not None,
    }


# ── HTTP ────────────────────────────────────────────────────────────────


async def _refresh(organization_id: int, connection: dict) -> dict:
    settings = oauth_settings()
    if not settings or not connection.get("refresh_token"):
        raise HubSpotError("The HubSpot connection expired. Connect again.", 401)
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.post(
            f"{API}/oauth/v1/token",
            data={
                "grant_type": "refresh_token",
                "client_id": settings["client_id"],
                "client_secret": settings["client_secret"],
                "refresh_token": connection["refresh_token"],
            },
        )
    if res.status_code != 200:
        raise HubSpotError(
            "Couldn't refresh the HubSpot connection. Connect again.", 401
        )
    data = res.json()
    connection = {
        **connection,
        "access_token": data["access_token"],
        "refresh_token": data.get("refresh_token") or connection["refresh_token"],
        "expires_at": (
            datetime.now(UTC)
            + timedelta(seconds=int(data.get("expires_in", 1800)) - 60)
        ).isoformat(),
    }
    return await save_connection(organization_id, connection)


class HubSpot:
    """A HubSpot API client bound to one org's connection."""

    def __init__(self, organization_id: int, connection: dict):
        self.organization_id = organization_id
        self.connection = connection

    @classmethod
    async def for_org(cls, organization_id: int) -> "HubSpot":
        connection = await get_connection(organization_id)
        if not connection:
            raise HubSpotError("HubSpot isn't connected", 409)
        return cls(organization_id, connection)

    async def _token(self) -> str:
        expires = self.connection.get("expires_at")
        if (
            self.connection.get("auth_type") == "oauth"
            and expires
            and datetime.fromisoformat(expires) <= datetime.now(UTC)
        ):
            self.connection = await _refresh(self.organization_id, self.connection)
        return self.connection["access_token"]

    async def request(self, method: str, path: str, **kwargs) -> Any:
        async with httpx.AsyncClient(timeout=30) as client:
            for attempt in range(3):
                res = await client.request(
                    method,
                    f"{API}{path}",
                    headers={"Authorization": f"Bearer {await self._token()}"},
                    **kwargs,
                )
                if res.status_code == 429 and attempt < 2:
                    # HubSpot's burst limit; wait for the window to roll over.
                    await asyncio.sleep(float(res.headers.get("Retry-After", 1)))
                    continue
                if (
                    res.status_code == 401
                    and self.connection.get("auth_type") == "oauth"
                    and attempt == 0
                ):
                    self.connection = await _refresh(
                        self.organization_id, self.connection
                    )
                    continue
                break
        if res.status_code >= 400:
            raise HubSpotError(_message(res), res.status_code)
        return res.json() if res.content else {}

    # ── Reads ──

    async def account(self) -> dict:
        return await self.request("GET", "/account-info/v3/details")

    async def contact_lists(self, query: str = "") -> list[dict]:
        data = await self.request(
            "POST", "/crm/v3/lists/search", json={"query": query, "count": 100}
        )
        lists = []
        for item in data.get("lists") or []:
            if item.get("objectTypeId") not in (None, "0-1"):
                continue  # contact lists only
            size = (item.get("additionalProperties") or {}).get("hs_list_size")
            lists.append(
                {
                    "id": str(item.get("listId")),
                    "name": item.get("name") or f"List {item.get('listId')}",
                    "size": int(size) if size not in (None, "") else None,
                    "dynamic": item.get("processingType") == "DYNAMIC",
                }
            )
        return lists

    async def contact_properties(self) -> list[dict]:
        data = await self.request("GET", "/crm/v3/properties/contacts")
        props = [
            {
                "name": p["name"],
                "label": p.get("label") or p["name"],
                "type": p.get("type"),
                "field_type": p.get("fieldType"),
                "group": p.get("groupName"),
                "phone": p.get("fieldType") == "phonenumber"
                or p["name"] in PHONE_PROPERTIES,
            }
            for p in data.get("results") or []
            if not p.get("hidden")
        ]
        # Phone fields first, the common ones at the top; then everything by label.
        rank = {name: i for i, name in enumerate(PHONE_PROPERTIES)}
        return sorted(
            props,
            key=lambda p: (not p["phone"], rank.get(p["name"], 99), p["label"].lower()),
        )

    async def contacts(
        self, list_id: str | None, properties: list[str], limit: int
    ) -> AsyncIterator[dict]:
        """Contacts in a list (or every contact), with the given properties."""
        fetched = 0
        after = None
        if list_id:
            while fetched < limit:
                params = {"limit": min(250, limit - fetched)}
                if after:
                    params["after"] = after
                page = await self.request(
                    "GET", f"/crm/v3/lists/{list_id}/memberships", params=params
                )
                ids = [
                    str(r.get("recordId"))
                    for r in page.get("results") or []
                    if r.get("recordId")
                ]
                for start in range(0, len(ids), CONTACT_PAGE):
                    batch = await self.request(
                        "POST",
                        "/crm/v3/objects/contacts/batch/read",
                        json={
                            "properties": properties,
                            "inputs": [
                                {"id": i} for i in ids[start : start + CONTACT_PAGE]
                            ],
                        },
                    )
                    for contact in batch.get("results") or []:
                        fetched += 1
                        yield contact
                after = ((page.get("paging") or {}).get("next") or {}).get("after")
                if not after or not ids:
                    return
        else:
            while fetched < limit:
                params = {
                    "limit": min(CONTACT_PAGE, limit - fetched),
                    "properties": ",".join(properties),
                }
                if after:
                    params["after"] = after
                page = await self.request(
                    "GET", "/crm/v3/objects/contacts", params=params
                )
                for contact in page.get("results") or []:
                    fetched += 1
                    yield contact
                after = ((page.get("paging") or {}).get("next") or {}).get("after")
                if not after:
                    return


def _message(res: httpx.Response) -> str:
    try:
        data = res.json()
        msg = data.get("message") or data.get("error_description") or ""
    except Exception:
        msg = res.text[:200]
    if res.status_code == 401:
        return "HubSpot rejected the token. Check it, or connect again."
    if res.status_code == 403:
        return f"The HubSpot token is missing a scope for this ({msg[:160]})"
    return f"HubSpot error {res.status_code}: {msg[:200]}"


async def verify_token(token: str) -> dict:
    """Check a private-app token and return the connection to store."""
    probe = HubSpot(0, {"auth_type": "token", "access_token": token})
    account = await probe.account()
    # Reading contacts is the minimum a campaign needs.
    await probe.request("GET", "/crm/v3/objects/contacts", params={"limit": 1})
    return {
        "auth_type": "token",
        "access_token": token,
        "portal_id": account.get("portalId"),
        "ui_domain": account.get("uiDomain"),
        "time_zone": account.get("timeZone"),
        "connected_at": datetime.now(UTC).isoformat(),
    }


# ── Phone numbers ───────────────────────────────────────────────────────

_DIGITS = re.compile(r"[^\d+]")


def normalize_phone(raw: str | None, default_country_code: str = "+91") -> str | None:
    """Best-effort E.164: keep a leading +, drop punctuation, add the default
    country code to national numbers (and drop a trunk 0)."""
    if not raw:
        return None
    text = str(raw).strip()
    ext = re.split(r"(?i)\s*(?:ext\.?|x|#)\s*\d+$", text)[0]
    cleaned = _DIGITS.sub("", ext)
    if not cleaned:
        return None
    if cleaned.startswith("00"):
        cleaned = "+" + cleaned[2:]
    if not cleaned.startswith("+"):
        cc = "+" + default_country_code.lstrip("+") if default_country_code else ""
        cleaned = cleaned.lstrip("0")
        if cc and cleaned.startswith(cc[1:]) and len(cleaned) > 10:
            cleaned = "+" + cleaned  # already has the country code, just no +
        else:
            cleaned = cc + cleaned
    digits = cleaned[1:]
    if not digits.isdigit() or not 8 <= len(digits) <= 15:
        return None
    return cleaned


def contact_name(props: dict) -> str:
    name = " ".join(p for p in (props.get("firstname"), props.get("lastname")) if p)
    return name or props.get("email") or ""
