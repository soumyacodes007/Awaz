import { PillLink } from "@/components/ui/PillLink";
import { HERO_GLOW } from "@/lib/brand";

import { Reveal } from "./primitives";
import { ProviderMarquee } from "./ProviderMarquee";

function Glow() {
  return <div aria-hidden="true" className="absolute inset-0 -z-10" style={{ background: HERO_GLOW }} />;
}

export function Hero() {
  return (
    <section className="relative isolate flex min-h-[100svh] flex-col overflow-hidden">
      <Glow />

      <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center px-4 pt-28 pb-10 text-center sm:px-8">
        {/* Entrance: headline, then each supporting tier, staggered. */}
        <Reveal>
          <h1 className="font-display text-[38px] leading-[1.05] font-[425] tracking-[-0.025em] text-[#1f1f1f] sm:text-5xl lg:text-[60px] lg:whitespace-nowrap">
            India’s open source voice AI
          </h1>
        </Reveal>

        {/* Three tiers: headline, a medium supporting line, a small detail line. */}
        <Reveal delay={0.08}>
          <p className="mt-4 font-display text-xl font-[425] tracking-[-0.01em] text-[#2b2b2b] sm:text-[26px]">
            Hindi, English and everything in between.
          </p>
        </Reveal>
        <Reveal delay={0.14}>
          <p className="mt-2.5 text-[15px] font-[425] text-[#555] sm:text-[17px]">
            Any model, any carrier, answered like a person would.
          </p>
        </Reveal>

        <Reveal delay={0.2} className="mt-9 flex flex-wrap items-center justify-center gap-5">
          <PillLink href="/signup" variant="gradient">
            Start building
          </PillLink>
          <PillLink href="#demo" variant="light">
            Talk to a demo
          </PillLink>
        </Reveal>
      </div>

      <Reveal delay={0.3} className="pb-12">
        <p className="mb-7 text-center text-xs font-[525] tracking-[2px] text-[#666] uppercase">
          Works with the stack you already use
        </p>
        <ProviderMarquee />
      </Reveal>
    </section>
  );
}
