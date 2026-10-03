import Link from "next/link";

import { PillLink } from "@/components/ui/PillLink";

const links = [
  { label: "Product", href: "#product" },
  { label: "Developers", href: "#developers" },
  { label: "Use cases", href: "#use-cases" },
  { label: "GitHub", href: "https://github.com/soumyacodes007/Awaz" },
];

// Sits over the hero and scrolls away with the page (not pinned).
export function Navbar() {
  return (
    <header className="absolute inset-x-0 top-0 z-20">
      <nav className="relative mx-auto flex h-[68px] max-w-[1236px] items-center justify-between px-6">
        <Link href="/" className="font-display text-[30px] leading-none font-semibold tracking-[-0.04em] text-ink">
          Awaz
        </Link>

        {/* Centred on the page, independent of logo and button widths. */}
        <ul className="absolute left-1/2 hidden -translate-x-1/2 items-center md:flex">
          {links.map((link) => {
            const external = link.href.startsWith("http");
            return (
              <li key={link.label}>
                <Link
                  href={link.href}
                  {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
                  className="group relative flex h-10 items-center px-4 text-base font-[425] text-black"
                >
                  {link.label}
                  {/* underline draws in from the left on hover */}
                  <span className="absolute inset-x-4 bottom-1.5 h-px origin-left scale-x-0 bg-black/70 transition-transform duration-300 ease-out group-hover:scale-x-100" />
                </Link>
              </li>
            );
          })}
        </ul>

        <div className="flex items-center gap-2">
          <PillLink href="/login" size="sm">
            Log in
          </PillLink>
          <span className="hidden sm:inline-flex">
            <PillLink href="/signup" variant="muted" size="sm">
              Start building
            </PillLink>
          </span>
        </div>
      </nav>
    </header>
  );
}
