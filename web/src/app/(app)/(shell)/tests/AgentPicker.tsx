"use client";

import { Bot, Check, ChevronsUpDown } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";

import { Popover } from "@/components/app/client";

type Agent = { id: number; name: string; multiStep: boolean };

export function AgentPicker({ agents, value }: { agents: Agent[]; value: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const current = agents.find((a) => a.id === value);

  return (
    <Popover
      align="right"
      width={280}
      trigger={({ toggle, open }) => (
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="inline-flex h-9 max-w-[280px] items-center gap-2 rounded-md border bg-background pr-2.5 pl-3 text-sm font-medium text-foreground shadow-xs transition-colors hover:bg-accent"
        >
          <Bot className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{current?.name ?? "Choose an agent"}</span>
          <ChevronsUpDown className="ml-1 size-3.5 shrink-0 text-muted-foreground" />
        </button>
      )}
    >
      {(close) => (
        <div className="max-h-80 overflow-y-auto p-1">
          <p className="px-2 py-1.5 text-xs font-medium text-muted-foreground">Test which agent</p>
          {agents.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => {
                close();
                router.push(`${pathname}?agent=${a.id}`);
              }}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-accent"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate">{a.name}</span>
                {a.multiStep ? <span className="block text-xs text-muted-foreground">Multi-step: convert it to run tests</span> : null}
              </span>
              {a.id === value ? <Check className="size-4 shrink-0" /> : null}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}
