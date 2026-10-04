import type { Metadata } from "next";

import {
  apiLogsApiV1LogsApiGet,
  listCallsApiV1LogsCallsGet,
  listChatsApiV1LogsChatsGet,
  listPhoneNumbersApiV1OrganizationsTelephonyConfigsConfigIdPhoneNumbersGet,
  listTelephonyConfigurationsApiV1OrganizationsTelephonyConfigsGet,
  sessionsApiV1LogsSessionsGet,
  webhooksApiV1LogsWebhooksGet,
  workflowOptionsApiV1LogsWorkflowsGet,
} from "@/client";
import { LOG_TABS, type LogsTab, RANGES, type RangeId } from "@/lib/logs";
import { authHeaders, ensureAuthorized } from "@/lib/server-api";

import { LogsView } from "./LogsView";

export const metadata: Metadata = { title: "Logs | Awaz" };

type SP = Record<string, string | string[] | undefined>;
const one = (sp: SP, k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
const list = (sp: SP, k: string) => (one(sp, k) ?? "").split(",").filter(Boolean);
const ints = (sp: SP, k: string) => list(sp, k).map(Number).filter((n) => Number.isInteger(n) && n > 0);

export default async function LogsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const headers = await authHeaders();

  const tab: LogsTab = LOG_TABS.some((t) => t.id === one(sp, "tab")) ? (one(sp, "tab") as LogsTab) : "calls";
  const range: RangeId = RANGES.some((r) => r.id === one(sp, "range")) ? (one(sp, "range") as RangeId) : "30d";
  const hours = RANGES.find((r) => r.id === range)!.hours;
  const start_at = hours ? new Date(Date.now() - hours * 3600_000).toISOString() : undefined;
  const page = Math.max(1, Number(one(sp, "page")) || 1);
  const limit = [10, 25, 50, 100].includes(Number(one(sp, "limit"))) ? Number(one(sp, "limit")) : 25;
  const runId = Number(one(sp, "id")) || undefined;

  const callQuery = {
    start_at,
    page,
    limit,
    run_id: runId,
    workflow_ids: ints(sp, "agents"),
    channels: list(sp, "channels").filter((c): c is "telephony" | "web" | "chat" => ["telephony", "web", "chat"].includes(c)),
    directions: list(sp, "directions").filter((d): d is "inbound" | "outbound" => d === "inbound" || d === "outbound"),
    ended_reasons: list(sp, "ended"),
    customer_number: one(sp, "customer"),
    assistant_number: one(sp, "number"),
    completed: one(sp, "status") === "completed" ? true : one(sp, "status") === "in_progress" ? false : undefined,
    min_duration: one(sp, "min") ? Number(one(sp, "min")) : undefined,
    max_duration: one(sp, "max") ? Number(one(sp, "max")) : undefined,
    sort_by: one(sp, "sort") === "duration" ? ("duration" as const) : ("created_at" as const),
    sort_order: one(sp, "order") === "asc" ? ("asc" as const) : ("desc" as const),
  };
  const opQuery = { start_at, page, limit, run_id: tab !== "api" ? runId : undefined, status: one(sp, "opstatus") };

  const [workflows, telephony, data] = await Promise.all([
    workflowOptionsApiV1LogsWorkflowsGet({ headers, query: { limit: 50 } }),
    listTelephonyConfigurationsApiV1OrganizationsTelephonyConfigsGet({ headers }),
    tab === "calls"
      ? listCallsApiV1LogsCallsGet({ headers, query: callQuery })
      : tab === "chat"
        ? listChatsApiV1LogsChatsGet({ headers, query: { ...callQuery, channels: [] } })
        : tab === "sessions"
          ? sessionsApiV1LogsSessionsGet({ headers, query: opQuery })
          : tab === "webhooks"
            ? webhooksApiV1LogsWebhooksGet({ headers, query: opQuery })
            : apiLogsApiV1LogsApiGet({ headers, query: opQuery }),
  ]);
  ensureAuthorized(workflows);

  const numbers = (
    await Promise.all(
      (telephony.data?.configurations ?? []).map((c) =>
        listPhoneNumbersApiV1OrganizationsTelephonyConfigsConfigIdPhoneNumbersGet({ headers, path: { config_id: c.id } }).then((r) =>
          (r.data?.phone_numbers ?? []).map((n) => n.address),
        ),
      ),
    )
  ).flat();

  const result = data.data as { items: unknown[]; total_count: number; total_pages: number; snapshot_at?: string } | undefined;

  return (
    <LogsView
      tab={tab}
      items={result?.items ?? []}
      total={result?.total_count ?? 0}
      totalPages={result?.total_pages ?? 0}
      page={page}
      limit={limit}
      snapshotAt={result?.snapshot_at ?? new Date().toISOString()}
      error={data.error ? "Couldn't load logs. Is the backend running?" : null}
      agents={workflows.data?.items ?? []}
      numbers={[...new Set(numbers)]}
      exportQuery={{ ...callQuery, page: undefined, limit: undefined, channels: tab === "chat" ? ["chat"] : callQuery.channels }}
    />
  );
}
