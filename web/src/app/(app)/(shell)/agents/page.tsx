import { Bot } from "lucide-react";
import type { Metadata } from "next";

import { EmptyState } from "@/components/app/ui";

import { NewAgentButton } from "./AgentList";

export const metadata: Metadata = { title: "Agents | Awaz" };

// Wide screens show this beside the list; narrower ones show the list itself.
export default function AgentsPage() {
  return (
    <div className="hidden h-full items-center justify-center lg:flex">
      <EmptyState
        icon={Bot}
        title="Select an agent"
        body="Pick an agent on the left to edit its prompt, voice and tools, or create a new one."
        action={<NewAgentButton />}
      />
    </div>
  );
}
