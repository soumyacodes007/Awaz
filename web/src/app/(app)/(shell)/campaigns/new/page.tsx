import type { Metadata } from "next";

import {
  getCampaignDefaultsApiV1OrganizationsCampaignDefaultsGet,
  getWorkflowsApiV1WorkflowFetchGet,
  listTelephonyConfigurationsApiV1OrganizationsTelephonyConfigsGet,
} from "@/client";
import { authHeaders, ensureAuthorized } from "@/lib/server-api";

import { NewCampaignForm } from "./NewCampaignForm";

export const metadata: Metadata = { title: "New campaign | Awaz" };

export default async function NewCampaignPage({
  searchParams,
}: {
  searchParams: Promise<{ agent?: string; source?: string; hubspot?: string }>;
}) {
  const { agent, source, hubspot } = await searchParams;
  const headers = await authHeaders();
  const [agents, telephony, defaults] = await Promise.all([
    getWorkflowsApiV1WorkflowFetchGet({ headers, query: { status: "active" } }),
    listTelephonyConfigurationsApiV1OrganizationsTelephonyConfigsGet({
      headers,
    }),
    getCampaignDefaultsApiV1OrganizationsCampaignDefaultsGet({ headers }),
  ]);
  ensureAuthorized(agents);
  const d = defaults.data as
    | {
        concurrent_call_limit?: number;
        default_retry_config?: Record<string, unknown>;
      }
    | undefined;

  return (
    <NewCampaignForm
      agents={(agents.data ?? []).map((a) => ({ id: a.id, name: a.name }))}
      telephony={(telephony.data?.configurations ?? []).map((t) => ({
        id: t.id,
        name: t.name,
        isDefault: t.is_default_outbound,
      }))}
      concurrencyLimit={d?.concurrent_call_limit ?? 10}
      retryDefaults={d?.default_retry_config ?? {}}
      initialAgent={agent ? Number(agent) : null}
      initialSource={source === "hubspot" || hubspot ? "hubspot" : "csv"}
      hubspotResult={hubspot ?? null}
    />
  );
}
