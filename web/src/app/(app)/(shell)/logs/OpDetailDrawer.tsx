"use client";

import { LoaderCircle, X } from "lucide-react";
import { useEffect, useState } from "react";

import { apiLogApiV1LogsApiLogIdGet, webhookApiV1LogsWebhooksDeliveryIdGet } from "@/client";
import { CopyButton } from "@/components/app/client";
import { Badge, btn, ErrorNote } from "@/components/app/ui";
import { fmtStart, reasonLabel } from "@/lib/logs";

import { Sheet } from "./Sheet";

/** Detail panel for one webhook delivery or one API request. */
export function OpDetailDrawer({
  kind,
  id,
  onClose,
  onOpenCall,
}: {
  kind: "webhooks" | "api";
  id: number;
  onClose: () => void;
  onOpenCall: (runId: number) => void;
}) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const req =
      kind === "webhooks"
        ? webhookApiV1LogsWebhooksDeliveryIdGet({ path: { delivery_id: id } })
        : apiLogApiV1LogsApiLogIdGet({ path: { log_id: id } });
    req
      .then((r) => (r.data ? setData(r.data as Record<string, unknown>) : setError("Not found.")))
      .catch(() => setError("Couldn't load this entry."));
  }, [kind, id]);

  const rows: [string, React.ReactNode][] = data
    ? kind === "webhooks"
      ? [
          ["Webhook", String(data.webhook_name ?? "Webhook")],
          ["Endpoint", <span key="e" className="font-mono text-xs break-all">{`${data.http_method} ${data.endpoint_url}`}</span>],
          ["Status", <Badge key="s" tone={data.status === "succeeded" ? "green" : data.status === "dead_letter" ? "red" : "amber"}>{reasonLabel(String(data.status))}</Badge>],
          ["Attempts", `${data.attempt_count} of ${data.max_attempts}`],
          ["Last status code", String(data.last_status_code ?? "–")],
          ["Last error", String(data.last_error ?? "–")],
          ["Next attempt", data.scheduled_for ? fmtStart(String(data.scheduled_for)) : "–"],
          ["Created", fmtStart(String(data.created_at))],
          ["Updated", fmtStart(String(data.updated_at))],
          [
            "Call",
            <button key="c" type="button" onClick={() => onOpenCall(Number(data.workflow_run_id))} className="font-mono text-xs underline underline-offset-4">
              Open call {String(data.workflow_run_id)}
            </button>,
          ],
        ]
      : [
          ["Request ID", <span key="r" className="flex items-center gap-1 font-mono text-xs">{String(data.request_id)}<CopyButton value={String(data.request_id)} label="Copy request ID" /></span>],
          ["Method", String(data.method)],
          ["Route", <span key="p" className="font-mono text-xs">{String(data.path)}</span>],
          ["Status", <Badge key="s" tone={Number(data.status_code) >= 500 ? "red" : Number(data.status_code) >= 400 ? "amber" : "green"}>{String(data.status_code)}</Badge>],
          ["Duration", `${Math.round(Number(data.duration_ms))} ms`],
          ["Time", fmtStart(String(data.created_at))],
        ]
    : [];
  const json = kind === "webhooks" ? data?.payload : data?.query;

  return (
    <Sheet onClose={onClose} width={640} label={kind === "webhooks" ? "Webhook delivery" : "API request"}>
      <div className="flex items-center justify-between border-b px-5 py-3.5">
        <h2 className="text-base font-semibold text-foreground">{kind === "webhooks" ? `Webhook delivery ${id}` : `API request ${id}`}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className={btn("ghost", "sm", "size-8 px-0")}>
          <X className="size-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        {!data && !error ? <LoaderCircle className="size-5 animate-spin text-muted-foreground" /> : null}
        {data ? (
          <>
            <dl className="divide-y rounded-lg border">
              {rows.map(([k, v]) => (
                <div key={k} className="flex gap-4 px-4 py-2.5 text-sm">
                  <dt className="w-36 shrink-0 text-muted-foreground">{k}</dt>
                  <dd className="min-w-0 text-foreground">{v}</dd>
                </div>
              ))}
            </dl>
            {json && typeof json === "object" ? (
              <div>
                <p className="mb-2 text-sm font-medium text-foreground">{kind === "webhooks" ? "Payload" : "Query"}</p>
                <pre className="max-h-[50vh] overflow-auto rounded-lg bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-100">{JSON.stringify(json, null, 2)}</pre>
              </div>
            ) : null}
            {kind === "api" ? <p className="text-xs text-muted-foreground">Request and response bodies and headers aren&apos;t recorded.</p> : null}
          </>
        ) : null}
      </div>
    </Sheet>
  );
}
