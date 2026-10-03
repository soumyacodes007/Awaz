"use client";

import { Brain, Database, KeyRound, LineChart, LoaderCircle, MessageCircle, Plug, Users } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  deleteLangfuseCredentialsApiV1OrganizationsLangfuseCredentialsDelete,
  getPreferencesApiV1OrganizationsPreferencesGet,
  saveLangfuseCredentialsApiV1OrganizationsLangfuseCredentialsPost,
  savePreferencesApiV1OrganizationsPreferencesPut,
  testCallEventsConnectionApiV1OrganizationsCallEventsTestPost,
  type CallEventsSettings,
} from "@/client";
import { Modal, SwitchRow } from "@/components/app/client";
import { PageBody, PageHeader } from "@/components/app/PageHeader";
import { Badge, btn, ErrorNote, FormRow, inputCls } from "@/components/app/ui";
import { apiError } from "@/lib/errors";

function Tile({
  icon: Icon,
  color,
  title,
  body,
  status,
  action,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties; strokeWidth?: number }>;
  color: string;
  title: string;
  body: string;
  status?: React.ReactNode;
  action: React.ReactNode;
}) {
  return (
    <div className="flex flex-col rounded-lg bg-white p-5 border">
      <div className="flex items-start justify-between gap-3">
        <span className="flex size-10 items-center justify-center rounded-md bg-muted">
          <Icon className="size-5" style={{ color }} strokeWidth={1.75} />
        </span>
        {status}
      </div>
      <p className="mt-4 text-[15px] text-foreground">{title}</p>
      <p className="mt-1 flex-1 text-[13px] leading-relaxed text-muted-foreground">{body}</p>
      <div className="mt-4">{action}</div>
    </div>
  );
}

function LangfuseDialog({ open, onClose, current }: { open: boolean; onClose: () => void; current: Record<string, unknown> | null }) {
  const router = useRouter();
  const [v, setV] = useState({
    host: String(current?.host ?? "https://cloud.langfuse.com"),
    public_key: String(current?.public_key ?? ""),
    secret_key: "",
    project_id: String(current?.project_id ?? ""),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const configured = current?.configured === true;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await saveLangfuseCredentialsApiV1OrganizationsLangfuseCredentialsPost({
      body: { ...v, secret_key: v.secret_key || String(current?.secret_key ?? "") },
    }).catch(() => null);
    setBusy(false);
    if (!res || res.error) return setError(apiError(res?.error, "Couldn't save Langfuse settings."));
    onClose();
    router.refresh();
  }

  async function disconnect() {
    setBusy(true);
    await deleteLangfuseCredentialsApiV1OrganizationsLangfuseCredentialsDelete().catch(() => null);
    setBusy(false);
    onClose();
    router.refresh();
  }

  return (
    <Modal open={open} onClose={onClose} title="Langfuse tracing" sub="Send every LLM call from your agents to Langfuse for debugging and cost tracking.">
      <form onSubmit={save} className="space-y-4">
        <FormRow label="Host" htmlFor="lf-host">
          <input id="lf-host" required value={v.host} onChange={(e) => setV({ ...v, host: e.target.value })} className={`${inputCls} h-10`} />
        </FormRow>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormRow label="Public key" htmlFor="lf-pk">
            <input id="lf-pk" required value={v.public_key} onChange={(e) => setV({ ...v, public_key: e.target.value })} placeholder="pk-lf-…" className={`${inputCls} h-10 font-mono text-[13px]`} />
          </FormRow>
          <FormRow label="Secret key" htmlFor="lf-sk">
            <input
              id="lf-sk"
              type="password"
              required={!configured}
              value={v.secret_key}
              onChange={(e) => setV({ ...v, secret_key: e.target.value })}
              placeholder={configured ? "Saved" : "sk-lf-…"}
              className={`${inputCls} h-10 font-mono text-[13px]`}
            />
          </FormRow>
        </div>
        <FormRow label="Project ID" htmlFor="lf-proj">
          <input id="lf-proj" required value={v.project_id} onChange={(e) => setV({ ...v, project_id: e.target.value })} className={`${inputCls} h-10 font-mono text-[13px]`} />
        </FormRow>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        <div className="flex items-center justify-between">
          {configured ? (
            <button type="button" onClick={disconnect} disabled={busy} className={btn("danger", "sm")}>
              Disconnect
            </button>
          ) : (
            <span />
          )}
          <button type="submit" disabled={busy} className={btn("primary")}>
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : null} Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

function BigQueryDialog({ open, onClose, current }: { open: boolean; onClose: () => void; current: CallEventsSettings }) {
  const router = useRouter();
  const cfg = (current.sink_type === "bigquery" ? current.config : {}) as Record<string, string>;
  const [enabled, setEnabled] = useState(current.enabled ?? false);
  const [v, setV] = useState({ table: cfg.table ?? "", client_email: cfg.client_email ?? "", private_key: cfg.private_key ?? "" });
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const settings = (): CallEventsSettings => ({ enabled, sink_type: "bigquery", config: { ...v, auth_mode: "service_account" } });

  async function test() {
    setBusy("test");
    setMsg(null);
    const res = await testCallEventsConnectionApiV1OrganizationsCallEventsTestPost({ body: settings() }).catch(() => null);
    setBusy(null);
    setMsg(res?.data ? { ok: true, text: res.data.message } : { ok: false, text: apiError(res?.error, "Connection failed.") });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy("save");
    setMsg(null);
    const prefs = await getPreferencesApiV1OrganizationsPreferencesGet().catch(() => null);
    const res = await savePreferencesApiV1OrganizationsPreferencesPut({ body: { ...(prefs?.data ?? {}), call_events: settings() } }).catch(() => null);
    setBusy(null);
    if (!res || res.error) return setMsg({ ok: false, text: apiError(res?.error, "Couldn't save.") });
    onClose();
    router.refresh();
  }

  return (
    <Modal open={open} onClose={onClose} width={600} title="Stream call events to BigQuery" sub="Every call's events land in your own table for analytics and audits.">
      <form onSubmit={save} className="space-y-4">
        <SwitchRow title="Enabled" checked={enabled} onChange={setEnabled} />
        <FormRow label="Table" htmlFor="bq-table" hint="project.dataset.table">
          <input id="bq-table" required value={v.table} onChange={(e) => setV({ ...v, table: e.target.value })} placeholder="my-project.voice.call_events" className={`${inputCls} h-10 font-mono text-[13px]`} />
        </FormRow>
        <FormRow label="Service account email" htmlFor="bq-email">
          <input id="bq-email" required value={v.client_email} onChange={(e) => setV({ ...v, client_email: e.target.value })} placeholder="awaz@my-project.iam.gserviceaccount.com" className={`${inputCls} h-10`} />
        </FormRow>
        <FormRow label="Private key" htmlFor="bq-key">
          <textarea
            id="bq-key"
            rows={4}
            value={v.private_key === "********" ? "" : v.private_key}
            placeholder={v.private_key === "********" ? "Saved. Paste a new key to replace it." : "-----BEGIN PRIVATE KEY-----"}
            onChange={(e) => setV({ ...v, private_key: e.target.value || (cfg.private_key ?? "") })}
            className={`${inputCls} resize-y py-2.5 font-mono text-[12px]`}
          />
        </FormRow>
        {msg ? (
          msg.ok ? <p className="rounded-md bg-emerald-50 px-3.5 py-2.5 text-[13px] text-emerald-700">{msg.text}</p> : <ErrorNote>{msg.text}</ErrorNote>
        ) : null}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={test} disabled={busy !== null} className={btn("secondary")}>
            {busy === "test" ? <LoaderCircle className="size-4 animate-spin" /> : null} Test connection
          </button>
          <button type="submit" disabled={busy !== null} className={btn("primary")}>
            {busy === "save" ? <LoaderCircle className="size-4 animate-spin" /> : null} Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function IntegrationsView({
  modelSummary,
  credentialCount,
  langfuse,
  callEvents,
  mcpCount,
}: {
  modelSummary: string | null;
  credentialCount: number;
  langfuse: Record<string, unknown> | null;
  callEvents: CallEventsSettings;
  mcpCount: number;
}) {
  const [dialog, setDialog] = useState<"langfuse" | "bigquery" | null>(null);
  const connected = <Badge tone="green">Connected</Badge>;
  const bq = callEvents.sink_type === "bigquery" && callEvents.enabled;

  return (
    <>
      <PageHeader title="Integrations" sub="Connect model providers, observability and your own systems." />
      <PageBody>
        <section>
          <h2 className="mb-3 text-[13px] font-medium tracking-[0.06em] text-muted-foreground uppercase">AI models</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Tile
              icon={Brain}
              color="#18181b"
              title="Model providers"
              body={modelSummary ? `Workspace default: ${modelSummary}.` : "Pick the speech-to-text, LLM and voice providers your agents use."}
              status={modelSummary ? connected : <Badge tone="amber">Not set</Badge>}
              action={
                <Link href="/integrations/models" className={btn("secondary", "sm")}>
                  Configure
                </Link>
              }
            />
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-[13px] font-medium tracking-[0.06em] text-muted-foreground uppercase">Tools and data</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Tile
              icon={KeyRound}
              color="#18181b"
              title="Credentials"
              body="API keys and tokens that tools and webhooks use to call your systems. Stored encrypted."
              status={credentialCount ? <Badge>{credentialCount} saved</Badge> : null}
              action={
                <Link href="/integrations/credentials" className={btn("secondary", "sm")}>
                  Manage
                </Link>
              }
            />
            <Tile
              icon={Plug}
              color="#18181b"
              title="MCP servers"
              body="Give agents tools from any Model Context Protocol server."
              status={mcpCount ? <Badge>{mcpCount} connected</Badge> : null}
              action={
                <Link href="/tools/new?kind=mcp" className={btn("secondary", "sm")}>
                  Add server
                </Link>
              }
            />
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-[13px] font-medium tracking-[0.06em] text-muted-foreground uppercase">Observability</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Tile
              icon={LineChart}
              color="#18181b"
              title="Langfuse"
              body="Trace every LLM call: prompts, completions, tokens and latency."
              status={langfuse?.configured ? connected : null}
              action={
                <button type="button" onClick={() => setDialog("langfuse")} className={btn("secondary", "sm")}>
                  {langfuse?.configured ? "Edit" : "Connect"}
                </button>
              }
            />
            <Tile
              icon={Database}
              color="#18181b"
              title="BigQuery"
              body="Stream call events into your warehouse."
              status={bq ? connected : null}
              action={
                <button type="button" onClick={() => setDialog("bigquery")} className={btn("secondary", "sm")}>
                  {bq ? "Edit" : "Connect"}
                </button>
              }
            />
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-[13px] font-medium tracking-[0.06em] text-muted-foreground uppercase">Planned</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {[
              { icon: Users, color: "#18181b", title: "CRMs", body: "Zoho, HubSpot, Salesforce and LeadSquared: look up callers and log calls automatically." },
              { icon: MessageCircle, color: "#18181b", title: "WhatsApp", body: "Send a follow-up message with the call summary after every call." },
            ].map((t) => (
              <Tile key={t.title} {...t} status={<Badge tone="violet">Soon</Badge>} action={<span className="text-[12.5px] text-muted-foreground/70">Not available yet</span>} />
            ))}
          </div>
          <p className="mt-3 text-[12.5px] text-muted-foreground">Until then, per-agent webhooks (agent → Advanced) can push call results anywhere.</p>
        </section>
      </PageBody>

      {dialog === "langfuse" ? <LangfuseDialog open onClose={() => setDialog(null)} current={langfuse} /> : null}
      {dialog === "bigquery" ? <BigQueryDialog open onClose={() => setDialog(null)} current={callEvents} /> : null}
    </>
  );
}
