"use client";

import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, ChevronDown, PhoneOff, Square, Wrench, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { cancelRunApiV1AgentsAgentIdTestRunsRunIdCancelPost, getRunApiV1AgentsAgentIdTestRunsRunIdGet, type TestResultResponse, type TestRunDetail, type TestTranscriptItem as TranscriptItem } from "@/client";
import { btn } from "@/components/app/ui";

import { elapsed, isActive, StatusBadge, StatusIcon } from "./shared";

function ToolChip({ item }: { item: TranscriptItem }) {
  const [open, setOpen] = useState(false);
  const args = item.arguments && Object.keys(item.arguments).length ? JSON.stringify(item.arguments, null, 2) : null;
  return (
    <div className="max-w-[85%]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-2 rounded-lg border bg-background px-3 py-1.5 font-mono text-[12.5px] text-foreground shadow-xs transition-colors hover:bg-accent"
      >
        <Wrench className="size-3.5 text-muted-foreground" />
        {item.name}
        <ChevronDown className={`size-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div className="mt-1.5 space-y-2 rounded-lg border bg-muted/50 p-3 font-mono text-[12px] leading-relaxed text-foreground/90">
          <div>
            <p className="mb-1 font-sans text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Arguments</p>
            <pre className="overflow-x-auto whitespace-pre-wrap">{args ?? "{}"}</pre>
          </div>
          {item.result != null ? (
            <div>
              <p className="mb-1 font-sans text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">Result</p>
              <pre className="overflow-x-auto whitespace-pre-wrap">{item.result}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Transcript({ items, live }: { items: TranscriptItem[]; live: boolean }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (live) end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [items.length, live]);

  if (!items.length) {
    return <p className="py-10 text-center text-[13px] text-muted-foreground">{live ? "Dialing the agent…" : "No conversation was recorded."}</p>;
  }
  return (
    <div className="space-y-3">
      {items.map((item, i) => {
        if (item.role === "user")
          return (
            <motion.div key={i} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex justify-end">
              <p className="max-w-[78%] rounded-2xl rounded-br-md bg-muted px-3.5 py-2 text-[14px] leading-relaxed text-foreground">{item.text}</p>
            </motion.div>
          );
        if (item.role === "agent")
          return (
            <motion.div key={i} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex gap-2.5">
              <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">AI</span>
              <p className="max-w-[78%] text-[14px] leading-relaxed whitespace-pre-wrap text-foreground">{item.text}</p>
            </motion.div>
          );
        if (item.role === "tool") return <ToolChip key={i} item={item} />;
        return (
          <span
            key={i}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12.5px] font-medium ${
              item.role === "end" ? "bg-amber-50 text-amber-800" : "bg-muted text-muted-foreground"
            }`}
          >
            <PhoneOff className="size-3.5" />
            {item.role === "end" ? "Agent ended the call" : "Caller hung up"}
          </span>
        );
      })}
      {live ? (
        <div className="flex items-center gap-1 pl-8" aria-label="Conversation in progress">
          {[0, 1, 2].map((d) => (
            <motion.span key={d} className="size-1.5 rounded-full bg-muted-foreground/60" animate={{ opacity: [0.3, 1, 0.3] }} transition={{ duration: 1.2, repeat: Infinity, delay: d * 0.2 }} />
          ))}
        </div>
      ) : null}
      <div ref={end} />
    </div>
  );
}

function Behaviors({ result }: { result: TestResultResponse }) {
  if (result.status === "error") {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-[13px] text-amber-800">
        <p className="font-medium">This test couldn&apos;t finish</p>
        <p className="mt-0.5 break-words">{result.error ?? "Unknown error"}</p>
      </div>
    );
  }
  if (!result.verdicts.length) {
    return (
      <ul className="space-y-2">
        {result.behaviors.map((b) => (
          <li key={b.id} className="flex items-start gap-2.5 rounded-lg border px-4 py-3">
            <StatusIcon status={isActive(result.status) ? "queued" : "cancelled"} className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0">
              <p className="text-[14px] font-medium text-foreground">{b.name}</p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">{isActive(result.status) ? "Waiting for the conversation to end…" : b.description}</p>
            </div>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="space-y-2">
      {result.verdicts.map((v) => (
        <motion.li key={v.behavior_id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className={`flex items-start gap-2.5 rounded-lg border px-4 py-3 ${v.passed ? "" : "border-red-200 bg-red-50/40"}`}>
          <StatusIcon status={v.passed ? "passed" : "failed"} className="mt-0.5 size-4 shrink-0" />
          <div className="min-w-0">
            <p className="text-[14px] font-medium text-foreground">{v.name}</p>
            <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{v.reasoning}</p>
          </div>
        </motion.li>
      ))}
    </ul>
  );
}

export function RunResults({ agentId, runId, onClose, onChange }: { agentId: number; runId: number | null; onClose: () => void; onChange: (run: TestRunDetail) => void }) {
  const [run, setRun] = useState<TestRunDetail | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [stopping, setStopping] = useState(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const load = useCallback(async () => {
    if (runId == null) return null;
    const res = await getRunApiV1AgentsAgentIdTestRunsRunIdGet({ path: { agent_id: agentId, run_id: runId } }).catch(() => null);
    if (res?.data) {
      setRun(res.data);
      onChangeRef.current(res.data);
    }
    return res?.data ?? null;
  }, [agentId, runId]);

  useEffect(() => {
    setRun(null);
    setSelected(null);
    if (runId == null) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const r = await load();
      if (!stop && r && isActive(r.status)) timer = setTimeout(tick, 2000);
    };
    tick();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [runId, load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const results = run?.results ?? [];
  // Follow the first unfinished test while running, unless the user picked one.
  const current = results.find((r) => r.id === selected) ?? results.find((r) => r.status === "running") ?? results[0];
  const done = results.filter((r) => !isActive(r.status)).length;
  const live = run ? isActive(run.status) : false;

  const stop = async () => {
    if (!run) return;
    setStopping(true);
    await cancelRunApiV1AgentsAgentIdTestRunsRunIdCancelPost({ path: { agent_id: agentId, run_id: run.id } }).catch(() => null);
    await load();
    setStopping(false);
  };

  return (
    <AnimatePresence>
      {runId != null ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-[5vh] backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Run results"
            className="flex h-[88vh] w-full max-w-[1180px] flex-col overflow-hidden rounded-xl border bg-background shadow-xl"
            initial={{ opacity: 0, y: 12, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.985 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex items-start justify-between gap-4 border-b px-6 py-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-[17px] font-semibold tracking-tight text-foreground">Run results{run ? ` · #${run.number}` : ""}</h2>
                  {run ? <StatusBadge status={run.status} /> : null}
                </div>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  {run
                    ? live
                      ? `${done} of ${run.total} finished · ${elapsed(run.started_at ?? run.created_at, null)}`
                      : `${run.passed} of ${run.total} passed${run.version_number ? ` · draft v${run.version_number}` : ""} · ${elapsed(run.started_at, run.finished_at)}`
                    : "Loading…"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {live ? (
                  <button type="button" onClick={stop} disabled={stopping} className={btn("secondary", "sm")}>
                    <Square className="size-3" /> Stop run
                  </button>
                ) : null}
                <button type="button" onClick={onClose} aria-label="Close" className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground">
                  <X className="size-4" />
                </button>
              </div>
            </div>

            <div className="grid min-h-0 flex-1 md:grid-cols-[280px_minmax(0,1fr)]">
              {/* Tests in this run */}
              <aside className="min-h-0 overflow-y-auto border-b p-3 md:border-r md:border-b-0">
                {run ? (
                  <div className="mb-2 flex flex-wrap gap-1.5 px-1">
                    {run.passed ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">{run.passed} pass</span> : null}
                    {run.failed ? <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">{run.failed} fail</span> : null}
                    {run.errored ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">{run.errored} error</span> : null}
                    {run.pending ? <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{run.pending} pending</span> : null}
                  </div>
                ) : null}
                <ul className="space-y-1">
                  {results.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => setSelected(r.id)}
                        className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-[14px] transition-colors ${
                          current?.id === r.id ? "bg-muted font-medium text-foreground" : "text-foreground/80 hover:bg-muted/60"
                        }`}
                      >
                        <StatusIcon status={r.status} className="size-4 shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{r.test_name}</span>
                        {run && run.runs_per_test > 1 ? <span className="shrink-0 text-xs text-muted-foreground">Run {r.iteration}</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </aside>

              {/* Selected conversation */}
              <section className="flex min-h-0 flex-col">
                {current ? (
                  <>
                    <div className="flex items-center justify-between gap-3 px-6 pt-4 pb-2">
                      <h3 className="truncate text-[15px] font-semibold text-foreground">
                        Transcript <span className="font-normal text-muted-foreground">· {current.test_name}</span>
                      </h3>
                      {current.workflow_run_id ? (
                        <Link href={`/logs?call=${current.workflow_run_id}`} className="inline-flex shrink-0 items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground">
                          Open in Logs <ArrowUpRight className="size-3.5" />
                        </Link>
                      ) : null}
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6">
                      <details className="mb-4 rounded-lg border bg-muted/30 px-4 py-2.5 text-[13px] text-muted-foreground">
                        <summary className="cursor-pointer font-medium text-foreground/80 select-none">Caller scenario</summary>
                        <p className="mt-2 leading-relaxed whitespace-pre-wrap">{current.scenario}</p>
                      </details>
                      <Transcript items={current.transcript} live={current.status === "running"} />
                      <h4 className="mt-8 mb-3 text-[15px] font-semibold text-foreground">Behaviors</h4>
                      <Behaviors result={current} />
                    </div>
                  </>
                ) : (
                  <p className="p-10 text-center text-[13px] text-muted-foreground">{run ? "No tests in this run." : "Loading…"}</p>
                )}
              </section>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
