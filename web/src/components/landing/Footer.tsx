import Link from "next/link";

import { FooterWordmark } from "./FooterWordmark";
import { Reveal } from "./primitives";

// Sarvam's footer layout, as measured from sarvam.ai: a brand column, five
// link columns with 12px mono uppercase headings and 16px grey links, and a
// full-width art strip at the bottom (here, an oversized black wordmark).

const GITHUB = "https://github.com/soumyacodes007/Awaz";

const columns: { title: string; links: [string, string][] }[] = [
  {
    title: "Product",
    links: [
      ["Voice Agents", "#product"],
      ["Agent Builder", "#product"],
      ["Campaigns", "#developers"],
      ["Call Traces", "#developers"],
      ["Telephony", "#use-cases"],
    ],
  },
  {
    title: "Developers",
    links: [
      ["API", "#developers"],
      ["Webhooks", "#developers"],
      ["Self-hosting", GITHUB],
      ["GitHub", GITHUB],
    ],
  },
  {
    title: "Resources",
    links: [
      ["Documentation", GITHUB],
      ["Use cases", "#use-cases"],
      ["Voices", "#product"],
    ],
  },
  {
    title: "Company",
    links: [
      ["About", "#"],
      ["Contact", "#"],
    ],
  },
  {
    title: "Legal",
    links: [
      ["Terms of Service", "#"],
      ["Privacy Policy", "#"],
      ["License", `${GITHUB}/blob/main/LICENSE`],
    ],
  },
];

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px]" fill="currentColor" aria-hidden="true">
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.71 1.26 3.37.96.1-.75.4-1.26.73-1.55-2.56-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

export function Footer() {
  return (
    <footer className="relative isolate overflow-hidden bg-[linear-gradient(180deg,#fdfcfc_0%,#f1f8f3_45%,#dff1e6_100%)]">
      {/* Starts on the page's own paper colour (no seam with the section
          above), then deepens to mint, with green washes from the sides in
          the same shape as the video section's lavender ones. */}
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse 32% 55% at 0% 55%,rgba(95,211,154,0.38),rgba(95,211,154,0) 100%),radial-gradient(ellipse 32% 55% at 100% 55%,rgba(95,211,154,0.38),rgba(95,211,154,0) 100%),radial-gradient(ellipse 50% 35% at 50% 100%,rgba(35,168,106,0.16),rgba(35,168,106,0) 100%)",
        }}
      />
      <div className="mx-auto grid max-w-[1200px] gap-12 px-4 pt-20 sm:px-6 lg:grid-cols-[260px_1fr] lg:gap-8">
        {/* brand column */}
        <Reveal className="flex flex-col gap-6">
          <div>
            <Link href="/" className="font-display text-[30px] leading-none font-semibold tracking-[-0.04em] text-ink">
              Awaz
            </Link>
            <p className="mt-3 text-xs text-[#666]">India’s open source voice AI</p>
          </div>
          <div>
            <p className="text-xs text-[#666]">Find us at</p>
            <a
              href={GITHUB}
              target="_blank"
              rel="noreferrer"
              aria-label="Awaz on GitHub"
              className="mt-2 inline-flex text-[#3d3d3d] transition-colors hover:text-ink"
            >
              <GitHubIcon />
            </a>
          </div>
          <p className="text-xs leading-[18px] text-[#666]">
            © {new Date().getFullYear()} Awaz. Built on{" "}
            <a href="https://github.com/dograh-hq/dograh" target="_blank" rel="noreferrer" className="underline hover:text-ink">
              Dograh
            </a>
            .
          </p>
        </Reveal>

        {/* link columns */}
        <nav aria-label="Footer" className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3 lg:grid-cols-5">
          {columns.map(({ title, links }, i) => (
            <Reveal key={title} delay={0.08 + i * 0.06}>
              <h3 className="font-mono text-xs tracking-[0.04em] text-[#1f1f1f] uppercase">{title}</h3>
              <ul className="mt-6 space-y-[10px]">
                {links.map(([label, href]) => {
                  const external = href.startsWith("http");
                  return (
                    <li key={label}>
                      <Link
                        href={href}
                        {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
                        className="bg-[linear-gradient(currentColor,currentColor)] bg-[length:0%_1px] bg-bottom-left bg-no-repeat pb-0.5 text-base text-[#666] transition-[color,background-size] duration-300 ease-out hover:bg-[length:100%_1px] hover:text-ink"
                      >
                        {label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Reveal>
          ))}
        </nav>
      </div>

      {/* art strip: oversized black wordmark with letter reveal + spotlight */}
      <div className="mx-auto mt-16 max-w-[1280px] px-4 pb-10 sm:px-6">
        <FooterWordmark />
      </div>
    </footer>
  );
}
