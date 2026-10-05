"use client";

import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, LoaderCircle, Play, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { AgentTestResponse } from "@/client";
import { btn, inputCls } from "@/components/app/ui";

export type Draft = { name: string; scenario: string; behaviors: { id?: string; name: string; description: string }[] };

const blank = (): Draft => ({ name: "", scenario: "", behaviors: [{ name: "", description: "" }] });

export const toDraft = (t: AgentTestResponse): Draft => ({
  name: t.name,
  scenario: t.scenario,
  behaviors: t.behaviors.map((b) => ({ id: b.id, name: b.name, description: b.description })),
});

const SCENARIO_HINT =
  "Describe the caller, what they want and how they behave. Give exact lines where they matter, e.g. 'When asked for a time, say next Tuesday afternoon.'";

export function TestEditor({
  open,
  initial,
  title,
  busy,
  error,
  onClose,
  onSave,
}: {
  open: boolean;
  initial: Draft | null;
  title: string;
  busy: false | "save" | "run";
  error: string | null;
  onClose: () => void;
  onSave: (draft: Draft, run: boolean) => void;
}) {
  const [draft, setDraft] = useState<Draft>(blank);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!open) return;
    const d = initial ?? blank();
    setDraft(d);
    // A new test opens its first behavior for writing.
    setExpanded(initial ? null : 0);
    setTried(false);
  }, [open, initial]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const behaviors = draft.behaviors;
  const setBehavior = (i: number, patch: Partial<Draft["behaviors"][number]>) =>
    setDraft((d) => ({ ...d, behaviors: d.behaviors.map((b, j) => (j === i ? { ...b, ...patch } : b)) }));
  const usable = behaviors.filter((b) => b.description.trim() || b.name.trim());
  const problem = !draft.name.trim() ? "Give the test a name." : !draft.scenario.trim() ? "Describe the caller's scenario." : !usable.length ? "Add at least one expected behavior." : null;

  const submit = (run: boolean) => {
    setTried(true);
    if (problem) return;
    onSave({ ...draft, behaviors: usable }, run);
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-[6vh] backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="w-full max-w-[1040px] rounded-xl border bg-background shadow-xl"
            initial={{ opacity: 0, y: 12, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.985 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex items-center justify-between px-6 pt-5">
              <h2 className="text-[17px] font-semibold tracking-tight text-foreground">{title}</h2>
              <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 flex size-8 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground">
                <X className="size-4" />
              </button>
            </div>

            <div className="grid gap-6 px-6 py-5 md:grid-cols-2">
              <div className="space-y-4">
                <div>
                  <label htmlFor="test-name" className="mb-1.5 block text-[13px] font-medium text-foreground">
                    Name
                  </label>
                  <input
                    id="test-name"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    placeholder="Books a cleaning for next week"
                    className={`${inputCls} h-10`}
                    autoFocus={!initial}
                  />
                </div>
                <div>
                  <label htmlFor="test-scenario" className="mb-1.5 block text-[13px] font-medium text-foreground">
                    User scenario
                  </label>
                  <textarea
                    id="test-scenario"
                    rows={13}
                    value={draft.scenario}
                    onChange={(e) => setDraft({ ...draft, scenario: e.target.value })}
                    placeholder={"You are a returning patient who wants a teeth cleaning next week. You prefer mornings. When asked for your name, say 'Asha Rao'. If offered Tuesday 10 AM, accept."}
                    className={`${inputCls} resize-y py-2.5 text-[14px] leading-relaxed`}
                  />
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{SCENARIO_HINT}</p>
                </div>
              </div>

              <div className="flex min-h-0 flex-col">
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="text-[13px] font-medium text-foreground">Expected behaviors</p>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft((d) => ({ ...d, behaviors: [...d.behaviors, { name: "", description: "" }] }));
                      setExpanded(behaviors.length);
                    }}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[13px] font-medium text-foreground transition-colors hover:bg-accent"
                  >
                    <Plus className="size-3.5" /> Add
                  </button>
                </div>
                <p className="mb-3 text-xs text-muted-foreground">Concrete yes/no checks of the agent. The test passes only if every one passes.</p>
                <ul className="max-h-[420px] flex-1 divide-y overflow-y-auto rounded-lg border">
                  {behaviors.map((b, i) => {
                    const isOpen = expanded === i;
                    return (
                      <li key={b.id ?? `new-${i}`}>
                        <button type="button" onClick={() => setExpanded(isOpen ? null : i)} className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50">
                          <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground tabular-nums">{i + 1}</span>
                          <span className="min-w-0 flex-1">
                            <span className={`block text-[14px] leading-snug ${b.description || b.name ? "text-foreground" : "text-muted-foreground"}`}>
                              {b.description || b.name || "New behavior"}
                            </span>
                            {b.name && b.description && !isOpen ? <span className="mt-0.5 block text-xs text-muted-foreground">{b.name}</span> : null}
                          </span>
                          <ChevronDown className={`mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
                        </button>
                        {isOpen ? (
                          <div className="space-y-3 bg-muted/30 px-4 pt-1 pb-4">
                            <div>
                              <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor={`b-name-${i}`}>
                                Short name
                              </label>
                              <input
                                id={`b-name-${i}`}
                                value={b.name}
                                onChange={(e) => setBehavior(i, { name: e.target.value })}
                                placeholder="Confirms the slot"
                                className={`${inputCls} h-9`}
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor={`b-desc-${i}`}>
                                What the agent must do
                              </label>
                              <textarea
                                id={`b-desc-${i}`}
                                rows={3}
                                value={b.description}
                                onChange={(e) => setBehavior(i, { description: e.target.value })}
                                placeholder="Repeats the booked date and time back to the caller before ending the call."
                                className={`${inputCls} resize-y py-2 text-[13.5px] leading-relaxed`}
                                autoFocus={!b.description}
                              />
                            </div>
                            <button
                              type="button"
                              disabled={behaviors.length === 1}
                              onClick={() => {
                                setDraft((d) => ({ ...d, behaviors: d.behaviors.filter((_, j) => j !== i) }));
                                setExpanded(null);
                              }}
                              className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-destructive disabled:opacity-40"
                            >
                              <Trash2 className="size-3.5" /> Remove
                            </button>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t px-6 py-4">
              {(tried && problem) || error ? <p className="mr-auto text-[13px] text-destructive">{(tried && problem) || error}</p> : null}
              <button type="button" onClick={onClose} className={btn("ghost")}>
                Cancel
              </button>
              <button type="button" onClick={() => submit(true)} disabled={Boolean(busy)} className={btn("secondary")}>
                {busy === "run" ? <LoaderCircle className="size-4 animate-spin" /> : <Play className="size-3.5" />} Save and run
              </button>
              <button type="button" onClick={() => submit(false)} disabled={Boolean(busy)} className={btn("primary")}>
                {busy === "save" ? <LoaderCircle className="size-4 animate-spin" /> : null} Save
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
