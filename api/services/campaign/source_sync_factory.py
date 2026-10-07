from api.services.campaign.source_sync import CampaignSourceSyncService
from api.services.campaign.sources.csv import CSVSyncService
from api.services.campaign.sources.hubspot import HubSpotSyncService


def get_sync_service(source_type: str) -> CampaignSourceSyncService:
    """Returns appropriate sync service based on source type"""

    services = {
        "csv": CSVSyncService,
        "hubspot": HubSpotSyncService,
    }

    service_class = services.get(source_type)
    if not service_class:
        raise ValueError(f"Unknown source type: {source_type}")

    return service_class()
