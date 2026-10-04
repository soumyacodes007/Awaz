import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  getAgentApiV1AgentsAgentIdGet,
  getModelConfigurationV2ApiV1OrganizationsModelConfigurationsV2Get,
  getModelConfigurationV2DefaultsApiV1OrganizationsModelConfigurationsV2DefaultsGet,
  getNodeTypeApiV1NodeTypesNameGet,
  getPreferencesApiV1OrganizationsPreferencesGet,
  getWorkflowRunsApiV1WorkflowWorkflowIdRunsGet,
  listCredentialsApiV1CredentialsGet,
  listDocumentsApiV1KnowledgeBaseDocumentsGet,
  listRecordingsApiV1WorkflowRecordingsGet,
  listTelephonyConfigurationsApiV1OrganizationsTelephonyConfigsGet,
  listToolsApiV1ToolsGet,
} from "@/client";
import { toAgent } from "@/lib/agent";
import { eventsOf, summarize } from "@/lib/latency";
import type { Defaults, Effective, ModelConfigV2 } from "@/lib/models";
import { authHeaders, ensureAuthorized } from "@/lib/server-api";

import { AgentEditor } from "./AgentEditor";

export const metadata: Metadata = { title: "Agent | Awaz" };

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const headers = await authHeaders();

  const [res, tools, docs, clips, creds, model, defaults, runs, telephony, prefs, qaSpec] = await Promise.all([
    getAgentApiV1AgentsAgentIdGet({ headers, path: { agent_id: id } }),
    listToolsApiV1ToolsGet({ headers, query: { status: "active" } }),
    listDocumentsApiV1KnowledgeBaseDocumentsGet({ headers, query: { limit: 200 } }),
    listRecordingsApiV1WorkflowRecordingsGet({ headers }),
    listCredentialsApiV1CredentialsGet({ headers }),
    getModelConfigurationV2ApiV1OrganizationsModelConfigurationsV2Get({ headers }),
    getModelConfigurationV2DefaultsApiV1OrganizationsModelConfigurationsV2DefaultsGet({ headers }),
    getWorkflowRunsApiV1WorkflowWorkflowIdRunsGet({ headers, path: { workflow_id: id }, query: { page: 1, limit: 25 } }),
    listTelephonyConfigurationsApiV1OrganizationsTelephonyConfigsGet({ headers }),
    getPreferencesApiV1OrganizationsPreferencesGet({ headers }),
    getNodeTypeApiV1NodeTypesNameGet({ headers, path: { name: "qa" } }),
  ]);
  ensureAuthorized(res);
  if (!res.data) notFound();
  const a = res.data;

  const runList = runs.data?.runs ?? [];
  const latency = summarize(runList.flatMap((r) => eventsOf(r.logs)));

  return (
    <AgentEditor
      key={a.id}
      agent={{
        id: a.id,
        name: a.name,
        uuid: a.uuid,
        versionNumber: a.version_number,
        versionStatus: a.version_status,
        kind: a.kind,
        multiStepNodes: a.multi_step_nodes ?? 0,
        spec: toAgent(a.agent),
        configs: a.settings,
      }}
      tools={(tools.data ?? []).map((t) => ({ uuid: t.tool_uuid, name: t.name, description: t.description, category: t.category }))}
      documents={(docs.data?.documents ?? []).map((d) => ({ uuid: d.document_uuid, name: d.filename, status: d.processing_status }))}
      clips={(clips.data?.recordings ?? []).map((r) => ({ id: r.recording_id, transcript: r.transcript }))}
      credentials={(creds.data ?? []).map((c) => ({ uuid: c.uuid, name: c.name }))}
      org={{
        config: (model.data?.configuration ?? null) as ModelConfigV2 | null,
        effective: (model.data?.effective_configuration ?? {}) as Effective,
      }}
      defaults={(defaults.data ?? null) as Defaults | null}
      runs={runList.map((r) => ({
        id: r.id,
        createdAt: r.created_at,
        mode: r.mode,
        completed: r.is_completed,
        duration: (r.cost_info?.call_duration_seconds as number | undefined) ?? null,
        disposition: (r.gathered_context?.mapped_call_disposition ?? r.gathered_context?.call_disposition ?? null) as string | null,
        phone: (r.initial_context?.phone_number ?? r.initial_context?.called_number ?? null) as string | null,
        hasRecording: Boolean(r.recording_url),
      }))}
      totalRuns={runs.data?.total_count ?? 0}
      latency={latency}
      telephony={(telephony.data?.configurations ?? []).map((c) => ({ id: c.id, name: c.name, ready: c.is_ready_for_outbound ?? true }))}
      testPhone={prefs.data?.test_phone_number ?? null}
      qaDefaultPrompt={String(
        ((qaSpec.data as { properties?: { name: string; default?: unknown }[] } | undefined)?.properties ?? []).find((p) => p.name === "qa_system_prompt")?.default ?? "",
      )}
    />
  );
}
