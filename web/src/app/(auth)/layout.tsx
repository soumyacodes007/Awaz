import { Check } from "lucide-react";
import Link from "next/link";

import { HERO_GLOW } from "@/lib/brand";

const points = [
  "Voice agents in Hindi, English and Hinglish",
  "Any model, any Indian carrier",
  "Open source and self-hosted",
];

// Split screen: the form on the left, and on the right a rounded panel with
// the landing hero's saffron/lavender field so auth feels like the same
// product. The panel hides below lg.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-svh bg-paper lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col px-6 py-6 sm:px-10">
        <Link href="/" className="w-fit font-display text-[26px] leading-none font-semibold tracking-[-0.04em] text-ink">
          Awaz
        </Link>
        <main className="flex flex-1 items-center justify-center py-12">
          <div className="w-full max-w-[380px]">{children}</div>
        </main>
      </div>

      <aside className="relative isolate m-3 hidden overflow-hidden rounded-[28px] lg:flex lg:flex-col lg:justify-end">
        <div aria-hidden="true" className="absolute inset-0 -z-10" style={{ background: HERO_GLOW }} />
        <div className="p-12">
          <p className="max-w-md font-display text-[34px] leading-[1.15] font-[525] tracking-[-0.02em] text-[#1f1f1f]">
            Every call answered, in the language your customer speaks.
          </p>
          <ul className="mt-8 space-y-3">
            {points.map((p) => (
              <li key={p} className="flex items-center gap-3 text-[15px] text-[#3d3d3d]">
                <span className="flex size-6 items-center justify-center rounded-full bg-white/80 ring-1 ring-black/[0.06]">
                  <Check className="size-3.5 text-[#556adc]" strokeWidth={2.5} />
                </span>
                {p}
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
