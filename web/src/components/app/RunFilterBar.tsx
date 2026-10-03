"use client";

import { X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { inputBase } from "@/components/app/ui";

/** Agent / channel / direction / date filters, kept in the URL. */
export function RunFilterBar({ agents, show = ["agent", "channel", "direction", "date"] }: { agents: { id: number; name: string }[]; show?: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(sp.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    next.delete("run");
    router.replace(`${pathname}${next.toString() ? `?${next}` : ""}`);
  };
  const active = ["agent", "channel", "direction", "from", "to"].some((k) => sp.get(k));
  const sel = `${inputBase} h-9 w-auto min-w-[140px] text-[13px]`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {show.includes("agent") ? (
        <select aria-label="Agent" value={sp.get("agent") ?? ""} onChange={(e) => set("agent", e.target.value)} className={sel}>
          <option value="">All agents</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      ) : null}
      {show.includes("channel") ? (
        <select aria-label="Channel" value={sp.get("channel") ?? ""} onChange={(e) => set("channel", e.target.value)} className={sel}>
          <option value="">All channels</option>
          <option value="telephony">Phone</option>
          <option value="web">Web call</option>
          <option value="chat">Text chat</option>
        </select>
      ) : null}
      {show.includes("direction") ? (
        <select aria-label="Direction" value={sp.get("direction") ?? ""} onChange={(e) => set("direction", e.target.value)} className={sel}>
          <option value="">Inbound and outbound</option>
          <option value="inbound">Inbound</option>
          <option value="outbound">Outbound</option>
        </select>
      ) : null}
      {show.includes("date") ? (
        <span className="flex items-center gap-1.5">
          <input type="date" aria-label="From" value={sp.get("from") ?? ""} onChange={(e) => set("from", e.target.value)} className={`${inputBase} h-9 w-auto text-[13px]`} />
          <span className="text-[12px] text-muted-foreground">to</span>
          <input type="date" aria-label="To" value={sp.get("to") ?? ""} onChange={(e) => set("to", e.target.value)} className={`${inputBase} h-9 w-auto text-[13px]`} />
        </span>
      ) : null}
      {active ? (
        <button
          type="button"
          onClick={() => router.replace(pathname)}
          className="flex h-9 items-center gap-1 rounded-lg px-2.5 text-[13px] text-muted-foreground transition hover:bg-accent hover:text-foreground"
        >
          <X className="size-3.5" /> Clear
        </button>
      ) : null}
    </div>
  );
}
