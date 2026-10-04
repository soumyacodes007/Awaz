"""MinIO signs browser URLs and enforces private storage at initialization."""

from unittest.mock import patch
from urllib.parse import parse_qs, urlsplit

import pytest
from minio.error import S3Error

from api.services.filesystem.minio import MinioFileSystem


def storage(**kwargs):
    return MinioFileSystem(
        endpoint="localhost:19000",
        access_key="logs-test-user",
        secret_key="logs-test-password",
        bucket_name="logs-test-artifacts",
        public_endpoint="https://audio.example.com:9443",
        **kwargs,
    )


async def test_public_and_internal_signatures_use_correct_hosts():
    fs = storage()
    public = await fs.aget_signed_url(
        "recordings/call with spaces.wav", expiration=300, force_inline=True
    )
    assert urlsplit(public).netloc == "audio.example.com:9443"
    query = parse_qs(urlsplit(public).query)
    assert query["X-Amz-Expires"] == ["300"]
    assert query["X-Amz-Signature"] and query["X-Amz-SignedHeaders"] == ["host"]
    assert query["response-content-type"] == ["audio/wav"]
    internal = await fs.aget_signed_url(
        "recordings/call.wav", use_internal_endpoint=True
    )
    assert urlsplit(internal).netloc == "localhost:19000"
    assert (
        parse_qs(urlsplit(internal).query)["X-Amz-Signature"]
        != query["X-Amz-Signature"]
    )
    put = await fs.aget_presigned_put_url("upload.csv", expiration=900)
    assert urlsplit(put).netloc == "audio.example.com:9443"
    assert parse_qs(urlsplit(put).query)["X-Amz-Expires"] == ["900"]


def test_request_time_clients_do_not_perform_bucket_network_calls():
    with patch("api.services.filesystem.minio.Minio") as client:
        storage()
    assert client.call_count == 2
    client.return_value.bucket_exists.assert_not_called()
    client.return_value.delete_bucket_policy.assert_not_called()


def test_startup_removes_legacy_anonymous_policy_and_fails_closed():
    with patch("api.services.filesystem.minio.Minio") as client:
        client.return_value.bucket_exists.return_value = True
        storage(initialize_bucket=True)
        client.return_value.delete_bucket_policy.assert_called_once_with(
            "logs-test-artifacts"
        )
        client.return_value.delete_bucket_policy.side_effect = RuntimeError("denied")
        with pytest.raises(RuntimeError, match="denied"):
            storage(initialize_bucket=True)


def test_simultaneous_worker_bucket_initialization_is_idempotent():
    with patch("api.services.filesystem.minio.Minio") as client:
        client.return_value.bucket_exists.return_value = False
        client.return_value.make_bucket.side_effect = S3Error(
            "BucketAlreadyOwnedByYou", "exists", "bucket", "test", "test", None
        )
        storage(initialize_bucket=True)
        client.return_value.delete_bucket_policy.assert_called_once_with(
            "logs-test-artifacts"
        )


@pytest.mark.parametrize(
    "url",
    [
        "https://audio.example.com/prefix",
        "https://user:password@audio.example.com",
        "https://audio.example.com?token=secret",
    ],
)
def test_public_endpoint_must_be_origin(url):
    with pytest.raises(ValueError):
        MinioFileSystem(public_endpoint=url)
