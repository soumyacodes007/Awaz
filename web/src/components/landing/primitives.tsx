"use client";

import { motion, useReducedMotion } from "motion/react";

/** Fades and lifts its children in the first time they scroll into view. */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1], delay }}
    >
      {children}
    </motion.div>
  );
}

/** Centered section title + optional subtitle, in the landing type scale. */
export function SectionHeading({
  title,
  sub,
  className = "",
}: {
  title: React.ReactNode;
  sub?: React.ReactNode;
  className?: string;
}) {
  return (
    <Reveal className={`mx-auto max-w-2xl text-center ${className}`}>
      <h2 className="font-display text-[30px] leading-[1.2] font-[525] tracking-[-0.02em] text-[#1f1f1f] sm:text-4xl">
        {title}
      </h2>
      {sub ? <p className="mt-4 text-base leading-7 text-[#666] sm:text-lg">{sub}</p> : null}
    </Reveal>
  );
}

/** Film-grain overlay (SVG turbulence) for gradient panels. */
export function Grain({ opacity = 0.45 }: { opacity?: number }) {
  return (
    <svg aria-hidden="true" className="pointer-events-none absolute inset-0 size-full mix-blend-overlay" style={{ opacity }}>
      <filter id="awaz-grain">
        <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch" />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect width="100%" height="100%" filter="url(#awaz-grain)" />
    </svg>
  );
}
