"use client";

import { FlaskConical, LoaderCircle, Plus, RefreshCw, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  createToolApiV1ToolsPost,
  deleteToolApiV1ToolsToolUuidDelete,
  refreshMcpToolsApiV1ToolsToolUuidMcpRefreshPost,
  testToolApiV1ToolsToolUuidTestPost,
  updateToolApiV1ToolsToolUuidPut,
  type CreateToolRequest,
  type ToolParameter,
  type ToolTestResponse,
} from "@/client";
import { SwitchRow } from "@/components/app/client";
import { btn, Card, ErrorNote, FormRow, inputCls } from "@/components/app/ui";
import { apiError } from "@/lib/errors";
import { TOOL_KINDS, type ToolInit } from "@/lib/tools";

type Config = Record<string, unknown>;

const s = (v: unknown) => (typeof v === "string" ? v : "");

function MessageFields({ config, set, clips, verb }: { config: Config; set: (k: string, v: unknown) => void; clips: { id: string; transcript: string }[]; verb: string }) {
  const type = s(config.messageType) || "none";
  return (
    <div className="space-y-3">
      <FormRow label={`Say something before ${verb}`} htmlFor="msg-type">
        <select id="msg-type" value={type} onChange={(e) => set("messageType", e.target.value)} className={`${inputCls} h-10`}>
          <option value="none">Nothing</option>
          <option value="custom">Spoken text</option>
          <option value="audio">Audio clip</option>
        </select>
      </FormRow>
      {type === "custom" ? (
        <input
          aria-label="Message"
          value={s(config.customMessage)}
          onChange={(e) => set("customMessage", e.target.value)}
          placeholder="Thanks for calling, have a great day!"
          className={`${inputCls} h-10`}
        />
      ) : null}
      {type === "audio" ? (
        <select aria-label="Audio clip" value={s(config.audioRecordingId)} onChange={(e) => set("audioRecordingId", e.target.value || null)} className={`${inputCls} h-10`}>
          <option value="">Choose a clip…</option>
          {clips.map((c) => (
            <option key={c.id} value={c.id}>
              {c.transcript.slice(0, 80) || c.id}
            </option>
          ))}
        </select>
      ) : null}
    </div>
  );
}

function Parameters({ value, onChange }: { value: ToolParameter[]; onChange: (v: ToolParameter[]) => void }) {
  const upd = (i: number, patch: Partial<ToolParameter>) => onChange(value.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <div className="space-y-2">
      {value.map((p, i) => (
        <div key={i} className="grid gap-2 rounded-md bg-muted p-3 sm:grid-cols-[160px_110px_minmax(0,1fr)_auto_auto]">
          <input aria-label="Name" value={p.name} onChange={(e) => upd(i, { name: e.target.value.replace(/\s+/g, "_") })} placeholder="order_id" className={`${inputCls} h-9 font-mono text-[13px]`} />
          <select aria-label="Type" value={p.type} onChange={(e) => upd(i, { type: e.target.value as ToolParameter["type"] })} className={`${inputCls} h-9`}>
            {["string", "number", "boolean", "object", "array"].map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <input aria-label="Description" value={p.description} onChange={(e) => upd(i, { description: e.target.value })} placeholder="The order number the caller reads out" className={`${inputCls} h-9`} />
          <label className="flex items-center gap-1.5 px-1 text-[12.5px] text-muted-foreground">
            <input type="checkbox" checked={p.required !== false} onChange={(e) => upd(i, { required: e.target.checked })} className="accent-foreground" />
            Required
          </label>
          <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Remove parameter" className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-red-600">
            <Trash2 className="size-4" />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => onChange([...value, { name: "", type: "string", description: "", required: true }])} className={btn("secondary", "sm")}>
        <Plus className="size-3.5" /> Add parameter
      </button>
    </div>
  );
}

function Headers({ value, onChange }: { value: Record<string, string>; onChange: (v: Record<string, string>) => void }) {
  const rows = Object.entries(value);
  const write = (list: [string, string][]) => onChange(Object.fromEntries(list));
  return (
    <div className="space-y-2">
      {rows.map(([k, v], i) => (
        <div key={i} className="grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)_auto]">
          <input aria-label="Header name" value={k} onChange={(e) => write(rows.map((r, j) => (j === i ? [e.target.value, r[1]] : r)))} placeholder="X-Source" className={`${inputCls} h-9 font-mono text-[13px]`} />
          <input aria-label="Header value" value={v} onChange={(e) => write(rows.map((r, j) => (j === i ? [r[0], e.target.value] : r)))} placeholder="awaz" className={`${inputCls} h-9`} />
          <button type="button" onClick={() => write(rows.filter((_, j) => j !== i))} aria-label="Remove header" className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-red-600">
            <Trash2 className="size-4" />
          </button>
        </div>
      ))}
      <button type="button" onClick={() => write([...rows, ["", ""]])} className={btn("secondary", "sm")}>
        <Plus className="size-3.5" /> Add header
      </button>
    </div>
  );
}

function TestBox({ uuid, parameters }: { uuid: string; parameters: ToolParameter[] }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ToolTestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const llm_params = Object.fromEntries(
      parameters.map((p) => {
        const raw = values[p.name] ?? "";
        const v = p.type === "number" ? Number(raw) : p.type === "boolean" ? raw === "true" : raw;
        return [p.name, v];
      }),
    );
    const res = await testToolApiV1ToolsToolUuidTestPost({ path: { tool_uuid: uuid }, body: { llm_params } }).catch(() => null);
    setBusy(false);
    if (!res?.data) return setError(apiError(res?.error, "Test failed."));
    setResult(res.data);
  }

  return (
    <Card className="p-5">
      <h2 className="text-[15px] font-medium text-foreground">Test request</h2>
      <p className="mt-0.5 text-[13px] text-muted-foreground">Send a real request with sample values, exactly as the agent would. Uses the saved version.</p>
      {parameters.length ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {parameters.map((p) => (
            <FormRow key={p.name} label={p.name} htmlFor={`t-${p.name}`}>
              <input id={`t-${p.name}`} value={values[p.name] ?? ""} onChange={(e) => setValues({ ...values, [p.name]: e.target.value })} className={`${inputCls} h-9`} />
            </FormRow>
          ))}
        </div>
      ) : null}
      <button type="button" onClick={run} disabled={busy} className={btn("secondary", "sm", "mt-4")}>
        {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <FlaskConical className="size-3.5" />} Send test request
      </button>
      {error ? <div className="mt-3"><ErrorNote>{error}</ErrorNote></div> : null}
      {result ? (
        <div className="mt-4 space-y-2 text-[12.5px]">
          <p className="font-mono text-foreground/80">
            <span className={result.status_code && result.status_code < 400 ? "text-emerald-700" : "text-red-600"}>{result.status_code ?? result.status}</span> ·{" "}
            {result.request_method} {result.request_url} · {result.duration_ms} ms
          </p>
          {result.hint ? <p className="text-amber-800">{result.hint}</p> : null}
          <pre className="max-h-72 overflow-auto rounded-md bg-zinc-950 p-4 font-mono text-[12px] leading-relaxed text-zinc-100">
            {JSON.stringify(result.data ?? result.error, null, 2)}
          </pre>
        </div>
      ) : null}
    </Card>
  );
}

export function ToolForm({
  init,
  credentials,
  clips,
}: {
  init: ToolInit;
  credentials: { uuid: string; name: string }[];
  clips: { id: string; transcript: string }[];
}) {
  const router = useRouter();
  const [name, setName] = useState(init.name);
  const [description, setDescription] = useState(init.description);
  const [config, setConfigState] = useState<Config>(init.config);
  const [busy, setBusy] = useState<"save" | "delete" | "refresh" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const set = (k: string, v: unknown) => setConfigState((c) => ({ ...c, [k]: v }));
  const kind = TOOL_KINDS[init.kind];

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy("save");
    setError(null);
    const definition = { type: init.kind, config: init.kind === "calculator" ? undefined : config } as CreateToolRequest["definition"];
    const res = init.uuid
      ? await updateToolApiV1ToolsToolUuidPut({ path: { tool_uuid: init.uuid }, body: { name, description, definition } }).catch(() => null)
      : await createToolApiV1ToolsPost({ body: { name, description, category: init.kind, definition } }).catch(() => null);
    setBusy(null);
    if (!res?.data) return setError(apiError(res?.error, "Couldn't save the tool."));
    if (!init.uuid) {
      router.replace(`/tools/${res.data.tool_uuid}`);
    } else {
      setConfigState((res.data.definition as { config?: Config }).config ?? config);
      setSavedAt(Date.now());
    }
    router.refresh();
  }

  async function remove() {
    if (!init.uuid || !window.confirm(`Delete "${name}"? Agents using it lose access.`)) return;
    setBusy("delete");
    const res = await deleteToolApiV1ToolsToolUuidDelete({ path: { tool_uuid: init.uuid } }).catch(() => null);
    setBusy(null);
    if (res && !res.error) {
      router.push("/tools");
      router.refresh();
    } else setError(apiError(res?.error, "Couldn't delete the tool."));
  }

  async function refreshMcp() {
    if (!init.uuid) return;
    setBusy("refresh");
    const res = await refreshMcpToolsApiV1ToolsToolUuidMcpRefreshPost({ path: { tool_uuid: init.uuid } }).catch(() => null);
    setBusy(null);
    if (res?.data) setConfigState(((res.data as { definition?: { config?: Config } }).definition?.config ?? config) as Config);
    else setError(apiError(res?.error, "Couldn't reach the MCP server."));
  }

  const credentialSelect = (key: string) => (
    <FormRow
      label="Authentication"
      htmlFor="cred"
      hint={
        <>
          Stored credentials are encrypted.{" "}
          <Link href="/integrations/credentials" className="text-foreground hover:underline">
            Manage credentials
          </Link>
        </>
      }
    >
      <select id="cred" value={s(config[key])} onChange={(e) => set(key, e.target.value || null)} className={`${inputCls} h-10`}>
        <option value="">None</option>
        {credentials.map((c) => (
          <option key={c.uuid} value={c.uuid}>
            {c.name}
          </option>
        ))}
      </select>
    </FormRow>
  );

  const discovered = (Array.isArray(config.discovered_tools) ? config.discovered_tools : []) as { name?: string; description?: string }[];

  return (
    <div className="space-y-5">
      <form onSubmit={save} className="space-y-5">
        <Card className="space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormRow label="Name" htmlFor="tool-name">
              <input id="tool-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder={`My ${kind.label.toLowerCase()} tool`} className={`${inputCls} h-10`} />
            </FormRow>
          </div>
          <FormRow label="When should the agent use it?" htmlFor="tool-desc" hint="The model reads this to decide when to call the tool. Be specific.">
            <textarea id="tool-desc" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} className={`${inputCls} resize-y py-2.5`} />
          </FormRow>
        </Card>

        {init.kind === "end_call" ? (
          <Card className="space-y-4 p-5">
            <MessageFields config={config} set={set} clips={clips} verb="hanging up" />
            <SwitchRow
              title="Record why the call ended"
              body="The model gives a reason, saved as the call outcome and tag."
              checked={config.endCallReason === true}
              onChange={(v) => set("endCallReason", v)}
            />
          </Card>
        ) : null}

        {init.kind === "transfer_call" ? (
          <Card className="space-y-4 p-5">
            <FormRow label="Transfer to" htmlFor="dest" hint="A phone number with country code, a SIP address, or a variable like {{initial_context.agent_number}}.">
              <input id="dest" required value={s(config.destination)} onChange={(e) => set("destination", e.target.value)} placeholder="+919876543210" className={`${inputCls} h-10`} />
            </FormRow>
            <MessageFields config={config} set={set} clips={clips} verb="transferring" />
            <div className="grid gap-4 sm:grid-cols-2">
              <FormRow label="Ring for (seconds)" htmlFor="timeout">
                <input id="timeout" type="number" min={5} max={120} value={typeof config.timeout === "number" ? config.timeout : 30} onChange={(e) => set("timeout", Number(e.target.value))} className={`${inputCls} h-10`} />
              </FormRow>
              <FormRow label="Outcome to record" htmlFor="disp" hint="Optional.">
                <input id="disp" value={s(config.call_disposition)} onChange={(e) => set("call_disposition", e.target.value || null)} placeholder="TRANSFERRED" className={`${inputCls} h-10 font-mono text-[13px]`} />
              </FormRow>
            </div>
          </Card>
        ) : null}

        {init.kind === "http_api" ? (
          <>
            <Card className="space-y-4 p-5">
              <div className="grid gap-2 sm:grid-cols-[120px_minmax(0,1fr)]">
                <FormRow label="Method" htmlFor="method">
                  <select id="method" value={s(config.method) || "POST"} onChange={(e) => set("method", e.target.value)} className={`${inputCls} h-10`}>
                    {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                      <option key={m}>{m}</option>
                    ))}
                  </select>
                </FormRow>
                <FormRow label="URL" htmlFor="url">
                  <input id="url" type="url" required value={s(config.url)} onChange={(e) => set("url", e.target.value)} placeholder="https://api.example.com/orders/lookup" className={`${inputCls} h-10`} />
                </FormRow>
              </div>
              {credentialSelect("credential_uuid")}
              <div className="grid gap-4 sm:grid-cols-2">
                <FormRow label="Timeout (ms)" htmlFor="tms">
                  <input id="tms" type="number" min={500} step={500} value={typeof config.timeout_ms === "number" ? config.timeout_ms : 5000} onChange={(e) => set("timeout_ms", Number(e.target.value))} className={`${inputCls} h-10`} />
                </FormRow>
                <FormRow label="Say while waiting" htmlFor="filler" hint="Optional filler line so the caller isn't left in silence.">
                  <input id="filler" value={s(config.customMessage)} onChange={(e) => set("customMessage", e.target.value || null)} placeholder="One moment, let me check that." className={`${inputCls} h-10`} />
                </FormRow>
              </div>
            </Card>
            <Card className="space-y-3 p-5">
              <div>
                <h2 className="text-[15px] font-medium text-foreground">Parameters</h2>
                <p className="mt-0.5 text-[13px] text-muted-foreground">Values the agent fills in from the conversation. Sent as the JSON body, or as query params for GET.</p>
              </div>
              <Parameters value={(config.parameters as ToolParameter[]) ?? []} onChange={(v) => set("parameters", v)} />
            </Card>
            <Card className="space-y-3 p-5">
              <h2 className="text-[15px] font-medium text-foreground">Headers</h2>
              <Headers value={(config.headers as Record<string, string>) ?? {}} onChange={(v) => set("headers", v)} />
            </Card>
          </>
        ) : null}

        {init.kind === "mcp" ? (
          <Card className="space-y-4 p-5">
            <FormRow label="Server URL" htmlFor="mcp-url" hint="Streamable HTTP endpoint of your MCP server.">
              <input id="mcp-url" type="url" required value={s(config.url)} onChange={(e) => set("url", e.target.value)} placeholder="https://mcp.example.com/mcp" className={`${inputCls} h-10`} />
            </FormRow>
            {credentialSelect("credential_uuid")}
            <FormRow label="Only expose these tools" htmlFor="mcp-filter" hint="Comma separated. Leave empty to expose every tool on the server.">
              <input
                id="mcp-filter"
                value={((config.tools_filter as string[]) ?? []).join(", ")}
                onChange={(e) => set("tools_filter", e.target.value.split(",").map((x) => x.trim()).filter(Boolean))}
                className={`${inputCls} h-10`}
              />
            </FormRow>
            {init.uuid ? (
              <div className="rounded-md bg-muted p-4">
                <div className="flex items-center justify-between">
                  <p className="text-[13px] font-medium text-foreground/80">Tools on this server ({discovered.length})</p>
                  <button type="button" onClick={refreshMcp} disabled={busy !== null} className={btn("secondary", "sm")}>
                    {busy === "refresh" ? <LoaderCircle className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Refresh
                  </button>
                </div>
                {discovered.length ? (
                  <ul className="mt-3 space-y-1.5">
                    {discovered.map((t) => (
                      <li key={t.name} className="text-[13px]">
                        <span className="font-mono text-foreground">{t.name}</span>
                        {t.description ? <span className="text-muted-foreground"> · {t.description}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-[12.5px] text-muted-foreground">Nothing discovered yet. Save, then refresh.</p>
                )}
              </div>
            ) : null}
          </Card>
        ) : null}

        {error ? <ErrorNote>{error}</ErrorNote> : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          {init.uuid ? (
            <button type="button" onClick={remove} disabled={busy !== null} className={btn("danger", "sm")}>
              {busy === "delete" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />} Delete tool
            </button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-3">
            {savedAt ? <span className="text-[13px] text-emerald-700">Saved</span> : null}
            <button type="submit" disabled={busy !== null} className={btn("primary")}>
              {busy === "save" ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {init.uuid ? "Save changes" : "Create tool"}
            </button>
          </div>
        </div>
      </form>

      {init.uuid && init.kind === "http_api" ? <TestBox uuid={init.uuid} parameters={(config.parameters as ToolParameter[]) ?? []} /> : null}
    </div>
  );
}
