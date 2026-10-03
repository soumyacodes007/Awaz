import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getCampaignApiV1CampaignCampaignIdGet, getCampaignRunsApiV1CampaignCampaignIdRunsGet } from "@/client";
import { authHeaders, ensureAuthorized } from "@/lib/server-api";

import { CampaignDetail } from "./CampaignDetail";

export const metadata: Metadata = { title: "Campaign | Awaz" };

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const headers = await authHeaders();
  const [campaign, runs] = await Promise.all([
    getCampaignApiV1CampaignCampaignIdGet({ headers, path: { campaign_id: id } }),
    getCampaignRunsApiV1CampaignCampaignIdRunsGet({ headers, path: { campaign_id: id }, query: { page: 1, limit: 50 } }),
  ]);
  ensureAuthorized(campaign);
  if (!campaign.data) notFound();

  return (
    <CampaignDetail
      campaign={campaign.data}
      runs={(runs.data?.runs ?? []).map((r) => {
        const x = r as Record<string, unknown>;
        const ic = (x.initial_context ?? {}) as Record<string, unknown>;
        const gc = (x.gathered_context ?? {}) as Record<string, unknown>;
        const cost = (x.cost_info ?? {}) as Record<string, unknown>;
        return {
          id: Number(x.id),
          createdAt: String(x.created_at),
          phone: (ic.phone_number ?? ic.called_number ?? null) as string | null,
          name: (ic.first_name ?? ic.name ?? null) as string | null,
          duration: (cost.call_duration_seconds as number | undefined) ?? null,
          disposition: (gc.mapped_call_disposition ?? gc.call_disposition ?? null) as string | null,
          completed: Boolean(x.is_completed),
        };
      })}
      totalRuns={runs.data?.total_count ?? 0}
    />
  );
}
