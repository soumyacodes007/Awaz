"""CRM connections. HubSpot: connect with a private-app token or OAuth, browse
contact lists and properties, and preview the leads a campaign would call."""

import base64
import hashlib
import hmac
import json
import time
from datetime import UTC, datetime, timedelta
from typing import Annotated
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

from api.constants import OSS_JWT_SECRET
from api.db.models import UserModel
from api.sdk_expose import sdk_expose
from api.services.auth.depends import get_user_with_selected_organization
from api.services.campaign.sources.hubspot import HubSpotSourceConfig, read_contacts
from api.services.crm import hubspot

router = APIRouter(prefix="/crm/hubspot", tags=["crm"])
User = Annotated[UserModel, Depends(get_user_with_selected_organization)]

PREVIEW_LIMIT = 1000
STATE_TTL = 600


class HubSpotStatus(BaseModel):
    connected: bool
    auth_type: str | None = None
    portal_id: int | None = None
    ui_domain: str | None = None
    time_zone: str | None = None
    connected_at: str | None = None
    token_hint: str | None = None
    oauth_available: bool


class ConnectTokenRequest(BaseModel):
    access_token: str = Field(min_length=10, max_length=500)


class OAuthStart(BaseModel):
    authorize_url: str


class HubSpotList(BaseModel):
    id: str
    name: str
    size: int | None = None
    dynamic: bool


class HubSpotProperty(BaseModel):
    name: str
    label: str
    type: str | None = None
    field_type: str | None = None
    group: str | None = None
    phone: bool


class PreviewContact(BaseModel):
    name: str
    phone_number: str
    variables: dict[str, str]


class LeadPreview(BaseModel):
    scanned: int
    capped: bool = Field(description="True when only the first contacts were scanned.")
    dialable: int
    no_phone: int
    bad_phone: int
    bad_phone_samples: list[str]
    variables: list[str]
    sample: list[PreviewContact]


def _fail(exc: hubspot.HubSpotError):
    status = exc.status if exc.status in (400, 401, 403, 404, 409) else 502
    raise HTTPException(status, str(exc)) from None


@router.get(
    "",
    response_model=HubSpotStatus,
    **sdk_expose(
        method="get_hubspot_status",
        description="Whether HubSpot is connected, and how.",
    ),
)
async def status(user: User):
    return hubspot.public_status(
        await hubspot.get_connection(user.selected_organization_id)
    )


@router.post(
    "/token",
    response_model=HubSpotStatus,
    **sdk_expose(
        method="connect_hubspot_token",
        description="Connect HubSpot with a private-app access token.",
    ),
)
async def connect_token(body: ConnectTokenRequest, user: User):
    try:
        connection = await hubspot.verify_token(body.access_token.strip())
    except hubspot.HubSpotError as exc:
        _fail(exc)
    await hubspot.save_connection(user.selected_organization_id, connection)
    return hubspot.public_status(connection)


@router.delete(
    "",
    response_model=HubSpotStatus,
    **sdk_expose(
        method="disconnect_hubspot", description="Remove the HubSpot connection."
    ),
)
async def disconnect(user: User):
    await hubspot.delete_connection(user.selected_organization_id)
    return hubspot.public_status(None)


# ── OAuth ───────────────────────────────────────────────────────────────


def _sign(payload: dict) -> str:
    raw = base64.urlsafe_b64encode(
        json.dumps(payload, separators=(",", ":")).encode()
    ).decode()
    mac = hmac.new(OSS_JWT_SECRET.encode(), raw.encode(), hashlib.sha256).hexdigest()[
        :32
    ]
    return f"{raw}.{mac}"


def _verify(state: str) -> dict:
    try:
        raw, mac = state.rsplit(".", 1)
    except ValueError:
        raise HTTPException(400, "Invalid OAuth state") from None
    expected = hmac.new(
        OSS_JWT_SECRET.encode(), raw.encode(), hashlib.sha256
    ).hexdigest()[:32]
    if not hmac.compare_digest(mac, expected):
        raise HTTPException(400, "Invalid OAuth state")
    payload = json.loads(base64.urlsafe_b64decode(raw.encode()))
    if payload.get("exp", 0) < time.time():
        raise HTTPException(400, "The HubSpot sign-in took too long. Try again.")
    return payload


def _safe_path(path: str | None) -> str:
    # Only same-site paths, so the callback can't bounce users elsewhere.
    return (
        path
        if path and path.startswith("/") and not path.startswith("//")
        else "/campaigns/new"
    )


@router.get(
    "/oauth/start",
    response_model=OAuthStart,
    **sdk_expose(
        method="start_hubspot_oauth",
        description="URL to send the user to for HubSpot OAuth.",
    ),
)
async def oauth_start(
    user: User, return_to: str = Query(default="/campaigns/new", max_length=300)
):
    settings = hubspot.oauth_settings()
    if not settings:
        raise HTTPException(
            503,
            "HubSpot OAuth isn't set up on this server (HUBSPOT_CLIENT_ID, HUBSPOT_CLIENT_SECRET, HUBSPOT_REDIRECT_URI).",
        )
    state = _sign(
        {
            "org": user.selected_organization_id,
            "user": user.id,
            "ret": _safe_path(return_to),
            "exp": int(time.time()) + STATE_TTL,
        }
    )
    query = urlencode(
        {
            "client_id": settings["client_id"],
            "redirect_uri": settings["redirect_uri"],
            "scope": settings["scopes"],
            "state": state,
        }
    )
    return OAuthStart(authorize_url=f"https://app.hubspot.com/oauth/authorize?{query}")


@router.get("/oauth/callback", include_in_schema=False)
async def oauth_callback(user: User, code: str = "", state: str = "", error: str = ""):
    payload = _verify(state)
    back = _safe_path(payload.get("ret"))
    sep = "&" if "?" in back else "?"
    if payload.get("org") != user.selected_organization_id:
        raise HTTPException(
            403, "This HubSpot sign-in was started from another workspace"
        )
    if error or not code:
        return RedirectResponse(f"{back}{sep}hubspot=denied", status_code=302)
    settings = hubspot.oauth_settings()
    if not settings:
        raise HTTPException(503, "HubSpot OAuth isn't set up on this server")
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.post(
            f"{hubspot.API}/oauth/v1/token",
            data={
                "grant_type": "authorization_code",
                "client_id": settings["client_id"],
                "client_secret": settings["client_secret"],
                "redirect_uri": settings["redirect_uri"],
                "code": code,
            },
        )
        if res.status_code != 200:
            return RedirectResponse(f"{back}{sep}hubspot=failed", status_code=302)
        tokens = res.json()
        info = await client.get(
            f"{hubspot.API}/oauth/v1/access-tokens/{tokens['access_token']}"
        )
    meta = info.json() if info.status_code == 200 else {}
    await hubspot.save_connection(
        user.selected_organization_id,
        {
            "auth_type": "oauth",
            "access_token": tokens["access_token"],
            "refresh_token": tokens.get("refresh_token"),
            "expires_at": (
                datetime.now(UTC)
                + timedelta(seconds=int(tokens.get("expires_in", 1800)) - 60)
            ).isoformat(),
            "portal_id": meta.get("hub_id"),
            "ui_domain": meta.get("hub_domain"),
            "scopes": meta.get("scopes"),
            "connected_at": datetime.now(UTC).isoformat(),
        },
    )
    return RedirectResponse(f"{back}{sep}hubspot=connected", status_code=302)


# ── Reads ───────────────────────────────────────────────────────────────


@router.get(
    "/lists",
    response_model=list[HubSpotList],
    **sdk_expose(method="list_hubspot_lists", description="HubSpot contact lists."),
)
async def lists(user: User, q: str = Query(default="", max_length=100)):
    try:
        client = await hubspot.HubSpot.for_org(user.selected_organization_id)
        return await client.contact_lists(q)
    except hubspot.HubSpotError as exc:
        _fail(exc)


@router.get(
    "/properties",
    response_model=list[HubSpotProperty],
    **sdk_expose(
        method="list_hubspot_properties",
        description="HubSpot contact properties, phone fields first.",
    ),
)
async def properties(user: User):
    try:
        client = await hubspot.HubSpot.for_org(user.selected_organization_id)
        return await client.contact_properties()
    except hubspot.HubSpotError as exc:
        _fail(exc)


@router.post(
    "/preview",
    response_model=LeadPreview,
    **sdk_expose(
        method="preview_hubspot_leads",
        description="What a HubSpot campaign source would call: counts and a sample.",
    ),
)
async def preview(body: HubSpotSourceConfig, user: User):
    limit = min(body.max_contacts, PREVIEW_LIMIT)
    try:
        data = await read_contacts(user.selected_organization_id, body, limit=limit)
    except hubspot.HubSpotError as exc:
        _fail(exc)
    rows = data["rows"]
    variables = [
        k for k in dict.fromkeys(k for r in rows[:50] for k in r) if k != "phone_number"
    ]
    return LeadPreview(
        scanned=data["total"],
        capped=data["total"] >= limit and body.max_contacts > limit,
        dialable=len(rows),
        no_phone=data["no_phone"],
        bad_phone=data["bad_phone"],
        bad_phone_samples=data["bad_phone_samples"],
        variables=variables,
        sample=[
            PreviewContact(
                name=r.get("name") or "",
                phone_number=r["phone_number"],
                variables={
                    k: str(v) for k, v in r.items() if k not in ("phone_number", "name")
                },
            )
            for r in rows[:8]
        ],
    )
