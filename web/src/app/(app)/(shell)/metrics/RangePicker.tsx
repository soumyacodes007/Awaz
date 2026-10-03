"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { inputBase } from "@/components/app/ui";

export function RangePicker({ agents }: { agents: { id: number; name: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const range = sp.get("range") ?? "7d";

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(sp.toString());
    if (v) next.set(k, v);
    else next.delete(k);
    router.replace(`${pathname}?${next}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="Agent" value={sp.get("agent") ?? ""} onChange={(e) => set("agent", e.target.value)} className={`${inputBase} h-9 w-auto text-[13px]`}>
        <option value="">All agents</option>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <div className="inline-flex rounded-lg bg-muted p-0.5">
        {["7d", "14d", "30d"].map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => set("range", r)}
            aria-pressed={range === r}
            className={`rounded-md px-3 py-1.5 text-[13px] transition ${range === r ? "bg-white text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"}`}
          >
            {r.replace("d", " days")}
          </button>
        ))}
      </div>
    </div>
  );
}
