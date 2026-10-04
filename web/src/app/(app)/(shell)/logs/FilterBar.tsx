"use client";

import { Calendar, Check, ChevronDown, ListFilter, Search, Settings2, X } from "lucide-react";
import { useState } from "react";

import { Popover } from "@/components/app/client";
import { inputBase, inputCls } from "@/components/app/ui";
import { CHANNELS, DIRECTIONS, RANGES } from "@/lib/logs";

type SetParams = (patch: Record<string, string | null>) => void;

const field = "flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm shadow-xs transition-colors hover:bg-accent";

function Labelled({ label, onClear, children }: { label: string; onClear?: () => void; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-1 flex h-4 items-center gap-1 text-xs text-muted-foreground">
        {label}
        {onClear ? (
          <button type="button" onClick={onClear} aria-label={`Clear ${label.toLowerCase()}`} className="rounded-sm hover:text-foreground">
            <X className="size-3" />
          </button>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function Check2({ on }: { on: boolean }) {
  return (
    <span className={`flex size-4 shrink-0 items-center justify-center rounded-[4px] border ${on ? "border-primary bg-primary text-primary-foreground" : "bg-background"}`}>
      {on ? <Check className="size-3" strokeWidth={3} /> : null}
    </span>
  );
}

/** Text input that applies on Enter or blur, so typing doesn't refetch per key. */
function CommitInput({ value, onCommit, placeholder, className = "", ...rest }: { value: string; onCommit: (v: string) => void; placeholder: string; className?: string } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const [v, setV] = useState(value);
  return (
    <input
      {...rest}
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => v !== value && onCommit(v.trim())}
      onKeyDown={(e) => e.key === "Enter" && onCommit(v.trim())}
      className={`${inputCls} h-9 ${className}`}
    />
  );
}

export const COLUMNS = [
  { id: "id", label: "Call ID" },
  { id: "agent", label: "Agent" },
  { id: "version", label: "Version" },
  { id: "assistant_number", label: "Agent phone number" },
  { id: "customer_number", label: "Customer phone number" },
  { id: "type", label: "Type" },
  { id: "ended", label: "Ended reason" },
  { id: "start", label: "Start time" },
  { id: "duration", label: "Duration" },
  { id: "cost", label: "Cost" },
] as const;
export type ColumnId = (typeof COLUMNS)[number]["id"];

export function FilterBar({
  params,
  set,
  agents,
  numbers,
  chat,
  hidden,
  onHidden,
}: {
  params: Record<string, string>;
  set: SetParams;
  agents: { id: number; name: string }[];
  numbers: string[];
  chat: boolean;
  hidden: ColumnId[];
  onHidden: (v: ColumnId[]) => void;
}) {
  const [agentQuery, setAgentQuery] = useState("");
  const range = RANGES.find((r) => r.id === (params.range || "30d")) ?? RANGES[2];
  const selectedAgents = (params.agents ?? "").split(",").filter(Boolean).map(Number);
  const channels = (params.channels ?? "").split(",").filter(Boolean);
  const directions = (params.directions ?? "").split(",").filter(Boolean);
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]).join(",") || null;
  const extra = ["ended", "min", "max", "status"].filter((k) => params[k]).length;

  return (
    <div className="flex flex-wrap items-end gap-x-3 gap-y-3">
      <Labelled label="Time range" onClear={params.range && params.range !== "30d" ? () => set({ range: null }) : undefined}>
        <Popover
          width={200}
          trigger={({ toggle }) => (
            <button type="button" onClick={toggle} className={`${field} w-[172px]`}>
              <Calendar className="size-4 text-muted-foreground" />
              <span className="truncate">{range.label}</span>
            </button>
          )}
        >
          {(close) =>
            RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  set({ range: r.id === "30d" ? null : r.id });
                  close();
                }}
                className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
              >
                {r.label}
                {r.id === range.id ? <Check className="size-4" /> : null}
              </button>
            ))
          }
        </Popover>
      </Labelled>

      <Labelled label="Call ID" onClear={params.id ? () => set({ id: null }) : undefined}>
        <CommitInput key={params.id ?? ""} value={params.id ?? ""} onCommit={(v) => set({ id: v.replace(/\D/g, "") || null })} placeholder="Call ID" inputMode="numeric" className="w-[150px] font-mono" />
      </Labelled>

      <Labelled label="Agents" onClear={selectedAgents.length ? () => set({ agents: null }) : undefined}>
        <Popover
          width={300}
          trigger={({ toggle }) => (
            <button type="button" onClick={toggle} className={`${field} min-w-[220px] max-w-[460px]`}>
              {selectedAgents.length ? (
                <span className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                  {selectedAgents.slice(0, 2).map((id) => (
                    <span key={id} className="truncate rounded border bg-muted px-1.5 text-xs leading-5">
                      {agents.find((a) => a.id === id)?.name ?? `Agent ${id}`}
                    </span>
                  ))}
                  {selectedAgents.length > 2 ? <span className="shrink-0 rounded border bg-muted px-1.5 text-xs leading-5">+{selectedAgents.length - 2} more</span> : null}
                </span>
              ) : (
                <span className="flex-1 text-left text-muted-foreground">All agents</span>
              )}
              <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
            </button>
          )}
        >
          {() => (
            <div>
              <label className="relative mb-1 block">
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input autoFocus value={agentQuery} onChange={(e) => setAgentQuery(e.target.value)} placeholder="Search agents" className={`${inputCls} h-8 pl-8 text-[13px]`} />
              </label>
              <div className="max-h-64 overflow-y-auto">
                {agents
                  .filter((a) => a.name.toLowerCase().includes(agentQuery.toLowerCase()))
                  .map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => set({ agents: toggle(selectedAgents.map(String), String(a.id)) })}
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                    >
                      <Check2 on={selectedAgents.includes(a.id)} />
                      <span className="truncate">{a.name}</span>
                    </button>
                  ))}
              </div>
            </div>
          )}
        </Popover>
      </Labelled>

      {!chat ? (
        <>
          <Labelled label="Phone numbers" onClear={params.number ? () => set({ number: null }) : undefined}>
            <Popover
              width={240}
              trigger={({ toggle }) => (
                <button type="button" onClick={toggle} className={`${field} w-[172px]`}>
                  <span className={`flex-1 truncate text-left ${params.number ? "font-mono text-[13px]" : "text-muted-foreground"}`}>{params.number || "Phone numbers"}</span>
                  <ChevronDown className="size-4 text-muted-foreground" />
                </button>
              )}
            >
              {(close) =>
                numbers.length ? (
                  numbers.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => {
                        set({ number: params.number === n ? null : n });
                        close();
                      }}
                      className="flex w-full items-center justify-between rounded-sm px-2 py-1.5 font-mono text-[13px] hover:bg-accent"
                    >
                      {n}
                      {params.number === n ? <Check className="size-4" /> : null}
                    </button>
                  ))
                ) : (
                  <p className="px-2 py-3 text-center text-[13px] text-muted-foreground">No phone numbers yet.</p>
                )
              }
            </Popover>
          </Labelled>

          <Labelled label="Call types" onClear={channels.length || directions.length ? () => set({ channels: null, directions: null }) : undefined}>
            <Popover
              width={200}
              trigger={({ toggle }) => (
                <button type="button" onClick={toggle} className={`${field} w-[172px]`}>
                  <span className={`flex-1 truncate text-left ${channels.length || directions.length ? "" : "text-muted-foreground"}`}>
                    {[...channels.map((c) => CHANNELS.find((x) => x.id === c)?.label), ...directions.map((d) => DIRECTIONS.find((x) => x.id === d)?.label)].join(", ") || "Call types"}
                  </span>
                  <ChevronDown className="size-4 text-muted-foreground" />
                </button>
              )}
            >
              {() => (
                <div>
                  <p className="px-2 pt-1 pb-1 text-xs text-muted-foreground">Channel</p>
                  {CHANNELS.map((c) => (
                    <button key={c.id} type="button" onClick={() => set({ channels: toggle(channels, c.id) })} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent">
                      <Check2 on={channels.includes(c.id)} /> {c.label}
                    </button>
                  ))}
                  <p className="mt-1 border-t px-2 pt-2 pb-1 text-xs text-muted-foreground">Direction</p>
                  {DIRECTIONS.map((d) => (
                    <button key={d.id} type="button" onClick={() => set({ directions: toggle(directions, d.id) })} className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent">
                      <Check2 on={directions.includes(d.id)} /> {d.label}
                    </button>
                  ))}
                </div>
              )}
            </Popover>
          </Labelled>

          <Labelled label="Customer phone number" onClear={params.customer ? () => set({ customer: null }) : undefined}>
            <CommitInput key={params.customer ?? ""} value={params.customer ?? ""} onCommit={(v) => set({ customer: v || null })} placeholder="+91 98…" className="w-[190px] font-mono" />
          </Labelled>
        </>
      ) : null}

      <div className="ml-auto flex items-center gap-2">
        <Popover
          align="right"
          width={260}
          trigger={({ toggle }) => (
            <button type="button" onClick={toggle} aria-label="More filters" title="More filters" className={`${field} relative w-9 justify-center px-0`}>
              <ListFilter className="size-4" />
              {extra ? <span className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] text-primary-foreground">{extra}</span> : null}
            </button>
          )}
        >
          {() => (
            <div className="space-y-3 p-1">
              <div>
                <p className="mb-1 text-xs text-muted-foreground">Ended reason</p>
                <CommitInput key={params.ended ?? ""} value={params.ended ?? ""} onCommit={(v) => set({ ended: v.replace(/\s+/g, "") || null })} placeholder="user_hangup,end_call" className="text-[13px]" />
              </div>
              <div>
                <p className="mb-1 text-xs text-muted-foreground">Duration (seconds)</p>
                <div className="flex items-center gap-2">
                  <CommitInput key={`min${params.min ?? ""}`} value={params.min ?? ""} onCommit={(v) => set({ min: v || null })} placeholder="Min" inputMode="numeric" />
                  <span className="text-muted-foreground">–</span>
                  <CommitInput key={`max${params.max ?? ""}`} value={params.max ?? ""} onCommit={(v) => set({ max: v || null })} placeholder="Max" inputMode="numeric" />
                </div>
              </div>
              <div>
                <p className="mb-1 text-xs text-muted-foreground">Status</p>
                <select value={params.status ?? ""} onChange={(e) => set({ status: e.target.value || null })} className={`${inputBase} h-9 w-full`}>
                  <option value="">Any</option>
                  <option value="completed">Completed</option>
                  <option value="in_progress">In progress</option>
                </select>
              </div>
            </div>
          )}
        </Popover>
        <Popover
          align="right"
          width={220}
          trigger={({ toggle }) => (
            <button type="button" onClick={toggle} aria-label="Columns" title="Columns" className={`${field} w-9 justify-center px-0`}>
              <Settings2 className="size-4" />
            </button>
          )}
        >
          {() => (
            <div>
              <p className="px-2 pt-1 pb-1 text-xs text-muted-foreground">Columns</p>
              {COLUMNS.filter((c) => c.id !== "id").map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onHidden(hidden.includes(c.id) ? hidden.filter((h) => h !== c.id) : [...hidden, c.id])}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                >
                  <Check2 on={!hidden.includes(c.id)} /> {c.label}
                </button>
              ))}
            </div>
          )}
        </Popover>
      </div>
    </div>
  );
}
