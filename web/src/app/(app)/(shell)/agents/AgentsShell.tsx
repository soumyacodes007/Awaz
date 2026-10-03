"use client";

import { createContext, useContext, useEffect, useState } from "react";

import { AgentList, type AgentRow } from "./AgentList";

type Shell = { listOpen: boolean; toggleList: () => void };
const ShellContext = createContext<Shell>({ listOpen: true, toggleList: () => {} });

/** Lets the editor header collapse the agent list, like Vapi's panel button. */
export const useAgentsShell = () => useContext(ShellContext);

const KEY = "awaz.agents.listOpen";

export function AgentsShell({ agents, children }: { agents: AgentRow[]; children: React.ReactNode }) {
  const [listOpen, setListOpen] = useState(true);

  useEffect(() => {
    try {
      if (localStorage.getItem(KEY) === "0") setListOpen(false);
    } catch {}
  }, []);

  const toggleList = () =>
    setListOpen((o) => {
      try {
        localStorage.setItem(KEY, o ? "0" : "1");
      } catch {}
      return !o;
    });

  return (
    <ShellContext.Provider value={{ listOpen, toggleList }}>
      <div className="flex min-h-[calc(100svh-3.5rem)] md:h-svh md:min-h-0">
        <AgentList agents={agents} open={listOpen} />
        <div className="min-w-0 flex-1 md:overflow-y-auto">{children}</div>
      </div>
    </ShellContext.Provider>
  );
}
