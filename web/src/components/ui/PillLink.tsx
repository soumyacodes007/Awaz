import Link from "next/link";

// Sizes and colours measured from sarvam.ai at a 1440px viewport.
const variants = {
  /** Flat dark: nav primary. */
  dark: "bg-[#2a2c33] text-white hover:bg-[#3a3c44]",
  /** Light grey: nav secondary. */
  muted: "bg-[#f5f5f5] text-ink hover:bg-[#ebebeb]",
  /** Navy gradient: hero primary. */
  gradient:
    "bg-[linear-gradient(180deg,#3a3f5c_0%,#1e2033_100%)] text-white shadow-[0_2px_6px_rgba(30,32,51,0.3)] hover:brightness-125",
  /** White with hairline ring: hero secondary. */
  light: "bg-white text-ink ring-1 ring-black/[0.08] shadow-[0_1px_2px_rgba(0,0,0,0.05)] hover:bg-zinc-50",
};

const sizes = {
  sm: "h-10 px-5 text-[15px]",
  md: "h-[52px] px-6 text-base",
};

export function PillLink({
  href,
  variant = "dark",
  size = "md",
  children,
}: {
  href: string;
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center justify-center rounded-full font-[525] whitespace-nowrap transition duration-200 ease-out hover:-translate-y-px active:translate-y-0 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy motion-reduce:transform-none ${variants[variant]} ${sizes[size]}`}
    >
      {children}
    </Link>
  );
}
