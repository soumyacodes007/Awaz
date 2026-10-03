"use client";

import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Reveal } from "./primitives";

// Drop samples into /public/voices and set `src` to enable a card's play
// button. Without a sample the button is shown disabled rather than faking
// playback.
type Voice = { name: string; meta: string; orb: string; src?: string };

const voices: Voice[] = [
  { name: "Customer care", meta: "Hindi · Female", orb: "conic-gradient(from 200deg,#f7700c,#ffb27a,#556adc,#2b2d6e,#f7700c)" },
  { name: "Sales", meta: "Hinglish · Male", orb: "conic-gradient(from 90deg,#0ea5a4,#7ee0d0,#1f3b8f,#0b1d4f,#0ea5a4)" },
  { name: "Support", meta: "Tamil · Female", orb: "conic-gradient(from 20deg,#e0457b,#ffb3c8,#f7700c,#7a1f3d,#e0457b)" },
  { name: "Reminders", meta: "Bengali · Male", orb: "conic-gradient(from 300deg,#556adc,#b9c3ff,#a855f7,#1e1b4b,#556adc)" },
  { name: "Narration", meta: "English (India) · Female", orb: "conic-gradient(from 140deg,#16a34a,#a7f3c0,#0ea5a4,#064e3b,#16a34a)" },
  { name: "Collections", meta: "Marathi · Male", orb: "conic-gradient(from 240deg,#f59e0b,#fde68a,#e0457b,#78350f,#f59e0b)" },
];

function VoiceCard({ voice, playing, onToggle }: { voice: Voice; playing: boolean; onToggle: () => void }) {
  const available = Boolean(voice.src);
  return (
    <div className="group flex w-[260px] shrink-0 snap-start flex-col items-center rounded-[20px] bg-[#f4f4f6] px-6 pt-10 pb-7 transition-colors duration-300 hover:bg-[#efeff2] sm:w-[278px]">
      <div className="relative size-[132px] transition-transform duration-500 ease-out group-hover:scale-105 motion-reduce:transform-none">
        <div
          className={`absolute inset-0 rounded-full blur-[1px] ${playing ? "animate-spin-slow [animation-duration:3s]" : "animate-spin-slow"}`}
          style={{ background: voice.orb }}
        />
        <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_32%_28%,rgba(255,255,255,0.65),rgba(255,255,255,0)_45%)]" />
        {playing ? <span className="absolute inset-0 animate-pulse-ring rounded-full bg-white/40" /> : null}
        <button
          type="button"
          onClick={onToggle}
          disabled={!available}
          title={available ? undefined : "Sample coming soon"}
          aria-label={available ? `${playing ? "Pause" : "Play"} ${voice.name} sample` : `${voice.name} sample coming soon`}
          className="absolute top-1/2 left-1/2 flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white shadow-[0_2px_10px_rgba(0,0,0,0.15)] transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-80"
        >
          {playing ? <Pause className="size-4 fill-ink text-ink" /> : <Play className="size-4 translate-x-px fill-ink text-ink" />}
        </button>
      </div>
      <p className="mt-6 text-[15px] font-[525] text-ink">{voice.name}</p>
      <p className="mt-1 text-[13px] text-[#888]">{voice.meta}</p>
    </div>
  );
}

export function VoiceLibrary() {
  const track = useRef<HTMLDivElement>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<number | null>(null);

  useEffect(() => () => audio.current?.pause(), []);

  function toggle(i: number) {
    const src = voices[i].src;
    if (!src) return;
    audio.current?.pause();
    if (playing === i) {
      setPlaying(null);
      return;
    }
    const a = new Audio(src);
    a.onended = () => setPlaying(null);
    audio.current = a;
    void a.play();
    setPlaying(i);
  }

  function scroll(dir: 1 | -1) {
    track.current?.scrollBy({ left: dir * 290, behavior: "smooth" });
  }

  return (
    <section className="py-24">
      <div className="mx-auto grid max-w-[1188px] gap-6 px-4 sm:px-6 md:grid-cols-2 md:items-end">
        <Reveal>
          <h2 className="font-display text-[30px] leading-[1.2] font-[525] tracking-[-0.02em] text-[#1f1f1f] sm:text-4xl">
            Voices across Indian
            <br className="hidden sm:block" /> languages and accents
          </h2>
        </Reveal>
        <Reveal delay={0.08} className="md:justify-self-end">
          <p className="max-w-md text-[15px] leading-6 text-[#666]">
            Pick the right voice for your brand from Sarvam, ElevenLabs, Cartesia and more, with Hindi, Tamil,
            Bengali and Hinglish built in.
          </p>
        </Reveal>
      </div>

      <Reveal delay={0.1} className="relative mx-auto mt-10 max-w-[1188px]">
        <div
          ref={track}
          className="flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-smooth px-4 pb-2 [scrollbar-width:none] sm:px-6 [&::-webkit-scrollbar]:hidden"
        >
          {voices.map((v, i) => (
            <VoiceCard key={v.name} voice={v} playing={playing === i} onToggle={() => toggle(i)} />
          ))}
        </div>
        <div className="mt-6 flex justify-end gap-2 px-4 sm:px-6">
          {([-1, 1] as const).map((dir) => (
            <button
              key={dir}
              type="button"
              onClick={() => scroll(dir)}
              aria-label={dir === -1 ? "Previous voices" : "Next voices"}
              className="flex size-10 items-center justify-center rounded-full bg-white ring-1 ring-black/[0.08] transition hover:bg-zinc-50"
            >
              {dir === -1 ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
            </button>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
