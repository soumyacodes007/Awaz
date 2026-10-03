"use client";

import { Code2, Eye, KeyRound, Lock, type LucideIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

import { Reveal } from "./primitives";

// ElevenLabs' "Security, compliance, and India data residency" block: a
// left-aligned light heading and an accordion (active item: 24px black title
// plus a 15px warm-grey paragraph; inactive items: 24px grey titles) beside a
// large wireframe illustration. Each item has its own wireframe from
// /public/landing, crossfading as the active item changes. Auto-advances
// until the visitor picks one.

const points: { icon: LucideIcon; title: string; body: string; art: string }[] = [
  {
    icon: Lock,
    title: "Your data stays with you",
    body: "Run Awaz on your own VM, inside your VPC or fully on-premise. Calls, recordings and transcripts never leave your infrastructure, and you decide how long anything is kept.",
    art: "/landing/wireframe-orbit-coral.svg",
  },
  {
    icon: KeyRound,
    title: "Bring your own keys",
    body: "Model and carrier credentials live in your deployment, encrypted at rest. You pay providers directly, with no per-minute platform markup.",
    art: "/landing/wireframe-prism-ocean.svg",
  },
  {
    icon: Eye,
    title: "Audit every call",
    body: "Every call is traced end to end: transcript, recording, tool calls and per-turn latency, so you can see exactly what your agents said and did.",
    art: "/landing/wireframe-signal-violet.svg",
  },
  {
    icon: Code2,
    title: "Open source",
    body: "Read every line, fork it and extend it. No black boxes and no lock-in. Your voice stack stays yours.",
    art: "/landing/wireframe-cascade-mint.svg",
  },
];

const CYCLE_MS = 6000;

export function SelfHosted() {
  const [open, setOpen] = useState(0);
  const [picked, setPicked] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    if (picked || reduce) return;
    const id = setInterval(() => setOpen((i) => (i + 1) % points.length), CYCLE_MS);
    return () => clearInterval(id);
  }, [picked, reduce]);

  return (
    <section className="py-24">
      <div className="mx-auto grid max-w-[1174px] items-center gap-14 px-4 sm:px-12 lg:grid-cols-[minmax(0,507px)_minmax(0,1fr)] lg:gap-16">
        <div>
          <Reveal>
            <h2 className="font-display text-[30px] leading-[1.2] font-normal tracking-[-0.01em] text-black sm:text-4xl sm:leading-[42px]">
              Self-hosted, secure,
              <br /> and yours to control
            </h2>
          </Reveal>

          <div className="mt-14 space-y-7">
            {points.map(({ icon: Icon, title, body }, i) => {
              const isOpen = i === open;
              return (
                <div key={title}>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(i);
                      setPicked(true);
                    }}
                    aria-expanded={isOpen}
                    className={`flex items-center gap-4 text-left text-xl leading-8 tracking-[-0.01em] transition-colors duration-300 sm:text-2xl ${
                      isOpen ? "text-black" : "text-[#a8a29e] hover:text-[#57534e]"
                    }`}
                  >
                    <Icon className="size-[18px] shrink-0" strokeWidth={1.6} />
                    {title}
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen ? (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                        className="overflow-hidden"
                      >
                        <p className="max-w-[560px] pt-4 text-[15px] leading-[22px] text-[#777169]">{body}</p>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        </div>

        <Reveal delay={0.1} className="relative mx-auto aspect-square w-full max-w-[634px]">
          {points.map(({ art }, i) => (
            // eslint-disable-next-line @next/next/no-img-element -- static SVG, nothing to optimise
            <img
              key={art}
              src={art}
              alt=""
              aria-hidden={i !== open}
              width={600}
              height={600}
              className={`absolute inset-0 size-full transition-[opacity,transform] duration-700 ease-out ${
                i === open ? "scale-100 opacity-100" : "scale-[0.97] opacity-0"
              }`}
            />
          ))}
        </Reveal>
      </div>
    </section>
  );
}
