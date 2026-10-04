"use client";

import {
  AlertTriangle,
  Archive,
  ChevronDown,
  ChevronLeft,
  Copy,
  History,
  LoaderCircle,
  MessageSquareText,
  MoreVertical,
  PanelLeft,
  Phone,
  Send,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { listAgentVersionsApiV1AgentsAgentIdVersionsGet, type AgentSpec } from "@/client";
import { CopyButton, Dropdown } from "@/components/app/client";
import { btn } from "@/components/app/ui";
import { dateTime } from "@/lib/format";

import { useAgentsShell } from "../AgentsShell";

export type Version = { id: number; number: number | null; status: string; at: string; kind: "agent" | "multi_step"; agent: AgentSpec; settings: Record<string, unknown> };
type SaveState = "saved" | "dirty" | "saving" | "error";

const STATUS_TONE: Record<string, string> = {
  draft: "text-amber-600",
  published: "text-emerald-600",
  archived: "text-muted-foreground",
};

function VersionMenu({ agentId, status, number, onRestore }: { agentId: number; status: string | null; number: number | null; onRestore: (v: Version) => void }) {
  const [versions, setVersions] = useState<Version[] | null>(null);
  const load = async () => {
    const res = await listAgentVersionsApiV1AgentsAgentIdVersionsGet({ path: { agent_id: agentId } }).catch(() => null);
    setVersions(
      (res?.data ?? []).map((v) => ({ id: v.id, number: v.version_number, status: v.status, at: v.published_at ?? v.created_at, kind: v.kind, agent: v.agent, settings: v.settings })),
    );
  };

  return (
    <Dropdown
      align="left"
      width={280}
      trigger={({ toggle }) => (
        <button
          type="button"
          onClick={() => {
            if (!versions) load();
            toggle();
          }}
          className={`inline-flex items-center gap-0.5 rounded-sm text-[13px] font-medium capitalize hover:underline ${STATUS_TONE[status ?? ""] ?? "text-muted-foreground"}`}
        >
          {status === "published" ? "Published" : "Draft"}
          {number ? <span className="ml-1 font-mono text-[12px] font-normal">v{number}</span> : null}
          <ChevronDown className="size-3.5" />
        </button>
      )}
      header={<p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Version history</p>}
      items={(versions ?? []).map((v) => ({
        label: `v${v.number ?? "?"} · ${v.status}`,
        hint: `${dateTime(v.at)}${v.status === "draft" ? " · editing" : " · click to restore as draft"}`,
        icon: History,
        disabled: v.status === "draft",
        onSelect: () => onRestore(v),
      }))}
    />
  );
}

export function EditorHeader({
  agentId,
  uuid,
  name,
  onName,
  version,
  save,
  saveError,
  publishing,
  disabled,
  onTalk,
  onPublish,
  onRestore,
  onDuplicate,
  onArchive,
}: {
  agentId: number;
  uuid: string | null;
  name: string;
  onName: (v: string) => void;
  version: { number: number | null; status: string | null };
  save: SaveState;
  saveError: string | null;
  publishing: boolean;
  disabled: boolean;
  onTalk: (mode: "chat" | "phone") => void;
  onPublish: () => void;
  onRestore: (v: Version) => void;
  onDuplicate: () => void;
  onArchive: () => void;
}) {
  const { toggleList, listOpen } = useAgentsShell();
  const published = version.status === "published";
  const upToDate = published && save === "saved";
  const statusText =
    save === "saving" ? "Saving…" : save === "dirty" ? "Unsaved changes" : save === "error" ? (saveError ?? "Couldn't save") : published ? "Live" : "Draft saved";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-4 pt-3 pb-2 sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <Link href="/agents" aria-label="All agents" className={btn("secondary", "md", "size-9 px-0 lg:hidden")}>
          <ChevronLeft className="size-4" />
        </Link>
        <button
          type="button"
          onClick={toggleList}
          aria-label={listOpen ? "Hide agent list" : "Show agent list"}
          title={listOpen ? "Hide agent list" : "Show agent list"}
          className={btn("secondary", "md", "hidden size-9 px-0 lg:inline-flex")}
        >
          <PanelLeft className="size-4" />
        </button>
        <div className="min-w-0">
          <input
            aria-label="Agent name"
            value={name}
            onChange={(e) => onName(e.target.value)}
            className="w-full max-w-[440px] rounded-sm bg-transparent text-lg leading-tight font-semibold tracking-tight text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          />
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-muted-foreground">
            <VersionMenu agentId={agentId} status={version.status} number={version.number} onRestore={onRestore} />
            {uuid ? (
              <span className="hidden items-center font-mono text-[12px] sm:inline-flex">
                {uuid.slice(0, 6)}…{uuid.slice(-6)}
                <CopyButton value={uuid} label="Copy agent ID" />
              </span>
            ) : null}
            <span className={`inline-flex items-center gap-1 ${save === "error" ? "text-destructive" : ""}`}>
              {save === "saving" ? <LoaderCircle className="size-3 animate-spin" /> : null}
              {save === "error" ? <AlertTriangle className="size-3" /> : null}
              {statusText}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* Talk: chat in the browser, or the dropdown for a phone call */}
        <div className="flex">
          <button type="button" onClick={() => onTalk("chat")} disabled={disabled} className={btn("secondary", "md", "rounded-r-none")}>
            <MessageSquareText className="size-4" /> Talk
          </button>
          <Dropdown
            trigger={({ toggle, open }) => (
              <button type="button" aria-label="More ways to talk" aria-expanded={open} disabled={disabled} onClick={toggle} className={btn("secondary", "md", "-ml-px rounded-l-none px-2")}>
                <ChevronDown className="size-4" />
              </button>
            )}
            items={[
              { label: "Chat in browser", hint: "Text conversation with the draft", icon: MessageSquareText, onSelect: () => onTalk("chat") },
              { label: "Call my phone", hint: "Real call through your provider", icon: Phone, onSelect: () => onTalk("phone") },
            ]}
            width={240}
          />
        </div>

        {/* Publish */}
        <div className="flex">
          <button type="button" onClick={onPublish} disabled={publishing || disabled || upToDate} className={btn("primary", "md", "rounded-r-none")}>
            {publishing ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-3.5" />}
            {upToDate ? "Published" : "Publish"}
          </button>
          <Dropdown
            trigger={({ toggle, open }) => (
              <button type="button" aria-label="Publish options" aria-expanded={open} onClick={toggle} className={btn("primary", "md", "rounded-l-none border-l border-white/20 px-2")}>
                <ChevronDown className="size-4" />
              </button>
            )}
            items={[
              { label: "Publish draft", hint: "Make this version handle real calls", icon: Send, onSelect: onPublish, disabled: upToDate || disabled },
              { label: "Duplicate agent", icon: Copy, onSelect: onDuplicate },
            ]}
            width={250}
          />
        </div>

        <Dropdown
          trigger={({ toggle, open }) => (
            <button type="button" aria-label="More actions" aria-expanded={open} onClick={toggle} className={btn("secondary", "md", "size-9 px-0")}>
              <MoreVertical className="size-4" />
            </button>
          )}
          items={[
            { label: "Duplicate", icon: Copy, onSelect: onDuplicate },
            { label: "Archive", icon: Archive, onSelect: onArchive, danger: true },
          ]}
          width={180}
        />
      </div>
    </div>
  );
}
