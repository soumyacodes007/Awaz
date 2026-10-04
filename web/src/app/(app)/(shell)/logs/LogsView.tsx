"use client";

import { ArrowDown, ArrowUp, Bot, ChevronLeft, ChevronRight, Download, Globe, LoaderCircle, MessageSquareText, Phone, RefreshCw } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";

import type { ApiRequestLogSummary, CallLogSummary, SessionLogSummary, WebhookLogSummary } from "@/client";
import { btn, Badge, EmptyState, ErrorNote, inputBase, type Tone } from "@/components/app/ui";
import { ago } from "@/lib/format";
import { channelLabel, fmtDuration, fmtMoney, fmtStart, LOG_TABS, type LogsTab, reasonLabel, RANGES, shortId } from "@/lib/logs";

import { CallDrawer } from "./CallDrawer";
import { type ColumnId, FilterBar } from "./FilterBar";
import { OpDetailDrawer } from "./OpDetailDrawer";

const HIDDEN_KEY = "awaz.logs.hiddenColumns";

const CHANNEL_ICON = { telephony: Phone, web: Globe, chat: MessageSquareText } as const;

export function ChannelBadge({ channel }: { channel: string }) {
  const Icon = CHANNEL_ICON[channel as keyof typeof CHANNEL_ICON] ?? Globe;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border bg-background px-2 py-0.5 text-xs font-medium text-foreground">
      <Icon className="size-3.5 text-muted-foreground" /> {channelLabel(channel)}
    </span>
  );
}

const REASON_TONE: Record<string, Tone> = {
  user_hangup: "neutral",
  customer: "neutral",
  completed: "green",
  end_call: "green",
  transferred: "blue",
  error: "red",
  failed: "red",
  no_answer: "amber",
  busy: "amber",
  voicemail: "violet",
};
const reasonTone = (r: string | null) => {
  if (!r) return "neutral" as Tone;
  const k = Object.keys(REASON_TONE).find((key) => r.includes(key));
  return k ? REASON_TONE[k] : r.includes("exceeded") || r.includes("timeout") ? ("amber" as Tone) : ("neutral" as Tone);
};
export const ReasonBadge = ({ reason }: { reason: string | null }) =>
  reason ? <Badge tone={reasonTone(reason)}>{reasonLabel(reason)}</Badge> : <span className="text-muted-foreground">–</span>;

const OP_TONE: Record<string, Tone> = { succeeded: "green", pending: "amber", dead_letter: "red", completed: "green", running: "blue", initialized: "neutral" };

function csv(rows: CallLogSummary[]) {
  const head = ["call_id", "agent", "version", "channel", "direction", "agent_number", "customer_number", "ended_reason", "started_at", "duration_seconds", "cost_usd"];
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [head, ...rows.map((r) => [r.id, r.workflow_name, r.version_number, r.channel, r.direction, r.assistant_number, r.customer_number, r.ended_reason, r.created_at, r.duration_seconds, r.charge_usd])]
    .map((row) => row.map(esc).join(","))
    .join("\n");
}

function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function LogsView({
  tab,
  items,
  total,
  totalPages,
  page,
  limit,
  snapshotAt,
  error,
  agents,
  numbers,
  exportQuery,
}: {
  tab: LogsTab;
  items: unknown[];
  total: number;
  totalPages: number;
  page: number;
  limit: number;
  snapshotAt: string;
  error: string | null;
  agents: { id: number; name: string }[];
  numbers: string[];
  exportQuery: Record<string, unknown>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [hidden, setHidden] = useState<ColumnId[]>([]);
  const [, tick] = useState(0);

  const params = useMemo(() => Object.fromEntries(sp.entries()), [sp]);
  const callId = Number(params.call) || null;
  const detailId = Number(params.detail) || null;

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(HIDDEN_KEY) ?? "[]");
      if (Array.isArray(saved)) setHidden(saved);
    } catch {}
  }, []);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 15000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => setSelected(new Set()), [items]);

  const set = (patch: Record<string, string | null>, keepPage = false) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    if (!keepPage) next.delete("page");
    const s = next.toString();
    start(() => router.replace(`${pathname}${s ? `?${s}` : ""}`, { scroll: false }));
  };
  const openRow = (key: "call" | "detail", id: number | null) => set({ [key]: id ? String(id) : null }, true);
  const saveHidden = (v: ColumnId[]) => {
    setHidden(v);
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify(v));
    } catch {}
  };

  async function exportAll() {
    setExporting(true);
    setExportError(null);
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(exportQuery)) {
      if (v == null || v === "") continue;
      if (Array.isArray(v)) v.forEach((x) => q.append(k, String(x)));
      else q.set(k, String(v));
    }
    const res = await fetch(`/api/v1/logs/calls/export?${q}`).catch(() => null);
    setExporting(false);
    if (!res?.ok) {
      const body = await res?.json().catch(() => null);
      return setExportError(body?.detail ? String(body.detail) : "Export failed. Try a shorter time range.");
    }
    download(`awaz-${tab}-${new Date().toISOString().slice(0, 10)}.csv`, await res.blob());
  }

  const calls = tab === "calls" || tab === "chat";
  const rows = items as CallLogSummary[];
  const show = (c: ColumnId) => !hidden.includes(c) && !(tab === "chat" && (c === "assistant_number" || c === "customer_number"));
  const sortBy = params.sort === "duration" ? "duration" : "created_at";
  const order = params.order === "asc" ? "asc" : "desc";
  const sortHeader = (key: "created_at" | "duration", label: string) => (
    <button
      type="button"
      onClick={() => set({ sort: key === "created_at" ? null : key, order: sortBy === key && order === "desc" ? "asc" : null })}
      className={`inline-flex items-center gap-1 ${sortBy === key ? "text-foreground" : ""}`}
    >
      {label}
      {sortBy === key ? order === "desc" ? <ArrowDown className="size-3.5" /> : <ArrowUp className="size-3.5" /> : null}
    </button>
  );

  const th = "h-10 px-3 text-left text-xs font-medium whitespace-nowrap text-muted-foreground";
  const td = "px-3 py-3 whitespace-nowrap";
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <div className="flex min-h-svh flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-6 pt-4 sm:px-8">
        <div className="w-full">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-xl font-semibold tracking-tight text-foreground">Logs</h1>
            <div className="flex items-center gap-2">
              <span className="hidden text-[13px] text-muted-foreground sm:inline">Updated {ago(snapshotAt).toLowerCase()}</span>
              <button type="button" onClick={() => start(() => router.refresh())} className={btn("secondary", "sm")}>
                <RefreshCw className={`size-3.5 ${pending ? "animate-spin" : ""}`} /> Refresh
              </button>
              {calls ? (
                selected.size ? (
                  <button type="button" onClick={() => download(`awaz-selected-${selected.size}.csv`, new Blob([csv(rows.filter((r) => selected.has(r.id)))], { type: "text/csv" }))} className={btn("secondary", "sm")}>
                    <Download className="size-3.5" /> Export {selected.size} selected
                  </button>
                ) : (
                  <button type="button" onClick={exportAll} disabled={exporting} className={btn("secondary", "sm")}>
                    {exporting ? <LoaderCircle className="size-3.5 animate-spin" /> : <Download className="size-3.5" />} Export all
                  </button>
                )
              ) : null}
            </div>
          </div>
          <nav role="tablist" className="mt-3 flex gap-1">
            {LOG_TABS.map((t) => {
              const on = t.id === tab;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => set({ tab: t.id === "calls" ? null : t.id, call: null, detail: null, sort: null, order: null, id: null, opstatus: null })}
                  className={`relative h-10 px-3 text-sm transition-colors ${on ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {t.label}
                  {on ? <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-foreground" /> : null}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Filters */}
      <div className="border-b px-6 py-4 sm:px-8">
        {calls ? (
          <FilterBar params={params} set={set} agents={agents} numbers={numbers} chat={tab === "chat"} hidden={hidden} onHidden={saveHidden} />
        ) : (
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Time range</p>
              <select value={params.range ?? "30d"} onChange={(e) => set({ range: e.target.value === "30d" ? null : e.target.value })} className={`${inputBase} h-9 w-[172px]`}>
                {RANGES.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            {tab !== "api" ? (
              <div>
                <p className="mb-1 text-xs text-muted-foreground">Call ID</p>
                <input
                  key={params.id ?? ""}
                  defaultValue={params.id ?? ""}
                  inputMode="numeric"
                  placeholder="Call ID"
                  onKeyDown={(e) => e.key === "Enter" && set({ id: e.currentTarget.value.replace(/\D/g, "") || null })}
                  onBlur={(e) => e.currentTarget.value !== (params.id ?? "") && set({ id: e.currentTarget.value.replace(/\D/g, "") || null })}
                  className={`${inputBase} h-9 w-[150px] font-mono`}
                />
              </div>
            ) : null}
            <div>
              <p className="mb-1 text-xs text-muted-foreground">Status</p>
              <select value={params.opstatus ?? ""} onChange={(e) => set({ opstatus: e.target.value || null })} className={`${inputBase} h-9 w-[172px]`}>
                <option value="">Any</option>
                {(tab === "sessions" ? ["initialized", "running", "completed"] : tab === "webhooks" ? ["pending", "succeeded", "dead_letter"] : ["200", "201", "204", "400", "401", "403", "404", "422", "500"]).map((s) => (
                  <option key={s} value={s}>
                    {s.replace("_", " ")}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
        {exportError ? <div className="mt-3"><ErrorNote>{exportError}</ErrorNote></div> : null}
      </div>

      {/* Table */}
      <div className={`min-h-0 flex-1 overflow-x-auto transition-opacity ${pending ? "opacity-60" : ""}`}>
        {error ? (
          <div className="p-6"><ErrorNote>{error}</ErrorNote></div>
        ) : !items.length ? (
          <EmptyState icon={Bot} title="No logs in this range" body={calls ? "Calls and chats appear here as soon as they start. Try a wider time range or fewer filters." : "Nothing recorded for these filters yet."} />
        ) : calls ? (
          <table className="w-full text-sm">
            <thead className="border-b">
              <tr>
                <th className={`${th} w-10 pl-6 sm:pl-8`}>
                  <input
                    type="checkbox"
                    aria-label="Select all on this page"
                    checked={allSelected}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                    className="size-4 accent-foreground"
                  />
                </th>
                <th className={th}>Call ID</th>
                {show("agent") ? <th className={th}>Agent</th> : null}
                {show("version") ? <th className={th}>Version</th> : null}
                {show("assistant_number") ? <th className={th}>Agent phone number</th> : null}
                {show("customer_number") ? <th className={th}>Customer phone number</th> : null}
                {show("type") ? <th className={th}>Type</th> : null}
                {show("ended") ? <th className={th}>Ended reason</th> : null}
                {show("start") ? <th className={th}>{sortHeader("created_at", "Start time")}</th> : null}
                {show("duration") ? <th className={th}>{sortHeader("duration", "Duration")}</th> : null}
                {show("cost") ? <th className={`${th} pr-6 text-right sm:pr-8`}>Cost</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  onClick={() => openRow("call", r.id)}
                  className={`cursor-pointer border-b transition-colors hover:bg-muted/50 ${callId === r.id ? "bg-muted" : ""}`}
                >
                  <td className={`${td} pl-6 sm:pl-8`} onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Select call ${r.id}`}
                      checked={selected.has(r.id)}
                      onChange={() =>
                        setSelected((s) => {
                          const n = new Set(s);
                          if (n.has(r.id)) n.delete(r.id);
                          else n.add(r.id);
                          return n;
                        })
                      }
                      className="size-4 accent-foreground"
                    />
                  </td>
                  <td className={`${td} font-mono text-xs text-muted-foreground`}>{shortId(r.id)}</td>
                  {show("agent") ? (
                    <td className={td}>
                      <span className="flex items-center gap-1.5 font-medium text-foreground">
                        <Bot className="size-3.5 text-muted-foreground" />
                        <span className="max-w-[200px] truncate">{r.workflow_name}</span>
                      </span>
                      <span className="font-mono text-[11px] text-muted-foreground">agent {r.workflow_id}</span>
                    </td>
                  ) : null}
                  {show("version") ? (
                    <td className={td}>
                      {r.version_number ? <span className="rounded border px-1.5 font-mono text-[11px] leading-5 text-muted-foreground">v{r.version_number}</span> : <span className="text-muted-foreground">–</span>}
                    </td>
                  ) : null}
                  {show("assistant_number") ? <td className={`${td} font-mono text-[13px] text-muted-foreground`}>{r.assistant_number ?? "–"}</td> : null}
                  {show("customer_number") ? <td className={`${td} font-mono text-[13px] text-muted-foreground`}>{r.customer_number ?? "–"}</td> : null}
                  {show("type") ? (
                    <td className={td}>
                      <ChannelBadge channel={r.channel} />
                    </td>
                  ) : null}
                  {show("ended") ? (
                    <td className={td}>{r.is_completed ? <ReasonBadge reason={r.ended_reason} /> : <Badge tone="blue">In progress</Badge>}</td>
                  ) : null}
                  {show("start") ? <td className={`${td} text-foreground`}>{fmtStart(r.created_at)}</td> : null}
                  {show("duration") ? <td className={`${td} tabular-nums text-foreground/80`}>{fmtDuration(r.duration_seconds)}</td> : null}
                  {show("cost") ? <td className={`${td} pr-6 text-right tabular-nums text-foreground/80 sm:pr-8`}>{fmtMoney(r.charge_usd)}</td> : null}
                </tr>
              ))}
            </tbody>
          </table>
        ) : tab === "sessions" ? (
          <table className="w-full text-sm">
            <thead className="border-b">
              <tr>
                {["Session", "Agent", "Version", "Revision", "Status", "Started", "Last activity"].map((h, i) => (
                  <th key={h} className={`${th} ${i === 0 ? "pl-6 sm:pl-8" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(items as SessionLogSummary[]).map((s) => (
                <tr key={s.id} onClick={() => openRow("call", s.workflow_run_id)} className="cursor-pointer border-b transition-colors hover:bg-muted/50">
                  <td className={`${td} pl-6 font-mono text-xs text-muted-foreground sm:pl-8`}>{shortId(s.workflow_run_id)}</td>
                  <td className={`${td} font-medium text-foreground`}>{s.workflow_name}</td>
                  <td className={td}>{s.version_number ? <span className="rounded border px-1.5 font-mono text-[11px] leading-5 text-muted-foreground">v{s.version_number}</span> : "–"}</td>
                  <td className={`${td} tabular-nums text-muted-foreground`}>{s.revision}</td>
                  <td className={td}>
                    <Badge tone={OP_TONE[s.state] ?? "neutral"}>{reasonLabel(s.state)}</Badge>
                  </td>
                  <td className={td}>{fmtStart(s.created_at)}</td>
                  <td className={`${td} text-muted-foreground`}>{ago(s.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : tab === "webhooks" ? (
          <table className="w-full text-sm">
            <thead className="border-b">
              <tr>
                {["Delivery", "Webhook", "Endpoint", "Status", "Attempts", "Last result", "Call", "Created"].map((h, i) => (
                  <th key={h} className={`${th} ${i === 0 ? "pl-6 sm:pl-8" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(items as WebhookLogSummary[]).map((w) => (
                <tr key={w.id} onClick={() => openRow("detail", w.id)} className={`cursor-pointer border-b transition-colors hover:bg-muted/50 ${detailId === w.id ? "bg-muted" : ""}`}>
                  <td className={`${td} pl-6 font-mono text-xs text-muted-foreground sm:pl-8`}>{w.id}</td>
                  <td className={`${td} font-medium text-foreground`}>{w.webhook_name ?? "Webhook"}</td>
                  <td className={`${td} max-w-[280px] truncate font-mono text-xs text-muted-foreground`}>
                    <span className="mr-1.5 rounded border px-1 text-[10px] text-foreground">{w.http_method}</span>
                    {w.endpoint_url}
                  </td>
                  <td className={td}>
                    <Badge tone={OP_TONE[w.status] ?? "neutral"}>{reasonLabel(w.status)}</Badge>
                  </td>
                  <td className={`${td} tabular-nums text-muted-foreground`}>
                    {w.attempt_count}/{w.max_attempts}
                  </td>
                  <td className={`${td} max-w-[220px] truncate text-muted-foreground`}>{w.last_status_code ?? w.last_error ?? "–"}</td>
                  <td className={`${td} font-mono text-xs`}>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openRow("call", w.workflow_run_id);
                      }}
                      className="underline-offset-4 hover:underline"
                    >
                      {shortId(w.workflow_run_id)}
                    </button>
                  </td>
                  <td className={td}>{fmtStart(w.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b">
              <tr>
                {["Request ID", "Method", "Route", "Status", "Duration", "Time"].map((h, i) => (
                  <th key={h} className={`${th} ${i === 0 ? "pl-6 sm:pl-8" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(items as ApiRequestLogSummary[]).map((a) => (
                <tr key={a.id} onClick={() => openRow("detail", a.id)} className={`cursor-pointer border-b transition-colors hover:bg-muted/50 ${detailId === a.id ? "bg-muted" : ""}`}>
                  <td className={`${td} pl-6 font-mono text-xs text-muted-foreground sm:pl-8`}>{a.request_id.slice(0, 12)}</td>
                  <td className={td}>
                    <span className="rounded border px-1.5 font-mono text-[11px] leading-5">{a.method}</span>
                  </td>
                  <td className={`${td} max-w-[360px] truncate font-mono text-xs`}>{a.path}</td>
                  <td className={td}>
                    <Badge tone={a.status_code >= 500 ? "red" : a.status_code >= 400 ? "amber" : "green"}>{a.status_code}</Badge>
                  </td>
                  <td className={`${td} tabular-nums text-muted-foreground`}>{Math.round(a.duration_ms)} ms</td>
                  <td className={td}>{fmtStart(a.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {items.length ? (
        <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 border-t bg-background/95 px-6 py-2.5 text-[13px] text-muted-foreground backdrop-blur sm:px-8">
          <span>{total.toLocaleString("en-IN")} total</span>
          <span className="flex items-center gap-2">
            <button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => set({ page: page > 2 ? String(page - 1) : null }, true)} className={btn("secondary", "sm", "size-8 px-0")}>
              <ChevronLeft className="size-4" />
            </button>
            Page {page} of {Math.max(1, totalPages)}
            <button type="button" aria-label="Next page" disabled={page >= totalPages} onClick={() => set({ page: String(page + 1) }, true)} className={btn("secondary", "sm", "size-8 px-0")}>
              <ChevronRight className="size-4" />
            </button>
          </span>
          <label className="flex items-center gap-2">
            Rows per page
            <select value={limit} onChange={(e) => set({ limit: e.target.value === "25" ? null : e.target.value })} className={`${inputBase} h-8 w-[72px] text-[13px]`}>
              {[10, 25, 50, 100].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {callId ? (
        <CallDrawer
          key={callId}
          runId={callId}
          rowIds={calls ? rows.map((r) => r.id) : (items as SessionLogSummary[]).map((s) => s.workflow_run_id)}
          onNavigate={(id) => openRow("call", id)}
          onClose={() => openRow("call", null)}
        />
      ) : null}
      {detailId && (tab === "webhooks" || tab === "api") ? (
        <OpDetailDrawer key={`${tab}-${detailId}`} kind={tab} id={detailId} onClose={() => openRow("detail", null)} onOpenCall={(id) => set({ detail: null, call: String(id) }, true)} />
      ) : null}
    </div>
  );
}
