import { FlaskConical } from "lucide-react";
import type { Metadata } from "next";

import { ComingSoon } from "@/components/app/ComingSoon";

export const metadata: Metadata = { title: "Evals | Awaz" };

export default function EvalsPage() {
  return (
    <ComingSoon
      title="Evals"
      sub="Score your agents against test cases before they reach callers."
      icon={FlaskConical}
      points={[
        "Write test conversations with the outcome you expect.",
        "Run them against any agent version and get pass or fail per case.",
        "Score real calls with an LLM judge for tone, accuracy and task completion.",
        "Compare two versions side by side before you publish.",
      ]}
    />
  );
}
