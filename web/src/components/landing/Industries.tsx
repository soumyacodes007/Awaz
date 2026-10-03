import { SmartphoneNfc } from "lucide-react";
import Link from "next/link";

import { Grain, Reveal, SectionHeading } from "./primitives";

// Matches ElevenLabs' "Intelligent voice agents, for your industry" block:
// hairline-separated columns, a grainy mesh-gradient header card (12px
// radius, 20px inset, 22px title, 15px subtitle at 80% white), a list of use
// cases with dotted separators and one shared icon, and a full-width white
// pill button.

type Industry = { name: string; tagline: string; mesh: string; items: string[] };

const industries: Industry[] = [
  {
    name: "Lending & Collections",
    tagline: "Compliant voice agents for regulated lending workflows",
    mesh: [
      "radial-gradient(60% 55% at 28% 78%, #c4301d 0%, rgba(196,48,29,0) 70%)",
      "radial-gradient(55% 50% at 88% 85%, #ea6a32 0%, rgba(234,106,50,0) 70%)",
      "linear-gradient(180deg, #5d72dc 0%, #7c5aa6 38%, #b2352d 78%, #d4532f 100%)",
    ].join(","),
    items: [
      "EMI and payment reminders",
      "Loan status and balance queries",
      "Lead qualification and KYC nudges",
      "Escalation to a human agent",
      "Consent-first, policy-aware scripts",
    ],
  },
  {
    name: "E-Commerce & D2C",
    tagline: "Real-time voice agents for orders and customer support",
    mesh: [
      "radial-gradient(45% 45% at 92% 95%, #e0442b 0%, rgba(224,68,43,0) 75%)",
      "radial-gradient(60% 55% at 65% 70%, #2a2fbf 0%, rgba(42,47,191,0) 75%)",
      "linear-gradient(165deg, #7d93ff 0%, #5a66e3 40%, #3a3fd0 70%, #5b3cc4 100%)",
    ].join(","),
    items: [
      "Order tracking and delivery updates",
      "Returns and refund initiation",
      "COD confirmation before dispatch",
      "Cart abandonment recovery calls",
      "24/7 multilingual support at scale",
    ],
  },
  {
    name: "Real Estate",
    tagline: "Low-latency agents for high-volume enquiry lines",
    mesh: [
      "radial-gradient(55% 60% at 85% 80%, #f0927a 0%, rgba(240,146,122,0) 72%)",
      "radial-gradient(60% 55% at 15% 95%, #05050a 0%, rgba(5,5,10,0) 75%)",
      "linear-gradient(180deg, #2e9fd4 0%, #2a6aa8 32%, #1d2a55 62%, #0b0b14 100%)",
    ].join(","),
    items: [
      "Instant callback on new enquiries",
      "Budget and location qualification",
      "Site-visit scheduling",
      "Possession and payment reminders",
      "Hand-off to the sales team",
    ],
  },
  {
    name: "Clinics & Healthcare",
    tagline: "Voice agents for patient access and care coordination",
    mesh: [
      "radial-gradient(38% 40% at 62% 62%, #e2503a 0%, rgba(226,80,58,0) 75%)",
      "radial-gradient(60% 45% at 50% 100%, #a99be6 0%, rgba(169,155,230,0) 75%)",
      "linear-gradient(170deg, #26388f 0%, #2d3a9e 40%, #5a3fa3 75%, #7d63c4 100%)",
    ].join(","),
    items: [
      "Appointment scheduling and reminders",
      "Patient intake and pre-visit triage",
      "Post-visit follow-ups and instructions",
      "Billing and insurance support",
      "Warm transfer to the front desk",
    ],
  },
];

export function Industries() {
  return (
    <section id="use-cases" className="px-4 py-24 sm:px-6">
      <SectionHeading
        title={
          <>
            Intelligent voice agents,
            <br /> for your industry
          </>
        }
        sub="Applied to the calls Indian businesses make every day."
      />

      <div className="mx-auto mt-14 grid max-w-[1188px] border-black/[0.07] sm:grid-cols-2 lg:grid-cols-4 lg:border-x">
        {industries.map((ind, i) => (
          <Reveal
            key={ind.name}
            delay={i * 0.07}
            className="group flex flex-col border-black/[0.07] p-5 lg:border-l lg:first:border-l-0"
          >
            {/* grainy mesh header */}
            {/* On hover the card lifts and the mesh zooms slowly beneath the text. */}
            <div className="relative isolate aspect-[327/232] overflow-hidden rounded-[12px] p-6 transition-[transform,box-shadow] duration-500 ease-out group-hover:-translate-y-1 group-hover:shadow-[0_14px_30px_rgba(17,24,39,0.14)] motion-reduce:transform-none">
              <div
                aria-hidden="true"
                className="absolute inset-0 -z-10 transition-transform duration-[900ms] ease-out group-hover:scale-110 motion-reduce:transform-none"
                style={{ background: ind.mesh }}
              />
              <Grain opacity={0.7} />
              <h3 className="text-[22px] leading-7 font-normal tracking-[-0.01em] text-white">{ind.name}</h3>
              <p className="mt-1.5 text-[15px] leading-[22px] tracking-[0.01em] text-white/80">{ind.tagline}</p>
            </div>

            {/* use cases */}
            <ul className="mt-9 flex-1 px-1">
              {ind.items.map((item) => (
                <li
                  key={item}
                  className="flex items-center gap-3.5 border-b border-dotted border-black/20 py-3.5 text-[15px] leading-[22px] tracking-[0.01em] text-black"
                >
                  <SmartphoneNfc className="size-[18px] shrink-0 text-[#555]" strokeWidth={1.5} />
                  {item}
                </li>
              ))}
            </ul>

            <Link
              href="/signup"
              className="mt-7 flex h-12 items-center justify-center rounded-full bg-white text-base text-black shadow-[0_1px_2px_rgba(0,0,0,0.06)] ring-1 ring-black/[0.08] transition duration-200 ease-out hover:-translate-y-px hover:bg-zinc-50 active:translate-y-0 active:scale-[0.98] motion-reduce:transform-none"
            >
              Learn More
            </Link>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
