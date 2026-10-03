"use client";

import { AlertTriangle, BarChart3, Bot, ScrollText, Search, Settings2, Wrench } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  duplicateWorkflowEndpointApiV1WorkflowWorkflowIdDuplicatePost,
  publishWorkflowApiV1WorkflowWorkflowIdPublishPost,
  updateWorkflowApiV1WorkflowWorkflowIdPut,
  updateWorkflowStatusApiV1WorkflowWorkflowIdStatusPut,
} from "@/client";
import type { UpdateWorkflowRequest } from "@/client";
import { Tabs } from "@/components/app/client";
import { btn } from "@/components/app/ui";
import {
  type AgentFields,
  asDefinition,
  type Definition,
  flatten,
  isMultiStep,
  type Qa,
  readAgent,
  readQa,
  readTrigger,
  readWebhooks,
  type Webhook,
  writeAgent,
  writeQa,
  writeTrigger,
  writeWebhooks,
} from "@/lib/agent";
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

export function AgentEditor(props: EditorProps) {
  const { agent } = props;
  const router = useRouter();

  const [name, setName] = useState(agent.name);
  const [def, setDef] = useState<Definition>(agent.definition);
  const [configs, setConfigs] = useState<Configs>(agent.configs);
  const [version, setVersion] = useState({ number: agent.versionNumber, status: agent.versionStatus });
  const [save, setSave] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("agent");
  const [testing, setTesting] = useState<"chat" | "phone" | null>(null);
  const [modelsOpen, setModelsOpen] = useState<Service | null>(null);
  const [publishing, setPublishing] = useState(false);

  const fields = useMemo(() => readAgent(def), [def]);
  const multiStep = useMemo(() => isMultiStep(def), [def]);
  const override = agentOverride(configs);
  const effective = override ? (effectiveOf(override) ?? props.org.effective) : props.org.effective;

  const set = useCallback(<K extends keyof AgentFields>(k: K, v: AgentFields[K]) => {
    setDef((d) => writeAgent(d, { ...readAgent(d), [k]: v }));
  }, []);
  const setConfig = useCallback((key: string, value: unknown) => {
    setConfigs((c) => {
      const next = { ...c };
      if (value === undefined || value === "") delete next[key];
      else next[key] = value;
      return next;
    });
  }, []);

  // ── Autosave ────────────────────────────────────────────────────────
  // Every change is written to Dograh's draft version after a short pause.
  // Publish promotes the draft to the version real calls use.
  const saved = useRef({ name: agent.name, def: JSON.stringify(agent.definition), configs: JSON.stringify(agent.configs) });
  const latest = useRef({ name, def, configs });
  latest.current = { name, def, configs };
  const inflight = useRef<Promise<boolean> | null>(null);

  const isDirty = () => {
    const c = latest.current;
    return c.name !== saved.current.name || JSON.stringify(c.def) !== saved.current.def || JSON.stringify(c.configs) !== saved.current.configs;
  };

  const flush = useCallback(async (): Promise<boolean> => {
    if (inflight.current) await inflight.current;
    const cur = latest.current;
    const defJson = JSON.stringify(cur.def);
    const cfgJson = JSON.stringify(cur.configs);
    const body: UpdateWorkflowRequest = {};
    if (cur.name !== saved.current.name) body.name = cur.name.trim() || "Untitled agent";
    if (defJson !== saved.current.def) body.workflow_definition = cur.def;
    if (cfgJson !== saved.current.configs) body.workflow_configurations = cur.configs as UpdateWorkflowRequest["workflow_configurations"];
    if (!Object.keys(body).length) return true;

    setSave("saving");
    const run = (async () => {
      const res = await updateWorkflowApiV1WorkflowWorkflowIdPut({ path: { workflow_id: agent.id }, body }).catch(() => null);
      if (!res?.data) {
        setSave("error");
        setSaveError(apiError(res?.error, "Couldn't save. Check your connection."));
        return false;
      }
      saved.current = { name: cur.name, def: defJson, configs: cfgJson };

      // The backend generates the API trigger's URL path on save; adopt it.
      const serverPath = readTrigger(asDefinition(res.data.workflow_definition))?.path;
      if (serverPath && !readTrigger(cur.def)?.path) {
        const withPath = (d: Definition): Definition => ({
          ...d,
          nodes: d.nodes.map((n) => (n.type === "trigger" ? { ...n, data: { ...n.data, trigger_path: serverPath } } : n)),
        });
        saved.current.def = JSON.stringify(withPath(cur.def));
        setDef(withPath);
      }
      setVersion({ number: res.data.version_number ?? null, status: res.data.version_status ?? null });
      // Name and model changes show in the agent list, which is server-rendered.
      if (body.name || body.workflow_configurations) router.refresh();
      setSaveError(null);
      setSave(isDirty() ? "dirty" : "saved");
      return true;
    })();
    inflight.current = run;
    const ok = await run;
    inflight.current = null;
    return ok;
  }, [agent.id, router]);

  useEffect(() => {
    if (!isDirty()) {
      // A save can finish before the state it saved is rendered; clear a stale "dirty".
      setSave((s) => (s === "dirty" ? "saved" : s));
      return;
    }
    setSave("dirty");
    const t = setTimeout(flush, 900);
    return () => clearTimeout(t);
  }, [name, def, configs, flush]);

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
    setPublishing(true);
    const ok = await flush();
    if (ok) {
      const res = await publishWorkflowApiV1WorkflowWorkflowIdPublishPost({ path: { workflow_id: agent.id } }).catch(() => null);
      if (res && !res.error) {
        const data = res.data as { version_number?: number } | undefined;
        setVersion({ number: data?.version_number ?? version.number, status: "published" });
      } else {
        setSaveError(apiError(res?.error, "Couldn't publish."));
        setSave("error");
      }
    }
    setPublishing(false);
  }

  async function archive() {
    if (!window.confirm(`Archive "${name}"? It will stop taking calls.`)) return;
    const res = await updateWorkflowStatusApiV1WorkflowWorkflowIdStatusPut({ path: { workflow_id: agent.id }, body: { status: "archived" } }).catch(() => null);
    if (res && !res.error) {
      router.push("/agents");
      router.refresh();
    }
  }

  async function duplicate() {
    await flush();
    const res = await duplicateWorkflowEndpointApiV1WorkflowWorkflowIdDuplicatePost({ path: { workflow_id: agent.id } }).catch(() => null);
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
    if (!window.confirm(`Replace the current draft with v${v.number}? You can publish it afterwards.`)) return;
    setDef(asDefinition(v.json));
    setConfigs((v.configs ?? {}) as Configs);
  }

  const qa = readQa(def);
  const webhooks = readWebhooks(def);
  const dispositions = (Array.isArray(configs.call_dispositions) ? configs.call_dispositions : []) as { code: string; description: string }[];

  return (
    <div className="min-h-full">
      {/* Header */}
      <header className="sticky top-14 z-20 border-b bg-background/95 backdrop-blur md:top-0">
        <EditorHeader
          agentId={agent.id}
          uuid={agent.uuid}
          name={name}
          onName={setName}
          version={version}
          save={save}
          saveError={saveError}
          publishing={publishing}
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
          <div className="flex flex-wrap items-start gap-4 rounded-lg bg-amber-50 p-5 border border-amber-200">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <p className="text-[14.5px] font-medium text-amber-900">This agent was built as a multi-step flow</p>
              <p className="mt-1 text-[13.5px] leading-relaxed text-amber-800">
                Awaz agents run on a single prompt. Converting merges every step&apos;s instructions into one prompt, keeps all tools and documents, and
                saves it as a draft. The published version keeps working until you publish.
              </p>
            </div>
            <button type="button" onClick={() => setDef(flatten(def))} className={btn("primary")}>
              Convert to single prompt
            </button>
          </div>
        ) : null}

        {tab === "agent" ? (
          <AgentTab
            fields={fields}
            set={set}
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
            toolUuids={fields.toolUuids}
            documentUuids={fields.documentUuids}
            onTools={(v) => set("toolUuids", v)}
            onDocuments={(v) => set("documentUuids", v)}
            readOnly={multiStep}
          />
        ) : null}
        {tab === "logs" ? <CallsTab agentId={agent.id} runs={props.runs} total={props.totalRuns} /> : null}
        {tab === "analysis" ? (
          <AnalysisTab
            fields={fields}
            set={set}
            dispositions={dispositions}
            onDispositions={(v) => setConfig("call_dispositions", v)}
            qa={qa}
            onQa={(v: Qa | null) => setDef((d) => writeQa(d, v))}
            readOnly={multiStep}
          />
        ) : null}
        {tab === "advanced" ? (
          <AdvancedTab
            agentId={agent.id}
            fields={fields}
            set={set}
            configs={configs}
            setConfig={setConfig}
            trigger={readTrigger(def)}
            onTrigger={(v) => setDef((d) => writeTrigger(d, v))}
            webhooks={webhooks}
            onWebhooks={(v: Webhook[]) => setDef((d) => writeWebhooks(d, v))}
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
        agentId={agent.id}
        telephony={props.telephony}
        testPhone={props.testPhone}
        beforeStart={beforeTest}
      />
    </div>
  );
}
