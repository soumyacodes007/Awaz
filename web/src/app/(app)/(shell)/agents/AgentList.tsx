"use client";

import { ChevronDown, LoaderCircle, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { Modal } from "@/components/app/client";
import { btn, ErrorNote, FormRow, inputCls } from "@/components/app/ui";
import { createAgent } from "@/lib/agent-client";
import { TEMPLATES } from "@/lib/agent-templates";

export type AgentRow = { id: number; name: string; line: string; version: number | null; draft: boolean };

/** Split button: main part creates a blank agent, the chevron picks a template. */
export function NewAgentButton({ className = "", label = "Create agent" }: { className?: string; label?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const [name, setName] = useState("");
  const [template, setTemplate] = useState(TEMPLATES[0].id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu]);

  const start = (id: string) => {
    setTemplate(id);
    setMenu(false);
    setOpen(true);
  };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = TEMPLATES.find((x) => x.id === template) ?? TEMPLATES[0];
    setBusy(true);
    setError(null);
    const res = await createAgent(name.trim() || t.name, t.prompt, t.greeting);
    setBusy(false);
    if ("error" in res) return setError(res.error ?? null);
    setOpen(false);
    setName("");
    router.push(`/agents/${res.id}`);
    router.refresh();
  }

  return (
    <div ref={ref} className={`relative flex ${className}`}>
      <button type="button" onClick={() => start(TEMPLATES[0].id)} className={btn("primary", "md", "flex-1 rounded-r-none")}>
        {label}
      </button>
      <button
        type="button"
        aria-label="Create from a template"
        aria-expanded={menu}
        onClick={() => setMenu((m) => !m)}
        className={btn("primary", "md", "rounded-l-none border-l border-white/20 px-2.5")}
      >
        <ChevronDown className="size-4" />
      </button>
      {menu ? (
        <div role="menu" className="absolute top-11 right-0 z-30 w-64 rounded-md border bg-background p-1 shadow-md">
          <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Start from a template</p>
          {TEMPLATES.map((t) => (
            <button key={t.id} type="button" role="menuitem" onClick={() => start(t.id)} className="block w-full rounded-sm px-2 py-1.5 text-left hover:bg-accent">
              <span className="block text-sm text-foreground">{t.name}</span>
              <span className="block text-xs text-muted-foreground">{t.blurb}</span>
            </button>
          ))}
        </div>
      ) : null}

      <Modal open={open} onClose={() => !busy && setOpen(false)} title="Create agent" sub="Pick a starting point. You can change everything later.">
        <form onSubmit={submit} className="space-y-5">
          <FormRow label="Name" htmlFor="agent-name">
            <input
              id="agent-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={TEMPLATES.find((t) => t.id === template)?.name}
              className={`${inputCls} h-9`}
            />
          </FormRow>
          <div>
            <p className="mb-1.5 text-[13px] font-medium text-foreground">Template</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={template === t.id}
                  onClick={() => setTemplate(t.id)}
                  className={`rounded-md border px-3 py-2.5 text-left transition-colors ${
                    template === t.id ? "border-foreground ring-1 ring-foreground" : "hover:bg-accent"
                  }`}
                >
                  <span className="block text-sm font-medium text-foreground">{t.name}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{t.blurb}</span>
                </button>
              ))}
            </div>
          </div>
          {error ? <ErrorNote>{error}</ErrorNote> : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className={btn("ghost")}>
              Cancel
            </button>
            <button type="submit" disabled={busy} className={btn("primary")}>
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              Create agent
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

export function AgentList({ agents, open }: { agents: AgentRow[]; open: boolean }) {
  const pathname = usePathname();
  const [q, setQ] = useState("");
  const filtered = useMemo(() => agents.filter((a) => a.name.toLowerCase().includes(q.trim().toLowerCase())), [agents, q]);
  const onDetail = pathname !== "/agents";

  return (
    <section
      aria-label="Agents"
      className={`w-full shrink-0 flex-col border-r bg-background lg:w-[300px] ${onDetail ? "hidden" : "flex"} ${open ? "lg:flex" : "lg:hidden"}`}
    >
      <div className="space-y-3 border-b p-4">
        <h1 className="text-base font-semibold text-foreground">
          Agents <span className="ml-0.5 text-xs font-normal text-muted-foreground">{agents.length}</span>
        </h1>
        <NewAgentButton />
        <label className="relative block">
          <span className="sr-only">Search agents</span>
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search agents" className={`${inputCls} h-9 bg-muted/50 pl-8 shadow-none`} />
        </label>
      </div>

      <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {filtered.map((a) => {
          const active = pathname === `/agents/${a.id}` || pathname.startsWith(`/agents/${a.id}/`);
          return (
            <li key={a.id}>
              <Link
                href={`/agents/${a.id}`}
                aria-current={active ? "page" : undefined}
                className={`relative flex items-start gap-2 rounded-md border px-3 py-2.5 transition-colors ${
                  active ? "border-foreground/15 bg-muted" : "border-transparent hover:bg-muted/60"
                }`}
              >
                {active ? <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-foreground" /> : null}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{a.name}</span>
                  <span className="mt-0.5 block truncate text-[13px] text-muted-foreground">{a.line}</span>
                </span>
                {a.version ? (
                  <span
                    className={`mt-0.5 shrink-0 rounded border px-1.5 font-mono text-[11px] leading-[18px] ${
                      a.draft ? "border-amber-200 bg-amber-50 text-amber-700" : "bg-background text-muted-foreground"
                    }`}
                    title={a.draft ? "Has unpublished changes" : "Published"}
                  >
                    v{a.version}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
        {!filtered.length ? <li className="px-3 py-10 text-center text-[13px] text-muted-foreground">{agents.length ? "No agents match." : "No agents yet."}</li> : null}
      </ul>
    </section>
  );
}
