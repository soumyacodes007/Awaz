import type { Metadata } from "next";

import {
  getLangfuseCredentialsApiV1OrganizationsLangfuseCredentialsGet,
  getModelConfigurationV2ApiV1OrganizationsModelConfigurationsV2Get,
  getPreferencesApiV1OrganizationsPreferencesGet,
  listCredentialsApiV1CredentialsGet,
  listToolsApiV1ToolsGet,
} from "@/client";
import { authHeaders, ensureAuthorized } from "@/lib/server-api";
import { describe, type Effective } from "@/lib/models";

import { IntegrationsView } from "./IntegrationsView";

export const metadata: Metadata = { title: "Integrations | Awaz" };

export default async function IntegrationsPage() {
  const headers = await authHeaders();
  const [model, creds, langfuse, prefs, mcp] = await Promise.all([
    getModelConfigurationV2ApiV1OrganizationsModelConfigurationsV2Get({ headers }),
    listCredentialsApiV1CredentialsGet({ headers }),
    getLangfuseCredentialsApiV1OrganizationsLangfuseCredentialsGet({ headers }),
    getPreferencesApiV1OrganizationsPreferencesGet({ headers }),
    listToolsApiV1ToolsGet({ headers, query: { category: "mcp", status: "active" } }),
  ]);
  ensureAuthorized(model);
  const eff = (model.data?.effective_configuration ?? {}) as Effective;
  const summary = (["llm", "stt", "tts"] as const).map((s) => describe(s, eff[s] ?? null).provider).join(" · ");

  return (
    <IntegrationsView
      modelSummary={model.data?.configuration ? summary : null}
      credentialCount={creds.data?.length ?? 0}
      langfuse={(langfuse.data ?? null) as Record<string, unknown> | null}
      callEvents={prefs.data?.call_events ?? { enabled: false, sink_type: null, config: {} }}
      mcpCount={mcp.data?.length ?? 0}
    />
  );
}
