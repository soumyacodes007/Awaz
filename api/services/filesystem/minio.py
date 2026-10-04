import asyncio
import io
from datetime import timedelta
from typing import Any, Dict, Optional
from urllib.parse import urlsplit

from loguru import logger
from minio import Minio
from minio.error import S3Error

from .base import AsyncReadable, BaseFileSystem


class MinioFileSystem(BaseFileSystem):
    """MinIO implementation of the filesystem interface for OSS users.

    Two endpoints, two different purposes:
    - endpoint (host:port) + secure (bool): used by the MinIO SDK for
      container-to-container calls. The SDK requires these split.
    - public_endpoint (full URL, e.g. "https://example.com"): used verbatim
      when building URLs that browsers will fetch. Required.
    """

    def __init__(
        self,
        endpoint: str = "localhost:9000",
        access_key: str = "minioadmin",
        secret_key: str = "minioadmin",
        bucket_name: str = "voice-audio",
        secure: bool = False,
        public_endpoint: Optional[str] = None,
        initialize_bucket: bool = False,
    ):
        if not public_endpoint:
            raise ValueError(
                "MinioFileSystem requires public_endpoint (set MINIO_PUBLIC_ENDPOINT). "
                "Expected a full URL with scheme, e.g. 'http://localhost:9000' or 'https://example.com'."
            )
        if not (
            public_endpoint.startswith("http://")
            or public_endpoint.startswith("https://")
        ):
            raise ValueError(
                f"MINIO_PUBLIC_ENDPOINT must include a scheme (http:// or https://), got: {public_endpoint!r}"
            )

        self.bucket_name = bucket_name
        self.endpoint = endpoint
        self.public_endpoint = public_endpoint.rstrip("/")
        self.secure = secure
        self.access_key = access_key
        self.secret_key = secret_key
        public_url = urlsplit(self.public_endpoint)
        if (
            public_url.path
            or public_url.query
            or public_url.fragment
            or public_url.username
        ):
            raise ValueError(
                "MinIO public_endpoint must be an origin without a path or credentials"
            )

        # Client for internal operations (uploads, etc.)
        self.client = Minio(
            endpoint,
            access_key=access_key,
            secret_key=secret_key,
            secure=secure,
            region="us-east-1",
        )
        self.public_client = Minio(
            public_url.netloc,
            access_key=access_key,
            secret_key=secret_key,
            secure=public_url.scheme == "https",
            region="us-east-1",
        )

        # Initialize once at process startup. Request-time clients only sign URLs.
        if initialize_bucket:
            if not self.client.bucket_exists(self.bucket_name):
                try:
                    self.client.make_bucket(self.bucket_name)
                except S3Error as exc:
                    # Another API worker may have created it after our check.
                    if exc.code != "BucketAlreadyOwnedByYou":
                        raise
            # Remove the legacy anonymous read/write/list/delete policy. Fail
            # startup if privacy cannot be enforced, rather than exposing calls.
            self.client.delete_bucket_policy(self.bucket_name)

    async def acreate_file(self, file_path: str, content: AsyncReadable) -> bool:
        try:
            data = await content.read()

            def _put():
                # The MinIO SDK requires a stream with .read(), not raw bytes.
                self.client.put_object(
                    self.bucket_name,
                    file_path,
                    data=io.BytesIO(data),
                    length=len(data),
                )

            await asyncio.to_thread(_put)
            return True
        except S3Error:
            return False

    async def aupload_file(self, local_path: str, destination_path: str) -> bool:
        try:

            def _fput():
                self.client.fput_object(self.bucket_name, destination_path, local_path)

            await asyncio.to_thread(_fput)
            return True
        except S3Error:
            return False

    async def aget_signed_url(
        self,
        file_path: str,
        expiration: int = 3600,
        force_inline: bool = False,
        use_internal_endpoint: bool = False,
    ) -> Optional[str]:
        try:
            client = self.client if use_internal_endpoint else self.public_client
            response_headers = None
            if force_inline:
                content_type = (
                    "text/plain"
                    if file_path.endswith(".txt")
                    else "audio/wav"
                    if file_path.endswith(".wav")
                    else "audio/mpeg"
                    if file_path.endswith(".mp3")
                    else "application/octet-stream"
                )
                response_headers = {
                    "response-content-disposition": "inline",
                    "response-content-type": content_type,
                }
            return await asyncio.to_thread(
                client.presigned_get_object,
                self.bucket_name,
                file_path,
                expires=timedelta(seconds=expiration),
                response_headers=response_headers,
            )
        except Exception as e:
            logger.error(f"Error generating MinIO URL: {e}")
            return None

    async def aget_file_metadata(self, file_path: str) -> Optional[Dict[str, Any]]:
        """Get MinIO object metadata."""
        try:

            def _stat():
                return self.client.stat_object(self.bucket_name, file_path)

            stat = await asyncio.to_thread(_stat)
            return {
                "size": stat.size,
                "created_at": stat.last_modified,
                "modified_at": stat.last_modified,
                "etag": stat.etag.strip('"') if stat.etag else None,
                "content_type": stat.content_type,
                "storage_class": None,  # MinIO doesn't have storage classes like S3
            }
        except S3Error:
            return None

    async def aget_presigned_put_url(
        self,
        file_path: str,
        expiration: int = 900,
        content_type: str = "text/csv",
        max_size: int = 10_485_760,
    ) -> Optional[str]:
        """Sign direct uploads for the browser-visible host without rewriting URLs."""
        try:
            return await asyncio.to_thread(
                self.public_client.presigned_put_object,
                self.bucket_name,
                file_path,
                expires=timedelta(seconds=expiration),
            )
        except Exception as e:
            logger.error(f"Error generating MinIO upload URL: {e}")
            return None

    async def adownload_file(self, source_path: str, local_path: str) -> bool:
        """Download a file from MinIO to local path."""
        try:

            def _fget():
                self.client.fget_object(self.bucket_name, source_path, local_path)

            await asyncio.to_thread(_fget)
            return True
        except S3Error:
            return False

    async def acopy_file(self, source_path: str, destination_path: str) -> bool:
        """Copy a file within MinIO (server-side copy)."""
        try:
            from minio.commonconfig import CopySource

            def _copy():
                self.client.copy_object(
                    self.bucket_name,
                    destination_path,
                    CopySource(self.bucket_name, source_path),
                )

            await asyncio.to_thread(_copy)
            return True
        except S3Error:
            return False
