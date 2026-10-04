"use client";

import { AlertTriangle, BarChart3, Bot, LoaderCircle, ScrollText, Search, Settings2, Wrench } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  convertAgentApiV1AgentsAgentIdConvertPost,
  duplicateWorkflowEndpointApiV1WorkflowWorkflowIdDuplicatePost,
  publishAgentApiV1AgentsAgentIdPublishPost,
  updateAgentApiV1AgentsAgentIdPut,
  updateWorkflowStatusApiV1WorkflowWorkflowIdStatusPut,
  type UpdateAgentRequest,
} from "@/client";
import { Tabs } from "@/components/app/client";
import { btn } from "@/components/app/ui";
import { type Agent, forServer, toAgent } from "@/lib/agent";
import { apiError } from "@/lib/errors";
import { matchPreset, type Preset } from "@/lib/estimates";
import { agentOverride, effectiveOf, type ModelConfigV2, type Service } from "@/lib/models";

import { AdvancedTab } from "./AdvancedTab";
import { AgentTab } from "./AgentTab";
import { AnalysisTab } from "./AnalysisTab";
import { CallsTab } from "./CallsTab";
import { EditorHeader, type Version } from "./EditorHeader";
import { ModelDialog } from "./ModelDialog";
import { TestPanel } from "./TestPanel";
import { ToolsTab } from "./ToolsTab";
import type { Configs, EditorProps } from "./types";

type Tab = "agent" | "logs" | "tools" | "analysis" | "advanced";
const TABS = [
  { id: "agent" as const, label: "Agent", icon: Bot },
  { id: "logs" as const, label: "Logs", icon: ScrollText },
  { id: "tools" as const, label: "Tools", icon: Wrench },
  { id: "analysis" as const, label: "Analysis", icon: BarChart3 },
  { id: "advanced" as const, label: "Advanced", icon: Settings2 },
];

type SaveState = "saved" | "dirty" | "saving" | "error";
export type UpdateAgent = (patch: Partial<Agent>) => void;

export function AgentEditor(props: EditorProps) {
  const initial = props.agent;
  const router = useRouter();

  const [name, setName] = useState(initial.name);
  const [agent, setAgent] = useState<Agent>(initial.spec);
  const [configs, setConfigs] = useState<Configs>(initial.configs);
  const [multiStep, setMultiStep] = useState(initial.kind === "multi_step");
  const [version, setVersion] = useState({ number: initial.versionNumber, status: initial.versionStatus });
  const [save, setSave] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("agent");
  const [testing, setTesting] = useState<"chat" | "phone" | null>(null);
  const [modelsOpen, setModelsOpen] = useState<Service | null>(null);
  const [busy, setBusy] = useState<"publish" | "convert" | null>(null);

  const override = agentOverride(configs);
  const effective = override ? (effectiveOf(override) ?? props.org.effective) : props.org.effective;

  const update: UpdateAgent = useCallback((patch) => setAgent((a) => ({ ...a, ...patch })), []);
  const setConfig = useCallback((key: string, value: unknown) => {
    setConfigs((c) => {
      const next = { ...c };
      if (value === undefined || value === "") delete next[key];
      else next[key] = value;
      return next;
    });
  }, []);

  // ── Autosave ────────────────────────────────────────────────────────
  // Every change is written to the agent's draft after a short pause.
  // Publish promotes the draft to the version real calls use.
  const saved = useRef({ name: initial.name, agent: JSON.stringify(initial.spec), configs: JSON.stringify(initial.configs) });
  const latest = useRef({ name, agent, configs });
  latest.current = { name, agent, configs };
  const inflight = useRef<Promise<boolean> | null>(null);

  const isDirty = () => {
    const c = latest.current;
    return c.name !== saved.current.name || JSON.stringify(c.agent) !== saved.current.agent || JSON.stringify(c.configs) !== saved.current.configs;
  };

  const flush = useCallback(async (): Promise<boolean> => {
    if (inflight.current) await inflight.current;
    const cur = latest.current;
    const agentJson = JSON.stringify(cur.agent);
    const cfgJson = JSON.stringify(cur.configs);
    const body: UpdateAgentRequest = {};
    if (cur.name !== saved.current.name) body.name = cur.name.trim() || "Untitled agent";
    if (agentJson !== saved.current.agent) body.agent = forServer(cur.agent);
    if (cfgJson !== saved.current.configs) body.settings = cur.configs as UpdateAgentRequest["settings"];
    if (!Object.keys(body).length) return true;

    setSave("saving");
    const run = (async () => {
      const res = await updateAgentApiV1AgentsAgentIdPut({ path: { agent_id: initial.id }, body }).catch(() => null);
      if (!res?.data) {
        setSave("error");
        setSaveError(apiError(res?.error, "Couldn't save. Check your connection."));
        return false;
      }
      saved.current = { name: cur.name, agent: agentJson, configs: cfgJson };

      // The backend fills in what only it can generate (the API trigger's URL
      // path, Dograh's default QA prompt); adopt those without re-saving.
      const server = toAgent(res.data.agent);
      const adopt = (a: Agent): Agent => ({
        ...a,
        api_trigger: { ...a.api_trigger, path: a.api_trigger.path ?? server.api_trigger.path },
        quality_review: a.quality_review && server.quality_review ? { ...a.quality_review, system_prompt: a.quality_review.system_prompt || server.quality_review.system_prompt } : a.quality_review,
      });
      const adopted = adopt(cur.agent);
      if (JSON.stringify(adopted) !== agentJson) {
        saved.current.agent = JSON.stringify(adopted);
        setAgent(adopt);
      }
      setVersion({ number: res.data.version_number, status: res.data.version_status });
      // Name and model changes show in the agent list, which is server-rendered.
      if (body.name || body.settings) router.refresh();
      setSaveError(null);
      setSave(isDirty() ? "dirty" : "saved");
      return true;
    })();
    inflight.current = run;
    const ok = await run;
    inflight.current = null;
    return ok;
  }, [initial.id, router]);

  useEffect(() => {
    if (!isDirty()) {
      // A save can finish before the state it saved is rendered; clear a stale "dirty".
      setSave((s) => (s === "dirty" ? "saved" : s));
      return;
    }
    setSave("dirty");
    const t = setTimeout(flush, 900);
    return () => clearTimeout(t);
  }, [name, agent, configs, flush]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        flush();
      }
    };
    const onLeave = (e: BeforeUnloadEvent) => {
      if (isDirty()) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onLeave);
    };
  }, [flush]);

  const beforeTest = useCallback(async () => {
    await flush();
  }, [flush]);

  async function publish() {
    setBusy("publish");
    const ok = await flush();
    if (ok) {
      const res = await publishAgentApiV1AgentsAgentIdPublishPost({ path: { agent_id: initial.id } }).catch(() => null);
      if (res?.data) {
        setVersion({ number: res.data.version_number, status: "published" });
        router.refresh();
      } else {
        setSaveError(apiError(res?.error, "Couldn't publish."));
        setSave("error");
      }
    }
    setBusy(null);
  }

  // The backend merges a multi-step flow into one prompt and saves a draft.
  async function convert() {
    setBusy("convert");
    const res = await convertAgentApiV1AgentsAgentIdConvertPost({ path: { agent_id: initial.id } }).catch(() => null);
    setBusy(null);
    if (!res?.data) {
      setSaveError(apiError(res?.error, "Couldn't convert this agent."));
      return setSave("error");
    }
    const converted = toAgent(res.data.agent);
    saved.current = { ...saved.current, agent: JSON.stringify(converted), configs: JSON.stringify(res.data.settings) };
    setAgent(converted);
    setConfigs(res.data.settings);
    setMultiStep(res.data.kind === "multi_step");
    setVersion({ number: res.data.version_number, status: res.data.version_status });
    router.refresh();
  }

  async function archive() {
    if (!window.confirm(`Archive "${name}"? It will stop taking calls.`)) return;
    const res = await updateWorkflowStatusApiV1WorkflowWorkflowIdStatusPut({ path: { workflow_id: initial.id }, body: { status: "archived" } }).catch(() => null);
    if (res && !res.error) {
      router.push("/agents");
      router.refresh();
    }
  }

  async function duplicate() {
    await flush();
    const res = await duplicateWorkflowEndpointApiV1WorkflowWorkflowIdDuplicatePost({ path: { workflow_id: initial.id } }).catch(() => null);
    if (res?.data) {
      router.push(`/agents/${res.data.id}`);
      router.refresh();
    }
  }

  // A preset becomes this agent's own model config; null returns to the
  // workspace models. The backend validates provider keys when it saves.
  function applyPreset(p: Preset | null) {
    if (!p) return setConfig("model_configuration_v2_override", undefined);
    const embeddings = props.org.config?.mode === "byok" ? props.org.config.byok?.pipeline?.embeddings : undefined;
    const next: ModelConfigV2 = {
      version: 2,
      mode: "byok",
      byok: { mode: "pipeline", pipeline: { stt: p.stt, llm: p.llm, tts: p.tts, ...(embeddings ? { embeddings } : {}) } },
    };
    setConfig("model_configuration_v2_override", next);
  }

  // Load an older version into the editor; autosave turns it into the draft.
  function restore(v: Version) {
    if (v.kind === "multi_step") return window.alert("That version is a multi-step flow and can't be restored into a single-prompt agent.");
    if (!window.confirm(`Replace the current draft with v${v.number}? You can publish it afterwards.`)) return;
    setAgent(toAgent(v.agent));
    setConfigs(v.settings);
  }

  const dispositions = (Array.isArray(configs.call_dispositions) ? configs.call_dispositions : []) as { code: string; description: string }[];

  return (
    <div className="min-h-full">
      {/* Header */}
      <header className="sticky top-14 z-20 border-b bg-background/95 backdrop-blur md:top-0">
        <EditorHeader
          agentId={initial.id}
          uuid={initial.uuid}
          name={name}
          onName={setName}
          version={version}
          save={save}
          saveError={saveError}
          publishing={busy === "publish"}
          disabled={multiStep}
          onTalk={setTesting}
          onPublish={publish}
          onRestore={restore}
          onDuplicate={duplicate}
          onArchive={archive}
        />
        <div className="flex items-end justify-between px-2 sm:px-3">
          <Tabs tabs={TABS} value={tab} onChange={setTab} />
          <button
            type="button"
            aria-label="Search"
            title="Search (Ctrl K)"
            onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))}
            className={btn("ghost", "md", "mb-1 size-9 px-0 text-muted-foreground")}
          >
            <Search className="size-4" />
          </button>
        </div>
      </header>

      <div className="space-y-5 px-4 py-5 sm:px-5">
        {multiStep ? (
          <div className="flex flex-wrap items-start gap-4 rounded-lg border border-amber-200 bg-amber-50 p-5">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <p className="text-[14.5px] font-medium text-amber-900">
                This agent was built as a multi-step flow{initial.multiStepNodes ? ` (${initial.multiStepNodes + 1} steps)` : ""}
              </p>
              <p className="mt-1 text-[13.5px] leading-relaxed text-amber-800">
                Awaz agents run on a single prompt. Converting merges every step&apos;s instructions into one prompt in conversation order, keeps all
                tools and documents, and saves it as a draft. The published version keeps working until you publish.
              </p>
            </div>
            <button type="button" onClick={convert} disabled={busy !== null} className={btn("primary")}>
              {busy === "convert" ? <LoaderCircle className="size-4 animate-spin" /> : null} Convert to single prompt
            </button>
          </div>
        ) : null}

        {tab === "agent" ? (
          <AgentTab
            agent={agent}
            update={update}
            effective={effective}
            custom={Boolean(override)}
            activePreset={override ? matchPreset(effective) : null}
            latency={props.latency}
            clips={props.clips}
            onEditModels={(s) => setModelsOpen(s)}
            onPreset={applyPreset}
            readOnly={multiStep}
          />
        ) : null}
        {tab === "tools" ? (
          <ToolsTab
            tools={props.tools}
            documents={props.documents}
            toolUuids={agent.tool_uuids}
            documentUuids={agent.document_uuids}
            onTools={(v) => update({ tool_uuids: v })}
            onDocuments={(v) => update({ document_uuids: v })}
            readOnly={multiStep}
          />
        ) : null}
        {tab === "logs" ? <CallsTab agentId={initial.id} runs={props.runs} total={props.totalRuns} /> : null}
        {tab === "analysis" ? (
          <AnalysisTab
            agent={agent}
            update={update}
            dispositions={dispositions}
            onDispositions={(v) => setConfig("call_dispositions", v)}
            qaDefaultPrompt={props.qaDefaultPrompt}
            readOnly={multiStep}
          />
        ) : null}
        {tab === "advanced" ? (
          <AdvancedTab
            agentId={initial.id}
            agent={agent}
            update={update}
            configs={configs}
            setConfig={setConfig}
            credentials={props.credentials}
            onArchive={archive}
            readOnly={multiStep}
          />
        ) : null}
      </div>

      {modelsOpen ? (
        <ModelDialog
          open
          initialService={modelsOpen}
          onClose={() => setModelsOpen(null)}
          orgConfig={props.org.config}
          override={override}
          defaults={props.defaults}
          onSave={(next: ModelConfigV2 | null) => setConfig("model_configuration_v2_override", next ?? undefined)}
        />
      ) : null}

      <TestPanel
        open={testing !== null}
        mode={testing ?? "chat"}
        onClose={() => setTesting(null)}
        agentId={initial.id}
        telephony={props.telephony}
        testPhone={props.testPhone}
        beforeStart={beforeTest}
      />
    </div>
  );
}
