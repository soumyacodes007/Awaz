import { SquareTerminal } from "lucide-react";
import type { Metadata } from "next";

import { ComingSoon } from "@/components/app/ComingSoon";

export const metadata: Metadata = { title: "Simulations | Awaz" };

export default function SimulationsPage() {
  return (
    <ComingSoon
      title="Simulations"
      sub="Let an AI caller stress-test your agent at scale."
      icon={SquareTerminal}
      points={[
        "Define caller personas: language, accent, patience and goal.",
        "Run hundreds of simulated calls in parallel against an agent.",
        "Catch loops, wrong transfers and hallucinated answers before launch.",
        "Track latency and success rate across every simulated call.",
      ]}
    />
  );
}
