"use client";

import { Bold, Braces, ChevronDown, Code2, Eye, Italic, List, ListOrdered, Maximize2, Minimize2, Redo2, Search, Undo2, X } from "lucide-react";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { Dropdown } from "@/components/app/client";
import { btn } from "@/components/app/ui";

// Markdown prompt editor with Vapi's toolbar: find, undo/redo, block style,
// bold/italic, lists and {{variables}}. "Code" edits the raw text; "Visual"
// shows it rendered.

type Sel = { start: number; end: number };

function renderInline(text: string) {
  // **bold**, *italic*, {{variable}}
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|\{\{[^}]+\}\})/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("{{") && p.endsWith("}}"))
      return (
        <code key={i} className="rounded border bg-muted px-1 font-mono text-[12.5px]">
          {p}
        </code>
      );
    if (p.startsWith("*") && p.endsWith("*") && p.length > 2) return <em key={i}>{p.slice(1, -1)}</em>;
    return <Fragment key={i}>{p}</Fragment>;
  });
}

function Preview({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="space-y-1.5 text-sm leading-7 text-foreground">
      {lines.map((l, i) => {
        const h = /^(#{1,3})\s+(.*)$/.exec(l);
        if (h) {
          const size = h[1].length === 1 ? "text-lg" : h[1].length === 2 ? "text-base" : "text-sm";
          return (
            <p key={i} className={`${size} pt-2 font-semibold tracking-tight`}>
              {renderInline(h[2])}
            </p>
          );
        }
        const ul = /^\s*[-*]\s+(.*)$/.exec(l);
        if (ul)
          return (
            <p key={i} className="flex gap-2 pl-1">
              <span className="text-muted-foreground">•</span>
              <span>{renderInline(ul[1])}</span>
            </p>
          );
        const ol = /^\s*(\d+)\.\s+(.*)$/.exec(l);
        if (ol)
          return (
            <p key={i} className="flex gap-2 pl-1">
              <span className="text-muted-foreground tabular-nums">{ol[1]}.</span>
              <span>{renderInline(ol[2])}</span>
            </p>
          );
        return l.trim() ? <p key={i}>{renderInline(l)}</p> : <div key={i} className="h-2" />;
      })}
    </div>
  );
}

const ToolButton = ({ label, onClick, children, active }: { label: string; onClick: () => void; children: React.ReactNode; active?: boolean }) => (
  <button
    type="button"
    aria-label={label}
    title={label}
    onMouseDown={(e) => e.preventDefault()}
    onClick={onClick}
    className={`flex size-8 items-center justify-center rounded-md transition-colors ${active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground"}`}
  >
    {children}
  </button>
);

export function PromptEditor({ value, onChange, readOnly }: { value: string; onChange: (v: string) => void; readOnly: boolean }) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<"code" | "visual">("code");
  const [full, setFull] = useState(false);
  const [find, setFind] = useState<string | null>(null);
  const [matches, setMatches] = useState(0);

  // Own undo history: programmatic edits (toolbar) would break the native one.
  const history = useRef<{ stack: string[]; index: number; last: number }>({ stack: [value], index: 0, last: 0 });
  const record = useCallback((next: string, coalesce: boolean) => {
    const h = history.current;
    const now = Date.now();
    if (coalesce && now - h.last < 700 && h.index === h.stack.length - 1 && h.index > 0) h.stack[h.index] = next;
    else {
      h.stack = [...h.stack.slice(0, h.index + 1), next].slice(-200);
      h.index = h.stack.length - 1;
    }
    h.last = now;
  }, []);

  const commit = (next: string, sel?: Sel, coalesce = false) => {
    record(next, coalesce);
    onChange(next);
    if (sel)
      requestAnimationFrame(() => {
        ta.current?.focus();
        ta.current?.setSelectionRange(sel.start, sel.end);
      });
  };

  const undo = () => {
    const h = history.current;
    if (h.index <= 0) return;
    h.index -= 1;
    onChange(h.stack[h.index]);
  };
  const redo = () => {
    const h = history.current;
    if (h.index >= h.stack.length - 1) return;
    h.index += 1;
    onChange(h.stack[h.index]);
  };

  const sel = (): Sel => ({ start: ta.current?.selectionStart ?? value.length, end: ta.current?.selectionEnd ?? value.length });

  const wrap = (mark: string) => {
    const { start, end } = sel();
    const inner = value.slice(start, end) || "text";
    commit(value.slice(0, start) + mark + inner + mark + value.slice(end), { start: start + mark.length, end: start + mark.length + inner.length });
  };

  // Apply a prefix ("# ", "- ", "1. ") to every selected line; "" clears block styles.
  const prefixLines = (prefix: string | ((i: number) => string)) => {
    const { start, end } = sel();
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const lineEndIdx = value.indexOf("\n", end);
    const lineEnd = lineEndIdx === -1 ? value.length : lineEndIdx;
    const block = value.slice(lineStart, lineEnd).split("\n");
    const next = block.map((l, i) => {
      const bare = l.replace(/^(#{1,3}\s+|\s*[-*]\s+|\s*\d+\.\s+)/, "");
      return (typeof prefix === "function" ? prefix(i) : prefix) + bare;
    });
    const joined = next.join("\n");
    commit(value.slice(0, lineStart) + joined + value.slice(lineEnd), { start: lineStart, end: lineStart + joined.length });
  };

  const insertVariable = () => {
    const { start, end } = sel();
    const name = value.slice(start, end).trim().replace(/\s+/g, "_") || "variable";
    const text = `{{${name}}}`;
    commit(value.slice(0, start) + text + value.slice(end), { start: start + 2, end: start + 2 + name.length });
  };

  const findNext = (term: string, from?: number) => {
    if (!term) return setMatches(0);
    const lower = value.toLowerCase();
    const t = term.toLowerCase();
    setMatches(lower.split(t).length - 1);
    let i = lower.indexOf(t, from ?? (ta.current?.selectionEnd ?? 0));
    if (i === -1) i = lower.indexOf(t);
    if (i === -1) return;
    ta.current?.focus();
    ta.current?.setSelectionRange(i, i + term.length);
    // Scroll the match into view.
    const before = value.slice(0, i).split("\n").length;
    if (ta.current) ta.current.scrollTop = Math.max(0, (before - 4) * 28);
  };

  // Grow with the content (wrapped lines included) so the page, not the box, scrolls.
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    if (full) {
      el.style.height = "";
      return;
    }
    el.style.height = "auto";
    el.style.height = `${Math.max(420, el.scrollHeight + 2)}px`;
  }, [value, full, mode]);

  useEffect(() => {
    if (!full) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [full]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) return;
    const actions: Record<string, () => void> = {
      z: e.shiftKey ? redo : undo,
      y: redo,
      b: () => wrap("**"),
      i: () => wrap("*"),
      f: () => setFind(""),
    };
    const run = actions[e.key.toLowerCase()];
    if (run) {
      e.preventDefault();
      run();
    }
  };

  const body = (
    <section className={`flex flex-col rounded-lg border bg-card shadow-xs ${full ? "fixed inset-4 z-50 shadow-xl" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3.5 pb-3">
        <h2 className="text-sm font-semibold text-foreground">System prompt</h2>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border p-0.5">
            {[
              { id: "visual" as const, label: "Visual", icon: Eye },
              { id: "code" as const, label: "Code", icon: Code2 },
            ].map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setMode(id)}
                aria-pressed={mode === id}
                className={`flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-[13px] transition-colors ${
                  mode === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="size-3.5" /> {label}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setFull((f) => !f)} aria-label={full ? "Exit full screen" : "Full screen"} className={btn("secondary", "md", "size-9 px-0")}>
            {full ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
          </button>
        </div>
      </div>

      {mode === "code" ? (
        <div className="mx-4 flex flex-wrap items-center gap-0.5 rounded-md border bg-muted/40 px-1 py-1">
          <ToolButton label="Find (Ctrl F)" onClick={() => setFind(find === null ? "" : null)} active={find !== null}>
            <Search className="size-4" />
          </ToolButton>
          <ToolButton label="Undo (Ctrl Z)" onClick={undo}>
            <Undo2 className="size-4" />
          </ToolButton>
          <ToolButton label="Redo (Ctrl Shift Z)" onClick={redo}>
            <Redo2 className="size-4" />
          </ToolButton>
          <span className="mx-1 h-5 w-px bg-border" />
          <Dropdown
            align="left"
            width={180}
            trigger={({ toggle }) => (
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={toggle} className="flex h-8 items-center gap-1.5 rounded-md px-2 text-[13px] text-foreground hover:bg-accent">
                <span className="font-serif text-[13px]">T</span> Normal text <ChevronDown className="size-3.5 text-muted-foreground" />
              </button>
            )}
            items={[
              { label: "Normal text", onSelect: () => prefixLines("") },
              { label: "Heading 1", onSelect: () => prefixLines("# ") },
              { label: "Heading 2", onSelect: () => prefixLines("## ") },
              { label: "Heading 3", onSelect: () => prefixLines("### ") },
            ]}
          />
          <span className="mx-1 h-5 w-px bg-border" />
          <ToolButton label="Bold (Ctrl B)" onClick={() => wrap("**")}>
            <Bold className="size-4" />
          </ToolButton>
          <ToolButton label="Italic (Ctrl I)" onClick={() => wrap("*")}>
            <Italic className="size-4" />
          </ToolButton>
          <ToolButton label="Bulleted list" onClick={() => prefixLines("- ")}>
            <List className="size-4" />
          </ToolButton>
          <ToolButton label="Numbered list" onClick={() => prefixLines((i) => `${i + 1}. `)}>
            <ListOrdered className="size-4" />
          </ToolButton>
          <ToolButton label="Insert variable" onClick={insertVariable}>
            <Braces className="size-4" />
          </ToolButton>
          {find !== null ? (
            <div className="ml-auto flex items-center gap-1">
              <input
                autoFocus
                value={find}
                onChange={(e) => {
                  setFind(e.target.value);
                  findNext(e.target.value, 0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    findNext(find);
                  }
                  if (e.key === "Escape") setFind(null);
                }}
                placeholder="Find in prompt"
                className="h-7 w-44 rounded-sm border bg-background px-2 text-[13px] outline-none focus:border-ring"
              />
              <span className="w-14 text-center text-xs text-muted-foreground tabular-nums">{find ? `${matches} found` : ""}</span>
              <ToolButton label="Close find" onClick={() => setFind(null)}>
                <X className="size-3.5" />
              </ToolButton>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className={`mx-4 mt-3 mb-4 rounded-md border bg-background ${full ? "min-h-0 flex-1" : ""}`}>
        {mode === "code" ? (
          <textarea
            ref={ta}
            aria-label="System prompt"
            value={value}
            readOnly={readOnly}
            onChange={(e) => commit(e.target.value, undefined, true)}
            onKeyDown={onKeyDown}
            spellCheck
            placeholder="You are a friendly receptionist for…"
            className={`block w-full resize-none overflow-hidden rounded-md bg-transparent px-4 py-3 text-sm leading-7 text-foreground outline-none placeholder:text-muted-foreground ${
              full ? "h-full overflow-y-auto" : "min-h-[420px]"
            }`}
          />
        ) : (
          <div className={`overflow-y-auto px-4 py-3 ${full ? "h-full" : "min-h-[420px]"}`}>{value.trim() ? <Preview text={value} /> : <p className="text-sm text-muted-foreground">Nothing yet.</p>}</div>
        )}
      </div>
      <div className="flex justify-between px-4 pb-3 text-xs text-muted-foreground">
        <span>
          Markdown supported. Use <code className="font-mono">{"{{first_name}}"}</code> style variables for call data.
        </span>
        <span className="tabular-nums">{value.length.toLocaleString("en-IN")} chars</span>
      </div>
    </section>
  );

  return full ? (
    <>
      <div className="fixed inset-0 z-40 bg-black/40" onClick={() => setFull(false)} />
      {body}
    </>
  ) : (
    body
  );
}
