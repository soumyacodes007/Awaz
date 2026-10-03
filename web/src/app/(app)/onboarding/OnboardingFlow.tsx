"use client";

import { ArrowLeft, ArrowRight, LoaderCircle, PhoneIncoming, PhoneOutgoing } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { updateUserOnboardingStateApiV1UserOnboardingStatePut } from "@/client";
import { createAgent } from "@/lib/agent-client";
import { TEMPLATES } from "@/lib/agent-templates";

// Three steps, kept client-side until the last one:
//   1. business: company, industry, the job the agent should do
//   2. languages the agent should speak
//   3. inbound/outbound + a description, which creates a single-prompt agent
//      from the matching template, then marks onboarding complete.
// Skipping at any point records `skipped` so onboarding never re-opens.

const INDUSTRIES = ["Healthcare & clinics", "Lending & collections", "E-commerce & D2C", "Real estate", "Education", "Other"];
const GOALS = [
  { id: "support", label: "Answer support calls", inbound: true, template: "support" },
  { id: "booking", label: "Book appointments", inbound: true, template: "receptionist" },
  { id: "reminders", label: "Send reminders", inbound: false, template: "reminder" },
  { id: "leads", label: "Qualify leads", inbound: false, template: "leads" },
];
const LANGUAGES = ["Hindi", "English", "Hinglish", "Tamil", "Telugu", "Bengali", "Marathi", "Gujarati", "Kannada", "Malayalam"];

type Answers = {
  company: string;
  industry: string;
  goal: string;
  languages: string[];
  callType: "inbound" | "outbound";
  description: string;
};

function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`rounded-full px-4 py-2 text-sm transition duration-200 active:scale-[0.97] ${
        selected
          ? "bg-[#1f1f1f] text-white shadow-[0_2px_8px_rgba(0,0,0,0.15)]"
          : "bg-white text-[#3d3d3d] ring-1 ring-black/[0.1] hover:ring-black/[0.25]"
      }`}
    >
      {children}
    </button>
  );
}

function describe(a: Answers) {
  const goal = GOALS.find((g) => g.id === a.goal)?.label.toLowerCase() ?? "handle calls";
  const company = a.company || "our business";
  const langs = a.languages.length ? a.languages.join(", ") : "English";
  return `A friendly voice agent for ${company}${a.industry ? ` (${a.industry.toLowerCase()})` : ""} that can ${goal}. It speaks ${langs}, keeps answers short, confirms details back to the caller, and hands off to a human when it can't help.`;
}

export function OnboardingFlow() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [busy, setBusy] = useState<"create" | "skip" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [a, setA] = useState<Answers>({
    company: "",
    industry: "",
    goal: "",
    languages: ["Hindi", "English"],
    callType: "inbound",
    description: "",
  });

  const set = <K extends keyof Answers>(key: K, value: Answers[K]) => setA((prev) => ({ ...prev, [key]: value }));
  const go = (to: number) => {
    setDir(to > step ? 1 : -1);
    setError(null);
    if (to === 2 && !a.description) {
      const goal = GOALS.find((g) => g.id === a.goal);
      setA((prev) => ({ ...prev, callType: goal?.inbound === false ? "outbound" : "inbound", description: describe(prev) }));
    }
    setStep(to);
  };

  async function skip() {
    setBusy("skip");
    await updateUserOnboardingStateApiV1UserOnboardingStatePut({ body: { skipped: true } }).catch(() => null);
    router.push("/dashboard");
  }

  async function create() {
    setBusy("create");
    setError(null);
    const goal = GOALS.find((g) => g.id === a.goal);
    const template = TEMPLATES.find((t) => t.id === goal?.template) ?? TEMPLATES[0];
    const company = a.company.trim() || "our business";
    const prompt = [
      `# About the business\nYou work for ${company}${a.industry ? `, in ${a.industry.toLowerCase()}` : ""}. You handle ${a.callType} calls.`,
      `# Your job\n${a.description.trim()}`,
      `# Languages\nCallers speak ${a.languages.join(", ")}. Reply in the language the caller uses.`,
      template.prompt,
    ].join("\n\n");
    const res = await createAgent(a.company.trim() ? `${a.company.trim()} agent` : template.name, prompt, template.greeting);

    if ("error" in res) {
      setBusy(null);
      setError(res.error ?? "We couldn't create your agent. You can try again, or skip and create one later.");
      return;
    }
    await updateUserOnboardingStateApiV1UserOnboardingStatePut({ body: { completed_at: new Date().toISOString() } }).catch(
      () => null,
    );
    router.push(`/agents/${res.id}`);
  }

  const canNext = [Boolean(a.goal), a.languages.length > 0, a.description.trim().length > 20][step];
  const slide = reduce ? 0 : 24;

  return (
    <div className="flex min-h-svh flex-col bg-paper">
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <Link href="/" className="font-display text-[26px] leading-none font-semibold tracking-[-0.04em] text-ink">
          Awaz
        </Link>
        <button
          type="button"
          onClick={skip}
          disabled={busy !== null}
          className="text-sm text-[#666] transition hover:text-ink disabled:opacity-50"
        >
          {busy === "skip" ? "Skipping…" : "Skip for now"}
        </button>
      </header>

      <main className="flex flex-1 items-start justify-center px-6 pt-6 pb-16 sm:pt-14">
        <div className="w-full max-w-[560px]">
          {/* progress */}
          <div className="flex gap-2" aria-label={`Step ${step + 1} of 3`}>
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-1 flex-1 overflow-hidden rounded-full bg-black/[0.08]">
                <motion.span
                  className="block h-full rounded-full bg-[#1f1f1f]"
                  initial={false}
                  animate={{ width: i <= step ? "100%" : "0%" }}
                  transition={{ duration: reduce ? 0 : 0.5, ease: [0.22, 1, 0.36, 1] }}
                />
              </span>
            ))}
          </div>

          <AnimatePresence mode="wait" custom={dir} initial={false}>
            <motion.section
              key={step}
              custom={dir}
              initial={{ opacity: 0, x: dir * slide }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -dir * slide }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="mt-10"
            >
              {step === 0 ? (
                <>
                  <h1 className="font-display text-[30px] leading-tight font-[525] tracking-[-0.02em] text-[#1f1f1f]">
                    Tell us about your business
                  </h1>
                  <p className="mt-2 text-[15px] text-[#666]">We&apos;ll use this to draft your first agent.</p>

                  <label className="mt-8 block text-sm font-[525] text-[#3d3d3d]" htmlFor="company">
                    Company name
                  </label>
                  <input
                    id="company"
                    value={a.company}
                    onChange={(e) => set("company", e.target.value)}
                    placeholder="Sharma Dental Clinic"
                    className="mt-1.5 h-12 w-full rounded-xl bg-white px-4 text-[15px] ring-1 ring-black/[0.1] transition outline-none placeholder:text-[#a3a3a3] focus:ring-2 focus:ring-[#556adc]"
                  />

                  <p className="mt-7 text-sm font-[525] text-[#3d3d3d]">Industry</p>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {INDUSTRIES.map((i) => (
                      <Chip key={i} selected={a.industry === i} onClick={() => set("industry", a.industry === i ? "" : i)}>
                        {i}
                      </Chip>
                    ))}
                  </div>

                  <p className="mt-7 text-sm font-[525] text-[#3d3d3d]">What should your first agent do?</p>
                  <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                    {GOALS.map((g) => {
                      const on = a.goal === g.id;
                      const Icon = g.inbound ? PhoneIncoming : PhoneOutgoing;
                      return (
                        <button
                          key={g.id}
                          type="button"
                          onClick={() => set("goal", g.id)}
                          aria-pressed={on}
                          className={`flex items-center gap-3 rounded-2xl px-4 py-3.5 text-left text-[15px] transition duration-200 active:scale-[0.98] ${
                            on ? "bg-white text-ink ring-2 ring-[#1f1f1f]" : "bg-white text-[#3d3d3d] ring-1 ring-black/[0.1] hover:ring-black/[0.25]"
                          }`}
                        >
                          <Icon className="size-[18px] shrink-0 text-[#556adc]" strokeWidth={1.75} />
                          {g.label}
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : null}

              {step === 1 ? (
                <>
                  <h1 className="font-display text-[30px] leading-tight font-[525] tracking-[-0.02em] text-[#1f1f1f]">
                    Which languages do your callers speak?
                  </h1>
                  <p className="mt-2 text-[15px] text-[#666]">Pick all that apply. You can change this later.</p>
                  <div className="mt-8 flex flex-wrap gap-2">
                    {LANGUAGES.map((l) => {
                      const on = a.languages.includes(l);
                      return (
                        <Chip
                          key={l}
                          selected={on}
                          onClick={() => set("languages", on ? a.languages.filter((x) => x !== l) : [...a.languages, l])}
                        >
                          {l}
                        </Chip>
                      );
                    })}
                  </div>
                </>
              ) : null}

              {step === 2 ? (
                <>
                  <h1 className="font-display text-[30px] leading-tight font-[525] tracking-[-0.02em] text-[#1f1f1f]">
                    Create your first agent
                  </h1>
                  <p className="mt-2 text-[15px] text-[#666]">We drafted a description from your answers. Edit it freely.</p>

                  <div className="mt-8 inline-flex rounded-full bg-black/[0.05] p-1">
                    {(["inbound", "outbound"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => set("callType", t)}
                        aria-pressed={a.callType === t}
                        className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm capitalize transition ${
                          a.callType === t ? "bg-white text-ink shadow-[0_1px_3px_rgba(0,0,0,0.1)]" : "text-[#666] hover:text-ink"
                        }`}
                      >
                        {t === "inbound" ? <PhoneIncoming className="size-4" /> : <PhoneOutgoing className="size-4" />}
                        {t} calls
                      </button>
                    ))}
                  </div>

                  <label className="mt-6 block text-sm font-[525] text-[#3d3d3d]" htmlFor="description">
                    What should the agent do?
                  </label>
                  <textarea
                    id="description"
                    value={a.description}
                    onChange={(e) => set("description", e.target.value)}
                    rows={6}
                    className="mt-1.5 w-full resize-none rounded-xl bg-white px-4 py-3 text-[15px] leading-6 ring-1 ring-black/[0.1] transition outline-none focus:ring-2 focus:ring-[#556adc]"
                  />

                  <div aria-live="polite">
                    {error ? (
                      <p className="mt-4 rounded-xl bg-[#fff1ee] px-4 py-3 text-sm text-[#b42318] ring-1 ring-[#fdd5cc]">{error}</p>
                    ) : null}
                  </div>
                </>
              ) : null}
            </motion.section>
          </AnimatePresence>

          {/* navigation */}
          <div className="mt-10 flex items-center justify-between">
            {step > 0 ? (
              <button
                type="button"
                onClick={() => go(step - 1)}
                disabled={busy !== null}
                className="flex items-center gap-2 text-sm text-[#666] transition hover:text-ink disabled:opacity-50"
              >
                <ArrowLeft className="size-4" /> Back
              </button>
            ) : (
              <span />
            )}
            <button
              type="button"
              disabled={!canNext || busy !== null}
              onClick={() => (step < 2 ? go(step + 1) : create())}
              className="flex h-12 items-center gap-2 rounded-full bg-[linear-gradient(180deg,#3a3f5c_0%,#1e2033_100%)] px-6 text-base font-[525] text-white shadow-[0_2px_6px_rgba(30,32,51,0.3)] transition duration-200 hover:-translate-y-px hover:brightness-125 active:translate-y-0 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:brightness-100"
            >
              {busy === "create" ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {step < 2 ? "Continue" : busy === "create" ? "Creating your agent…" : "Create agent"}
              {step < 2 ? <ArrowRight className="size-4" /> : null}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
