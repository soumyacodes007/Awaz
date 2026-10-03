"use client";

import { Check, FileText, Plus } from "lucide-react";
import Link from "next/link";

import { Badge, btn } from "@/components/app/ui";
import { TOOL_KINDS } from "@/lib/tools";

import { Section, type EditorProps } from "./types";

function Pick({
  on,
  onToggle,
  disabled,
  icon,
  title,
  body,
  badge,
}: {
  on: boolean;
  onToggle: () => void;
  disabled: boolean;
  icon: React.ReactNode;
  title: string;
  body?: string | null;
  badge?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      disabled={disabled}
      onClick={onToggle}
      className={`flex w-full items-start gap-3 rounded-md px-3.5 py-3 text-left transition ${
        on ? "bg-muted border border-foreground/20" : "border hover:border-foreground/25"
      } disabled:pointer-events-none`}
    >
      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-white border">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-[14px] text-foreground">
          <span className="truncate">{title}</span>
          {badge}
        </span>
        {body ? <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-relaxed text-muted-foreground">{body}</span> : null}
      </span>
      <span
        className={`mt-1 flex size-5 shrink-0 items-center justify-center rounded-md transition ${
          on ? "bg-primary text-white" : "border"
        }`}
      >
        {on ? <Check className="size-3.5" strokeWidth={2.5} /> : null}
      </span>
    </button>
  );
}

export function ToolsTab({
  tools,
  documents,
  toolUuids,
  documentUuids,
  onTools,
  onDocuments,
  readOnly,
}: {
  tools: EditorProps["tools"];
  documents: EditorProps["documents"];
  toolUuids: string[];
  documentUuids: string[];
  onTools: (v: string[]) => void;
  onDocuments: (v: string[]) => void;
  readOnly: boolean;
}) {
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const hasEndCall = tools.some((t) => t.category === "end_call" && toolUuids.includes(t.uuid));

  return (
    <div className="space-y-5">
      <Section
        title="Tools"
        sub="Actions the agent can take during a call, like ending it, transferring to a person or calling your API."
        actions={
          <Link href="/tools/new" className={btn("secondary", "sm")}>
            <Plus className="size-3.5" /> New tool
          </Link>
        }
      >
        {!hasEndCall && !readOnly ? (
          <p className="mb-3 rounded-md bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-800 border border-amber-200">
            Without an End call tool, the agent can&apos;t hang up. Calls will only end when the caller hangs up or the time limit is reached.
          </p>
        ) : null}
        {tools.length ? (
          <div className="grid gap-2 md:grid-cols-2">
            {tools.map((t) => {
              const kind = TOOL_KINDS[t.category as keyof typeof TOOL_KINDS];
              const Icon = kind?.icon;
              return (
                <Pick
                  key={t.uuid}
                  on={toolUuids.includes(t.uuid)}
                  onToggle={() => onTools(toggle(toolUuids, t.uuid))}
                  disabled={readOnly}
                  icon={Icon ? <Icon className="size-4" style={{ color: kind.color }} strokeWidth={1.75} /> : null}
                  title={t.name}
                  body={t.description}
                  badge={<Badge>{kind?.label ?? t.category}</Badge>}
                />
              );
            })}
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">No tools in this workspace yet.</p>
        )}
      </Section>

      <Section
        title="Knowledge base"
        sub="Documents the agent can search to answer questions. Keep the prompt short and put facts here."
        actions={
          <Link href="/resources/knowledge" className={btn("secondary", "sm")}>
            <Plus className="size-3.5" /> Add documents
          </Link>
        }
      >
        {documents.length ? (
          <div className="grid gap-2 md:grid-cols-2">
            {documents.map((d) => (
              <Pick
                key={d.uuid}
                on={documentUuids.includes(d.uuid)}
                onToggle={() => onDocuments(toggle(documentUuids, d.uuid))}
                disabled={readOnly}
                icon={<FileText className="size-4 text-foreground" strokeWidth={1.75} />}
                title={d.name}
                badge={d.status !== "completed" ? <Badge tone={d.status === "failed" ? "red" : "amber"}>{d.status}</Badge> : null}
              />
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">No documents uploaded yet.</p>
        )}
      </Section>
    </div>
  );
}
