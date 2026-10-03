"use client";

import { Activity, Gauge, Megaphone, PhoneOutgoing, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { CodeTabs, type Endpoint } from "./CodeTabs";

// Sarvam's "Build anything with Sarvam APIs" grid: a 590px code card on the
// left, a 2×2 feature grid and three small cards on the right, 1188px wide.
// The active feature drives the heading's accent word, the code sample, and
// the highlighted card. It auto-advances; hovering or focusing a card takes
// over until the pointer leaves the grid.

type Feature = {
  id: string;
  accent: string;
  title: string;
  body: string;
  icon: LucideIcon;
  art: string; // corner bloom shown on the active card
  endpoint: Endpoint;
};

// Every endpoint is real (api/routes): public_agent, campaign, workflow and
// organization_usage, all authenticated with the same X-API-Key.
const features: Feature[] = [
  {
    id: "calls",
    accent: "Outbound Calls",
    title: "Outbound Calls",
    body: "Put an agent on a call with one request",
    icon: PhoneOutgoing,
    art: "/landing/corner-bloom-ocean.svg",
    endpoint: {
      method: "POST",
      path: "/public/agent/AGENT_UUID",
      body: { phone_number: "+919876543210", initial_context: { name: "Priya", appointment: "Friday 4 PM" } },
    },
  },
  {
    id: "campaigns",
    accent: "Campaigns",
    title: "Campaigns",
    body: "Dial a whole lead list with retries and schedules",
    icon: Megaphone,
    art: "/landing/corner-bloom-coral.svg",
    endpoint: { method: "POST", path: "/campaign/CAMPAIGN_ID/start" },
  },
  {
    id: "traces",
    accent: "Call Traces",
    title: "Call Traces",
    body: "Transcripts, recordings and per-turn latency",
    icon: Activity,
    art: "/landing/corner-bloom-violet.svg",
    endpoint: { method: "GET", path: "/workflow/WORKFLOW_ID/runs/RUN_ID" },
  },
  {
    id: "usage",
    accent: "Live Usage",
    title: "Live Usage",
    body: "Concurrent calls and spend, as they happen",
    icon: Gauge,
    art: "/landing/corner-bloom-mint.svg",
    endpoint: { method: "GET", path: "/organizations/concurrent-calls" },
  },
];

const extras = [
  { title: "REST API", body: "One key for calls, campaigns and runs" },
  { title: "Webhooks", body: "Call outcomes pushed to your backend" },
  { title: "Self-host", body: <>One command: <code className="font-mono text-[12px] underline">docker compose up</code></> },
];

const CYCLE_MS = 4000;

export function ApiSection() {
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const feature = features[active];

  useEffect(() => {
    if (paused || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const id = setInterval(() => setActive((i) => (i + 1) % features.length), CYCLE_MS);
    return () => clearInterval(id);
  }, [paused]);

  return (
    <section id="developers" className="px-4 pt-8 pb-28 sm:px-6">
      <div className="mx-auto max-w-[1188px]">
        <h2 className="text-center font-display text-[30px] leading-[1.2] font-[525] tracking-[-0.02em] text-[#1f1f1f] sm:text-4xl">
          Build anything with
          <br />
          the Awaz API
        </h2>
        <p className="mt-4 text-center text-lg leading-[29.7px] text-[#666]">
          Everything you need to put a voice agent on a phone line.
        </p>

        <div className="mt-9 grid gap-2 lg:grid-cols-[590px_1fr]">
          {/* left: code card. Sarvam's proportions: 48px top padding, code box
              runs to 18px above the bottom, CTA floats over the code's fade. */}
          <div className="flex flex-col rounded-[16px] border-[0.8px] border-black/[0.06] bg-[linear-gradient(180deg,#fff_55%,#eef0ff_100%)] p-6 pb-[18px] sm:p-12 sm:pb-[18px]">
            <h3 className="text-2xl leading-[1.5] font-[525] text-[#1f1f1f] sm:text-[28px] sm:leading-[42px]">
              Add{" "}
              <span key={feature.id} className="inline-block animate-fade-up text-[#556adc]">
                {feature.accent}
              </span>
              <br />
              to your app in minutes
            </h3>
            <div className="relative mt-8 h-[340px] sm:mt-12 sm:h-[381px]">
              <CodeTabs endpoint={feature.endpoint} animKey={feature.id} />
              <Link
                href="/signup"
                className="absolute inset-x-0 bottom-[30px] flex h-[52px] items-center justify-center rounded-full bg-[#2a2c33] text-base font-[525] text-white transition hover:bg-[#3a3c44]"
              >
                Get your API key &amp; get started
              </Link>
            </div>
          </div>

          {/* right: feature grid + small cards */}
          <div className="grid gap-2">
            <div
              className="grid gap-2 sm:grid-cols-2"
              onMouseLeave={() => setPaused(false)}
              onBlur={() => setPaused(false)}
            >
              {features.map(({ id, title, body, icon: Icon, art }, i) => {
                const on = i === active;
                const select = () => {
                  setActive(i);
                  setPaused(true);
                };
                return (
                  <button
                    key={id}
                    type="button"
                    onMouseEnter={select}
                    onFocus={select}
                    onClick={select}
                    aria-pressed={on}
                    className={`relative flex min-h-[190px] flex-col overflow-hidden rounded-[12px] border-[0.8px] bg-white p-8 text-left transition-[border-color,transform,box-shadow] duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[0_10px_28px_rgba(17,24,39,0.06)] motion-reduce:transform-none lg:h-[209px] ${
                      on ? "border-[#d2dff9]" : "border-black/[0.06]"
                    }`}
                  >
                    {/* Motion from the bloom's hover preview: drop 8px, tilt
                        -7deg, grow 13% over 380ms, pivoting near its top. */}
                    {/* eslint-disable-next-line @next/next/no-img-element -- static SVG, nothing to optimise */}
                    <img
                      src={art}
                      alt=""
                      aria-hidden="true"
                      width={160}
                      height={160}
                      className={`pointer-events-none absolute -top-4 -right-10 size-[136px] origin-[55%_14%] transition-[opacity,transform,filter] ease-[cubic-bezier(.16,1,.3,1)] ${
                        on
                          ? "translate-x-0 translate-y-2 -rotate-[7deg] scale-[1.13] opacity-100 drop-shadow-[0_12px_11px_rgba(29,29,74,0.14)] duration-[1100ms]"
                          : "translate-x-5 -translate-y-5 rotate-6 scale-[0.85] opacity-0 duration-500"
                      }`}
                    />
                    <Icon
                      className={`size-6 transition-colors duration-300 ${on ? "text-[#818cf8]" : "text-[#d4d4d8]"}`}
                      strokeWidth={1.75}
                    />
                    <h4 className="mt-auto pt-6 text-[20px] font-[525] text-[#1f1f1f]">{title}</h4>
                    <p className="mt-2 text-sm leading-[21.7px] text-[#666]">{body}</p>
                  </button>
                );
              })}
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              {extras.map(({ title, body }) => (
                <div key={title} className="rounded-[12px] border-[0.8px] border-black/[0.06] bg-white p-6 transition-[transform,box-shadow] duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[0_10px_28px_rgba(17,24,39,0.06)] motion-reduce:transform-none lg:h-[146px]">
                  <h4 className="text-lg leading-[23.4px] font-[525] text-[#1f1f1f]">{title}</h4>
                  <p className="mt-2 text-sm leading-[21.7px] text-[#666]">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
