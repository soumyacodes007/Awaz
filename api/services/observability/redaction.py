"""Remove credentials from diagnostic payloads without dropping useful content."""

import json
import re
from typing import Any
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

_SECRET = re.compile(
    r"(^|[_\-.])(password|passwd|secret|token|api_?key|authorization|cookie|private_?key|credential)([_\-.]|$)",
    re.I,
)
_BEARER = re.compile(r"\bBearer\s+[A-Za-z0-9._~+/=-]+", re.I)
_MAX_STRING = 65536


def _secret_key(key: str) -> bool:
    normalized = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", key)
    return bool(_SECRET.search(normalized)) or key.startswith("__")


def redact(value: Any, *, depth: int = 0) -> Any:
    if depth > 16:
        return "[truncated]"
    if isinstance(value, dict):
        return {
            str(key): "[redacted]"
            if _secret_key(str(key))
            else redact(item, depth=depth + 1)
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [redact(item, depth=depth + 1) for item in value[:2000]]
    if isinstance(value, str):
        # Trace attributes and tool results often contain JSON encoded as text.
        if value.lstrip().startswith(("{", "[")):
            if len(value) > _MAX_STRING:
                return "[structured payload exceeds display limit]"
            try:
                return json.dumps(
                    redact(json.loads(value), depth=depth + 1), ensure_ascii=False
                )
            except (ValueError, RecursionError):
                pass
        value = _BEARER.sub("Bearer [redacted]", value)
        if value.startswith(("https://", "http://")):
            try:
                parsed = urlsplit(value)
                host = parsed.netloc.rsplit("@", 1)[-1]
                query = [
                    (
                        k,
                        "[redacted]"
                        if _secret_key(k)
                        or k.lower()
                        in (
                            "signature",
                            "sig",
                            "x-amz-signature",
                            "x-amz-security-token",
                        )
                        else v,
                    )
                    for k, v in parse_qsl(parsed.query)
                ]
                value = urlunsplit(
                    (
                        parsed.scheme,
                        host,
                        parsed.path,
                        urlencode(query),
                        parsed.fragment,
                    )
                )
            except ValueError:
                return "[invalid URL]"
        return value[:_MAX_STRING] + ("[truncated]" if len(value) > _MAX_STRING else "")
    return value
