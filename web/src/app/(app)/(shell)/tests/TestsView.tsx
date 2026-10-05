"use client";

import { ChevronDown, ChevronLeft, ChevronRight, Copy, FlaskConical, LoaderCircle, MoreHorizontal, Pencil, Play, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type AgentTestResponse,
  createRunApiV1AgentsAgentIdTestRunsPost,
  createTestApiV1AgentsAgentIdTestsPost,
  deleteTestApiV1AgentsAgentIdTestsTestIdDelete,
  generateTestsApiV1AgentsAgentIdTestsGeneratePost,
  listRunsApiV1AgentsAgentIdTestRunsGet,
  listTestsApiV1AgentsAgentIdTestsGet,
  type TestConfigResponse,
  type TestRunDetail,
  type TestRunSummary,
  updateTestApiV1AgentsAgentIdTestsTestIdPut,
} from "@/client";
import { Dropdown } from "@/components/app/client";
import { btn, Card } from "@/components/app/ui";
import { apiError } from "@/lib/errors";

import { RunResults } from "./RunResults";
import { elapsed, isActive, since, StatusBadge } from "./shared";
import { type Draft, TestEditor, toDraft } from "./TestEditor";

type Agent = { id: number; name: string; multiStep: boolean; version: number | null };
type Tab = "tests" | "runs";

const PAGE_SIZES = [10, 25, 50];
const REPEATS = [1, 2, 3, 5] as const;

function Segmented({ value, onChange, runs }: { value: Tab; onChange: (t: Tab) => void; runs: number }) {
  return (
    <div role="tablist" className="inline-flex rounded-lg bg-muted p-1">
      {(["tests", "runs"] as const).map((t) => (
        <button
          key={t}
          type="button"
          role="tab"
          aria-selected={value === t}
          onClick={() => onChange(t)}
          className={`inline-flex h-8 items-center gap-1.5 rounded-md px-3.5 text-[14px] font-medium transition-all ${
            value === t ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {t === "tests" ? "Tests" : "Runs"}
          {t === "runs" && runs ? <span className="size-1.5 animate-pulse rounded-full bg-blue-500" aria-label="A run is in progress" /> : null}
        </button>
      ))}
    </div>
  );
}

function Pager({ total, page, size, onPage, onSize }: { total: number; page: number; size: number; onPage: (p: number) => void; onSize: (s: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  const from = total ? page * size + 1 : 0;
  const to = Math.min(total, (page + 1) * size);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-3 text-[13px] text-muted-foreground">
      <label className="flex items-center gap-2">
        Show
        <select value={size} onChange={(e) => onSize(Number(e.target.value))} className="h-8 rounded-md border bg-background px-2 text-[13px] text-foreground">
          {PAGE_SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        per page
      </label>
      <div className="flex items-center gap-2">
        <button type="button" aria-label="Previous page" disabled={page === 0} onClick={() => onPage(page - 1)} className="flex size-8 items-center justify-center rounded-md transition-colors hover:bg-accent disabled:opacity-40">
          <ChevronLeft className="size-4" />
        </button>
        <span className="tabular-nums text-foreground">
          {from}–{to} of {total}
        </span>
        <button type="button" aria-label="Next page" disabled={page >= pages - 1} onClick={() => onPage(page + 1)} className="flex size-8 items-center justify-center rounded-md transition-colors hover:bg-accent disabled:opacity-40">
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}

function PassBar({ run }: { run: TestRunSummary }) {
  const parts = [
    { n: run.passed, cls: "bg-emerald-500" },
    { n: run.failed, cls: "bg-red-500" },
    { n: run.errored, cls: "bg-amber-400" },
    { n: run.pending, cls: "bg-muted-foreground/25" },
  ];
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-1.5 w-28 overflow-hidden rounded-full bg-muted">
        {parts.map((p, i) => (p.n ? <span key={i} className={`h-full ${p.cls}`} style={{ width: `${(p.n / Math.max(1, run.total)) * 100}%` }} /> : null))}
      </div>
      <span className="text-[13px] text-foreground tabular-nums">
        {run.passed}/{run.total} passed
      </span>
    </div>
  );
}

export function TestsView({
  agent,
  initialTests,
  initialRuns,
  config,
  openRun,
}: {
  agent: Agent;
  initialTests: AgentTestResponse[];
  initialRuns: TestRunSummary[];
  config: TestConfigResponse | null;
  openRun: number | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [tests, setTests] = useState(initialTests);
  const [runs, setRuns] = useState(initialRuns);
  const [tab, setTab] = useState<Tab>(openRun ? "runs" : "tests");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(10);
  const [repeats, setRepeats] = useState<(typeof REPEATS)[number]>(1);
  const [viewing, setViewing] = useState<number | null>(openRun);
  const [editing, setEditing] = useState<{ id: number | null; draft: Draft | null } | null>(null);
  const [saving, setSaving] = useState<false | "save" | "run">(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [starting, setStarting] = useState<number | "all" | null>(null);
  const [generating, setGenerating] = useState(false);
  const [notice, setNotice] = useState<{ tone: "error" | "info"; text: string } | null>(null);

  const ready = Boolean(config?.configured) && !agent.multiStep;
  const activeRuns = runs.filter((r) => isActive(r.status)).length;
  const runningTests = useMemo(() => new Set(tests.filter((t) => t.last_result && isActive(t.last_result.status)).map((t) => t.id)), [tests]);

  const refresh = useCallback(async () => {
    const [t, r] = await Promise.all([
      listTestsApiV1AgentsAgentIdTestsGet({ path: { agent_id: agent.id } }).catch(() => null),
      listRunsApiV1AgentsAgentIdTestRunsGet({ path: { agent_id: agent.id } }).catch(() => null),
    ]);
    if (t?.data) setTests(t.data);
    if (r?.data) setRuns(r.data);
    return r?.data ?? null;
  }, [agent.id]);

  // While a run is active, keep the lists fresh (the results modal polls on its own).
  const activeRef = useRef(activeRuns);
  activeRef.current = activeRuns;
  useEffect(() => {
    if (!activeRuns) return;
    const t = setInterval(() => {
      if (activeRef.current) refresh();
    }, 3000);
    return () => clearInterval(t);
  }, [activeRuns, refresh]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? tests.filter((t) => t.name.toLowerCase().includes(q) || t.scenario.toLowerCase().includes(q)) : tests;
  }, [tests, query]);
  const shown = filtered.slice(page * size, (page + 1) * size);

  const start = async (testIds: number[], key: number | "all") => {
    setNotice(null);
    setStarting(key);
    const res = await createRunApiV1AgentsAgentIdTestRunsPost({ path: { agent_id: agent.id }, body: { test_ids: testIds, runs_per_test: repeats } }).catch(() => null);
    setStarting(null);
    if (!res?.data) {
      setNotice({ tone: "error", text: apiError(res?.error, "Couldn't start the run.") });
      return;
    }
    setRuns((r) => [res.data!, ...r]);
    setViewing(res.data.id);
    refresh();
  };

  const save = async (draft: Draft, run: boolean) => {
    if (!editing) return;
    setSaving(run ? "run" : "save");
    setEditError(null);
    const body = { name: draft.name, scenario: draft.scenario, behaviors: draft.behaviors };
    const res =
      editing.id == null
        ? await createTestApiV1AgentsAgentIdTestsPost({ path: { agent_id: agent.id }, body }).catch(() => null)
        : await updateTestApiV1AgentsAgentIdTestsTestIdPut({ path: { agent_id: agent.id, test_id: editing.id }, body }).catch(() => null);
    setSaving(false);
    if (!res?.data) {
      setEditError(apiError(res?.error, "Couldn't save the test."));
      return;
    }
    const saved = res.data;
    setTests((ts) => (editing.id == null ? [...ts, saved] : ts.map((t) => (t.id === saved.id ? { ...saved, last_result: t.last_result } : t))));
    setEditing(null);
    if (run) start([saved.id], saved.id);
  };

  const duplicate = async (t: AgentTestResponse) => {
    const res = await createTestApiV1AgentsAgentIdTestsPost({
      path: { agent_id: agent.id },
      body: { name: `${t.name} (copy)`.slice(0, 200), scenario: t.scenario, behaviors: t.behaviors.map((b) => ({ name: b.name, description: b.description })) },
    }).catch(() => null);
    if (res?.data) setTests((ts) => [...ts, res.data!]);
  };

  const remove = async (t: AgentTestResponse) => {
    if (!confirm(`Delete "${t.name}"? Past results stay in Runs.`)) return;
    const res = await deleteTestApiV1AgentsAgentIdTestsTestIdDelete({ path: { agent_id: agent.id, test_id: t.id } }).catch(() => null);
    if (res?.data) setTests((ts) => ts.filter((x) => x.id !== t.id));
  };

  const generate = async () => {
    setNotice(null);
    setGenerating(true);
    const res = await generateTestsApiV1AgentsAgentIdTestsGeneratePost({ path: { agent_id: agent.id }, body: { count: 5 } }).catch(() => null);
    setGenerating(false);
    if (!res?.data) {
      setNotice({ tone: "error", text: apiError(res?.error, "Couldn't generate tests.") });
      return;
    }
    setTests((ts) => [...ts, ...res.data!]);
    setTab("tests");
    setNotice({ tone: "info", text: `Added ${res.data.length} tests written from the agent's prompt. Review them, then run.` });
  };

  const closeRun = useCallback(() => {
    setViewing(null);
    if (openRun) router.replace(`${pathname}?agent=${agent.id}`, { scroll: false });
    refresh();
  }, [openRun, router, pathname, agent.id, refresh]);

  const onRunChange = useCallback((run: TestRunDetail) => {
    setRuns((rs) => rs.map((r) => (r.id === run.id ? { ...r, ...run } : r)));
  }, []);

  const generateButton = (
    <button type="button" onClick={generate} disabled={generating || agent.multiStep || !config?.configured} className={btn("secondary")}>
      {generating ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
      {generating ? "Writing tests…" : "Generate with AI"}
    </button>
  );

  return (
    <div className="space-y-4">
      {agent.multiStep ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
          {agent.name} is a multi-step flow.{" "}
          <Link href={`/agents/${agent.id}`} className="font-medium underline underline-offset-4">
            Convert it to a single prompt
          </Link>{" "}
          to run tests.
        </div>
      ) : null}
      {config && !config.configured ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
          Tests need an LLM to play the caller and judge results. Set <code className="font-mono">AWAZ_TEST_OPENROUTER_API_KEY</code> on the server.
        </div>
      ) : null}
      {notice ? (
        <div className={`rounded-lg border px-4 py-3 text-[13px] ${notice.tone === "error" ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-800"}`}>{notice.text}</div>
      ) : null}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <Segmented value={tab} onChange={setTab} runs={activeRuns} />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {tab === "tests" ? (
            <>
              <label className="relative">
                <span className="sr-only">Search tests</span>
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setPage(0);
                  }}
                  placeholder="Search"
                  className="h-9 w-56 rounded-md border bg-background pr-3 pl-9 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
                />
              </label>
              {tests.length ? generateButton : null}
              <button type="button" onClick={() => { setEditError(null); setEditing({ id: null, draft: null }); }} className={btn("secondary")}>
                <Plus className="size-4" /> Add test
              </button>
            </>
          ) : null}
          <div className="flex">
            <button type="button" onClick={() => start([], "all")} disabled={!ready || !tests.length || starting != null} className={btn("primary", "md", "rounded-r-none")}>
              {starting === "all" ? <LoaderCircle className="size-4 animate-spin" /> : <Play className="size-3.5" />}
              Run all{repeats > 1 ? ` ×${repeats}` : ""}
            </button>
            <Dropdown
              width={230}
              header={<p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Runs per test</p>}
              trigger={({ toggle, open }) => (
                <button type="button" aria-label="Runs per test" aria-expanded={open} onClick={toggle} className={btn("primary", "md", "rounded-l-none border-l border-white/20 px-2")}>
                  <ChevronDown className="size-4" />
                </button>
              )}
              items={REPEATS.map((n) => ({
                label: `${n}× each${repeats === n ? "  ✓" : ""}`,
                hint: n === 1 ? "Fast, while you're writing tests" : "Repeat to catch flaky behavior",
                onSelect: () => setRepeats(n),
              }))}
            />
          </div>
        </div>
      </div>

      {tab === "tests" ? (
        tests.length ? (
          <Card className="overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-muted/40 text-[13px] text-muted-foreground">
                <tr>
                  <th className="h-11 px-5 font-medium">Test</th>
                  <th className="hidden h-11 w-28 px-4 font-medium md:table-cell">Behaviors</th>
                  <th className="h-11 w-36 px-4 font-medium">Status</th>
                  <th className="h-11 w-32 px-4 font-medium">Run</th>
                  <th className="h-11 w-14 px-4" />
                </tr>
              </thead>
              <tbody>
                {shown.map((t) => {
                  const running = runningTests.has(t.id) || starting === t.id;
                  return (
                    <tr key={t.id} className="group border-b transition-colors last:border-b-0 hover:bg-muted/40">
                      <td className="max-w-0 px-5 py-3.5">
                        <button type="button" onClick={() => { setEditError(null); setEditing({ id: t.id, draft: toDraft(t) }); }} className="flex w-full items-center gap-3 text-left">
                          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-muted/50 text-muted-foreground">
                            <FlaskConical className="size-4" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-[14.5px] font-medium text-foreground group-hover:underline group-hover:underline-offset-4">{t.name}</span>
                            <span className="block truncate text-[13px] text-muted-foreground">{t.scenario}</span>
                          </span>
                        </button>
                      </td>
                      <td className="hidden px-4 py-3.5 text-[13px] text-muted-foreground tabular-nums md:table-cell">{t.behaviors.length}</td>
                      <td className="px-4 py-3.5">
                        {t.last_result ? (
                          <button type="button" onClick={() => setViewing(t.last_result!.run_id)} className="flex flex-col items-start gap-0.5" title="Open the latest result">
                            <StatusBadge status={t.last_result.status} />
                            {t.last_result.finished_at ? <span className="pl-1 text-[11.5px] text-muted-foreground">{since(t.last_result.finished_at)}</span> : null}
                          </button>
                        ) : (
                          <span className="text-muted-foreground">–</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5">
                        <button
                          type="button"
                          onClick={() => start([t.id], t.id)}
                          disabled={!ready || running || starting != null}
                          className="inline-flex h-8 items-center gap-1.5 rounded-full bg-muted px-3.5 text-[13px] font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
                        >
                          {running ? <LoaderCircle className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                          {running ? "Running" : "Run"}
                        </button>
                      </td>
                      <td className="px-4 py-3.5">
                        <Dropdown
                          width={170}
                          trigger={({ toggle, open }) => (
                            <button type="button" aria-label={`Actions for ${t.name}`} aria-expanded={open} onClick={toggle} className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                              <MoreHorizontal className="size-4" />
                            </button>
                          )}
                          items={[
                            { label: "Edit", icon: Pencil, onSelect: () => { setEditError(null); setEditing({ id: t.id, draft: toDraft(t) }); } },
                            { label: "Duplicate", icon: Copy, onSelect: () => duplicate(t) },
                            { label: "Delete", icon: Trash2, danger: true, onSelect: () => remove(t) },
                          ]}
                        />
                      </td>
                    </tr>
                  );
                })}
                {!shown.length ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-10 text-center text-[13px] text-muted-foreground">
                      No tests match “{query}”.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
            <Pager total={filtered.length} page={page} size={size} onPage={setPage} onSize={(s) => { setSize(s); setPage(0); }} />
          </Card>
        ) : (
          <Card>
            <div className="flex flex-col items-center px-6 py-16 text-center">
              <span className="flex size-12 items-center justify-center rounded-xl border bg-muted/50">
                <FlaskConical className="size-5 text-muted-foreground" />
              </span>
              <h3 className="mt-4 text-base font-semibold text-foreground">Test {agent.name} before real callers do</h3>
              <p className="mt-1.5 max-w-md text-[14px] leading-relaxed text-muted-foreground">
                Each test is a simulated caller with a goal, plus the behaviors you expect from the agent. Start with a set written from the agent&apos;s prompt, or write your own.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <button type="button" onClick={generate} disabled={generating || agent.multiStep || !config?.configured} className={btn("primary")}>
                  {generating ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  {generating ? "Writing tests…" : "Generate tests with AI"}
                </button>
                <button type="button" onClick={() => setEditing({ id: null, draft: null })} className={btn("secondary")}>
                  <Plus className="size-4" /> Write a test
                </button>
              </div>
            </div>
          </Card>
        )
      ) : runs.length ? (
        <Card className="overflow-hidden">
          <table className="w-full text-left text-sm">
            <thead className="border-b bg-muted/40 text-[13px] text-muted-foreground">
              <tr>
                <th className="h-11 px-5 font-medium">Run</th>
                <th className="h-11 px-4 font-medium">Result</th>
                <th className="h-11 px-4 font-medium">Status</th>
                <th className="hidden h-11 px-4 font-medium md:table-cell">Started</th>
                <th className="hidden h-11 px-4 font-medium lg:table-cell">Duration</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} onClick={() => setViewing(r.id)} className="cursor-pointer border-b transition-colors last:border-b-0 hover:bg-muted/40">
                  <td className="px-5 py-3.5">
                    <span className="block text-[14.5px] font-medium text-foreground">Run #{r.number}</span>
                    <span className="block text-[12.5px] text-muted-foreground">
                      {r.total} {r.total === 1 ? "conversation" : "conversations"}
                      {r.runs_per_test > 1 ? ` · ${r.runs_per_test}× each` : ""}
                      {r.version_number ? ` · draft v${r.version_number}` : ""}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <PassBar run={r} />
                  </td>
                  <td className="px-4 py-3.5">
                    <StatusBadge status={r.status} />
                  </td>
                  <td className="hidden px-4 py-3.5 text-[13px] text-muted-foreground md:table-cell">{since(r.created_at)}</td>
                  <td className="hidden px-4 py-3.5 text-[13px] text-muted-foreground tabular-nums lg:table-cell">{elapsed(r.started_at, r.finished_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
        <Card>
          <p className="px-6 py-14 text-center text-[14px] text-muted-foreground">No runs yet. Run a test to see transcripts and verdicts here.</p>
        </Card>
      )}

      {config?.configured ? (
        <p className="text-xs text-muted-foreground">
          Caller played by <span className="font-mono">{config.simulator_model}</span> · judged by <span className="font-mono">{config.judge_model}</span> · runs use the agent&apos;s current draft
        </p>
      ) : null}

      <TestEditor
        open={editing != null}
        initial={editing?.draft ?? null}
        title={editing?.id == null ? "New test" : "Edit test"}
        busy={saving}
        error={editError}
        onClose={() => setEditing(null)}
        onSave={save}
      />
      <RunResults agentId={agent.id} runId={viewing} onClose={closeRun} onChange={onRunChange} />
    </div>
  );
}
