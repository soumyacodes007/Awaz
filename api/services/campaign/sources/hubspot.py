"""HubSpot as a campaign source: contacts from a list (or all contacts) become
queued calls. The campaign's source_id holds the JSON config below, so the
same list can be synced again later with the same mapping."""

from __future__ import annotations

import json
from typing import Any, Optional

from loguru import logger
from pydantic import BaseModel, Field
from pydantic import ValidationError as PydanticValidationError

from api.db import db_client
from api.services.campaign.source_sync import (
    CampaignSourceSyncService,
    ValidationError,
    ValidationResult,
)
from api.services.crm.hubspot import (
    DEFAULT_PROPERTIES,
    HubSpot,
    HubSpotError,
    contact_name,
    normalize_phone,
)

# HubSpot property → template variable, for the common ones.
VARIABLE_NAMES = {"firstname": "first_name", "lastname": "last_name"}
MAX_CONTACTS = 20000


class HubSpotSourceConfig(BaseModel):
    list_id: str | None = Field(default=None, description="None means every contact.")
    list_name: str | None = None
    phone_property: str = "phone"
    fallback_phone_properties: list[str] = Field(
        default_factory=lambda: ["mobilephone", "hs_calculated_phone_number"]
    )
    properties: list[str] = Field(
        default_factory=lambda: list(DEFAULT_PROPERTIES), max_length=30
    )
    default_country_code: str = Field(default="+91", pattern=r"^\+?\d{1,4}$")
    max_contacts: int = Field(default=5000, ge=1, le=MAX_CONTACTS)

    @classmethod
    def parse(cls, source_id: str) -> "HubSpotSourceConfig":
        try:
            return cls.model_validate(json.loads(source_id or "{}"))
        except (json.JSONDecodeError, PydanticValidationError) as exc:
            raise ValueError(f"Invalid HubSpot source settings: {exc}") from None

    def variable(self, prop: str) -> str:
        return VARIABLE_NAMES.get(prop, prop)


def contact_row(
    contact: dict, config: HubSpotSourceConfig
) -> tuple[dict | None, str | None]:
    """(context variables, raw phone) for one contact; variables is None when
    the contact has no usable phone number."""
    props = contact.get("properties") or {}
    raw = next(
        (
            props.get(p)
            for p in [config.phone_property, *config.fallback_phone_properties]
            if props.get(p)
        ),
        None,
    )
    phone = normalize_phone(raw, config.default_country_code)
    if not phone:
        return None, raw
    variables: dict[str, Any] = {"phone_number": phone}
    for prop in config.properties:
        variables[config.variable(prop)] = props.get(prop) or ""
    variables["name"] = contact_name(props)
    variables["hubspot_contact_id"] = str(
        contact.get("id") or props.get("hs_object_id") or ""
    )
    return variables, raw


async def read_contacts(
    organization_id: int, config: HubSpotSourceConfig, limit: int | None = None
):
    """Dialable rows plus counts of what was skipped and why."""
    client = await HubSpot.for_org(organization_id)
    wanted = list(
        dict.fromkeys(
            [
                config.phone_property,
                *config.fallback_phone_properties,
                *config.properties,
                "firstname",
                "lastname",
                "email",
            ]
        )
    )
    rows, no_phone, bad_phone, total = [], 0, [], 0
    async for contact in client.contacts(
        config.list_id, wanted, limit or config.max_contacts
    ):
        total += 1
        variables, raw = contact_row(contact, config)
        if variables is None:
            if raw:
                bad_phone.append(raw)
            else:
                no_phone += 1
            continue
        rows.append(variables)
    return {
        "rows": rows,
        "total": total,
        "no_phone": no_phone,
        "bad_phone": len(bad_phone),
        "bad_phone_samples": bad_phone[:3],
        "portal_id": client.connection.get("portal_id"),
    }


def _as_table(rows: list[dict]) -> tuple[list[str], list[list[str]]]:
    headers = list(dict.fromkeys(k for r in rows for k in r))
    return headers, [[str(r.get(h, "")) for h in headers] for r in rows]


class HubSpotSyncService(CampaignSourceSyncService):
    async def validate_source(
        self,
        source_id: str,
        organization_id: Optional[int] = None,
        *,
        require_e164: bool = True,
    ) -> ValidationResult:
        try:
            config = HubSpotSourceConfig.parse(source_id)
            data = await read_contacts(organization_id, config)
        except (ValueError, HubSpotError) as exc:
            return ValidationResult(
                is_valid=False, error=ValidationError(message=str(exc))
            )
        if not data["rows"]:
            where = f"the list “{config.list_name}”" if config.list_name else "HubSpot"
            return ValidationResult(
                is_valid=False,
                error=ValidationError(
                    message=f"None of the {data['total']} contacts in {where} have a phone number "
                    f"in “{config.phone_property}” or its fallbacks."
                ),
            )
        headers, rows = _as_table(data["rows"])
        return self.validate_source_data(headers, rows, require_e164=require_e164)

    async def sync_source_data(self, campaign_id: int) -> int:
        campaign = await db_client.get_campaign_by_id(campaign_id)
        if not campaign:
            raise ValueError(f"Campaign {campaign_id} not found")
        config = HubSpotSourceConfig.parse(campaign.source_id)
        data = await read_contacts(campaign.organization_id, config)

        seen: set[str] = set()
        queued = []
        for variables in data["rows"]:
            contact_id = variables["hubspot_contact_id"]
            # One call per contact even if a list holds duplicates.
            if contact_id in seen:
                continue
            seen.add(contact_id)
            queued.append(
                {
                    "campaign_id": campaign_id,
                    "source_uuid": f"hubspot_{data['portal_id']}_{contact_id}",
                    "context_variables": variables,
                    "state": "queued",
                }
            )
        if queued:
            await db_client.bulk_create_queued_runs(queued)
        logger.info(
            f"HubSpot sync for campaign {campaign_id}: {len(queued)} queued, "
            f"{data['no_phone']} without a phone, {data['bad_phone']} unusable numbers"
        )
        await db_client.update_campaign(
            campaign_id=campaign_id,
            total_rows=len(queued),
            source_sync_status="completed",
        )
        return len(queued)
