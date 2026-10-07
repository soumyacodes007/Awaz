import pytest

from api.services.campaign.sources.hubspot import HubSpotSourceConfig, contact_row
from api.services.crm.hubspot import normalize_phone


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("+1 (617) 555-0100", "+16175550100"),
        ("98765 43210", "+919876543210"),
        ("09876543210", "+919876543210"),
        ("919876543210", "+919876543210"),
        ("0044 20 7946 0958", "+442079460958"),
        ("+91-98765-43210 ext 12", "+919876543210"),
        ("12", None),
        ("", None),
        (None, None),
    ],
)
def test_normalize_phone(raw, expected):
    assert normalize_phone(raw, "+91") == expected


def test_contact_row_maps_variables_and_falls_back_to_mobile():
    config = HubSpotSourceConfig(properties=["firstname", "company"])
    contact = {
        "id": "42",
        "properties": {
            "firstname": "Asha",
            "lastname": "Rao",
            "company": "Acme",
            "phone": None,
            "mobilephone": "98765 43210",
        },
    }
    variables, raw = contact_row(contact, config)
    assert raw == "98765 43210"
    assert variables == {
        "phone_number": "+919876543210",
        "first_name": "Asha",
        "company": "Acme",
        "name": "Asha Rao",
        "hubspot_contact_id": "42",
    }


def test_contact_without_phone_is_skipped():
    variables, raw = contact_row(
        {"id": "1", "properties": {"firstname": "X"}}, HubSpotSourceConfig()
    )
    assert variables is None and raw is None


def test_config_round_trips_through_source_id():
    config = HubSpotSourceConfig(
        list_id="7", list_name="Hot leads", phone_property="mobilephone"
    )
    assert HubSpotSourceConfig.parse(config.model_dump_json()) == config
    with pytest.raises(ValueError):
        HubSpotSourceConfig.parse("not json")
