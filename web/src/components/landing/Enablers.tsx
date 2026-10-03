import { AudioLines, Shuffle, Waypoints, type LucideIcon } from "lucide-react";

import { Reveal } from "./primitives";

// ElevenLabs' "Deployment enablers" block: a left-aligned 36px light heading,
// then three columns framed by hairlines (top, bottom and between columns)
// with small dots where the lines meet. Each column: a 40px icon tile
// (10px radius, hairline ring), an 18px title and a 15px warm-grey paragraph.

const enablers: { icon: LucideIcon; title: string; body: string }[] = [
  {
    icon: Waypoints,
    title: "India-native telephony, built in",
    body: "Built to work with Indian telecom from day one. Awaz connects to Vobiz, Exotel, Plivo, Twilio, Telnyx and plain SIP for real-time inbound and outbound calling, routing and warm hand-offs to your team. Campaigns, retries and call schedules come out of the box, with no carrier glue code to write.",
  },
  {
    icon: Shuffle,
    title: "Bring any model, switch any time",
    body: "Choose speech-to-text, LLM and voice separately for every agent, from Sarvam, Deepgram, OpenAI, Gemini, ElevenLabs, Cartesia and more, or use a realtime speech-to-speech model. Swap providers as prices and quality change, without rewriting a single workflow.",
  },
  {
    icon: AudioLines,
    title: "Indian speech, production ready",
    body: "Voice agents tuned for how India actually speaks, including Hinglish and regional accents, with turn-taking that copes with real, noisy phone lines. Every call is traced end to end, so you can see exactly where latency and errors come from.",
  },
];

// Dots sit where the column dividers meet the top and bottom rules.
const DOTS = ["0%", "33.333%", "66.666%", "100%"];

export function Enablers() {
  return (
    <section className="py-24">
      <div className="mx-auto max-w-[1174px] px-4 sm:px-12">
        <Reveal>
          <h2 className="font-display text-[30px] leading-[1.2] font-normal tracking-[-0.01em] text-black sm:text-4xl sm:leading-[42px]">
            Deployment enablers for Indian businesses
          </h2>
        </Reveal>
      </div>

      <div className="relative mx-auto mt-16 max-w-[1174px] border-y border-black/[0.07] sm:mt-24">
        {DOTS.map((left) => (
          <span key={left} aria-hidden="true" className="absolute inset-y-0 hidden lg:block" style={{ left }}>
            <span className="absolute -top-[2px] -left-[2px] size-[3px] rounded-full bg-black/60" />
            <span className="absolute -bottom-[2px] -left-[2px] size-[3px] rounded-full bg-black/60" />
          </span>
        ))}

        <div className="grid lg:grid-cols-3">
          {enablers.map(({ icon: Icon, title, body }, i) => (
            <Reveal
              key={title}
              delay={i * 0.08}
              className="group border-black/[0.07] px-6 pt-12 pb-12 not-first:border-t sm:px-12 lg:not-first:border-t-0 lg:not-first:border-l"
            >
              <span className="flex size-10 items-center justify-center rounded-[10px] bg-white shadow-[0_0_0_1px_rgba(0,0,0,0.1),0_1px_2px_rgba(0,0,0,0.04)] transition-[transform,box-shadow] duration-300 ease-out group-hover:-translate-y-0.5 group-hover:-rotate-6 group-hover:shadow-[0_0_0_1px_rgba(0,0,0,0.1),0_6px_14px_rgba(0,0,0,0.08)] motion-reduce:transform-none">
                <Icon className="size-[18px] text-black" strokeWidth={1.6} />
              </span>
              <h3 className="mt-8 max-w-[300px] text-lg leading-[26px] font-normal tracking-[0.01em] text-black">
                {title}
              </h3>
              <p className="mt-2 max-w-[340px] text-[15px] leading-[22px] tracking-[0.01em] text-[#777169]">{body}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
