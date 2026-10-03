import { AudioLines } from "lucide-react";
import type { Metadata } from "next";

import { getUsageHistoryApiV1OrganizationsUsageRunsGet, getWorkflowsApiV1WorkflowFetchGet } from "@/client";
import { PageBody, PageHeader } from "@/components/app/PageHeader";
import { Pager } from "@/components/app/Pager";
import { RunFilterBar } from "@/components/app/RunFilterBar";
import { Card, EmptyState } from "@/components/app/ui";
import { filterParam, parseFilters } from "@/lib/runs";
import { authHeaders, ensureAuthorized } from "@/lib/server-api";

import { RecordingList } from "./RecordingList";

export const metadata: Metadata = { title: "Recordings | Awaz" };

const LIMIT = 50;

export default async function RecordingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const headers = await authHeaders();
  const [runs, agents] = await Promise.all([
    getUsageHistoryApiV1OrganizationsUsageRunsGet({ headers, query: { page, limit: LIMIT, filters: filterParam(parseFilters(sp)) } }),
    getWorkflowsApiV1WorkflowFetchGet({ headers }),
  ]);
  ensureAuthorized(runs);
  const withAudio = (runs.data?.runs ?? []).filter((r) => r.recording_url || r.recording_public_url);

  return (
    <>
      <PageHeader title="Recordings" sub="Listen back to calls. Open a call for its transcript and latency." />
      <PageBody>
        <RunFilterBar agents={(agents.data ?? []).map((a) => ({ id: a.id, name: a.name }))} show={["agent", "direction", "date"]} />
        <Card>
          {withAudio.length ? (
            <RecordingList
              items={withAudio.map((r) => ({
                id: r.id,
                workflowId: r.workflow_id,
                agent: r.workflow_name ?? `Agent ${r.workflow_id}`,
                createdAt: r.created_at,
                duration: r.call_duration_seconds,
                number: (r.call_type === "inbound" ? r.caller_number : (r.called_number ?? r.phone_number)) ?? null,
                direction: r.call_type ?? null,
                outcome: r.disposition ?? null,
                key: r.recording_url ?? null,
                publicUrl: r.recording_public_url ?? null,
              }))}
            />
          ) : (
            <EmptyState icon={AudioLines} title="No recordings here" body="Phone and web calls are recorded automatically. Text chats have no audio." />
          )}
          <Pager page={page} totalPages={runs.data?.total_pages ?? 1} path="/recordings" params={sp} />
        </Card>
      </PageBody>
    </>
  );
}
