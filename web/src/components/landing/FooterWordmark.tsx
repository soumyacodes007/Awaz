"use client";

import { motion, useInView, useReducedMotion } from "motion/react";
import { useRef } from "react";

const LETTERS = "Awaz".split("");
const TYPE =
  "font-display text-[clamp(96px,19vw,260px)] leading-[0.82] font-semibold tracking-[-0.03em]";

// The footer's oversized wordmark.
// - Letters rise one by one from behind a clipping edge on first view.
// - A colour spotlight follows the pointer *inside* the black letters: a
//   gradient copy sits on top, masked to a soft circle at the cursor. The
//   cursor position is written to CSS variables, so moving doesn't re-render.
export function FooterWordmark() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  // Watch the wrapper, not the letters: each letter starts translated below
  // its clipping span, so the letters themselves never "intersect" the view.
  const inView = useInView(ref, { once: true, margin: "-40px" });

  function move(e: React.PointerEvent<HTMLDivElement>) {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--x", `${e.clientX - r.left}px`);
    el.style.setProperty("--y", `${e.clientY - r.top}px`);
    el.style.setProperty("--spot", "1");
  }

  function leave() {
    ref.current?.style.setProperty("--spot", "0");
  }

  return (
    <div
      ref={ref}
      onPointerMove={move}
      onPointerLeave={leave}
      className="relative mx-auto w-fit select-none [--spot:0] [--x:50%] [--y:50%]"
      aria-hidden="true"
    >
      {/* base: black letters, revealed one at a time */}
      <p className={`${TYPE} text-black`}>
        {LETTERS.map((ch, i) => (
          <span key={i} className="inline-block overflow-hidden pb-[0.06em] align-bottom">
            {reduce ? (
              <span className="inline-block">{ch}</span>
            ) : (
              <motion.span
                className="inline-block"
                initial={{ y: "105%" }}
                animate={{ y: inView ? "0%" : "105%" }}
                transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1], delay: 0.15 + i * 0.09 }}
              >
                {ch}
              </motion.span>
            )}
          </span>
        ))}
      </p>

      {/* spotlight: the same letters in colour, masked to the cursor */}
      {reduce ? null : (
        <p
          className={`${TYPE} pointer-events-none absolute inset-0 animate-gradient-pan bg-[linear-gradient(100deg,#f7700c,#ff9a52,#9fb3ff,#556adc,#f7700c)] bg-[length:250%_100%] bg-clip-text text-transparent transition-opacity duration-500`}
          style={{
            opacity: "var(--spot)",
            maskImage: "radial-gradient(220px circle at var(--x) var(--y), black 0%, rgba(0,0,0,0.6) 35%, transparent 70%)",
            WebkitMaskImage:
              "radial-gradient(220px circle at var(--x) var(--y), black 0%, rgba(0,0,0,0.6) 35%, transparent 70%)",
          }}
        >
          {LETTERS.map((ch, i) => (
            <span key={i} className="inline-block overflow-hidden pb-[0.06em] align-bottom">
              <span className="inline-block">{ch}</span>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
