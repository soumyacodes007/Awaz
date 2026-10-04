"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { inputBase } from "@/components/app/ui";

import { defaultGroup, GROUPS, groupAllowed, RANGES, type Group, type Range } from "./ranges";

export function RangePicker({ agents, range, group }: { agents: { id: number; name: string }[]; range: Range; group: Group }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    router.replace(`${pathname}?${next}`, { scroll: false });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-md border p-0.5">
        {(Object.keys(RANGES) as Range[]).map((r) => (
          <button
            key={r}
            type="button"
            // A range change also moves to a grouping that fits it.
            onClick={() => set({ range: r, group: groupAllowed(r, group) ? group : defaultGroup(r) })}
            aria-pressed={range === r}
            className={`h-7 rounded-sm px-2.5 text-[13px] transition-colors ${range === r ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            {RANGES[r].label}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
        grouped by
        <select aria-label="Group by" value={group} onChange={(e) => set({ group: e.target.value })} className={`${inputBase} h-8 w-auto text-[13px]`}>
          {GROUPS.map((g) => (
            <option key={g} value={g} disabled={!groupAllowed(range, g)} className="capitalize">
              {g === "hour" ? "Hours" : g === "day" ? "Days" : "Weeks"}
            </option>
          ))}
        </select>
      </label>
      <select aria-label="Agent" value={sp.get("agent") ?? ""} onChange={(e) => set({ agent: e.target.value })} className={`${inputBase} h-8 w-auto text-[13px]`}>
        <option value="">All agents</option>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </div>
  );
}
