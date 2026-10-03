"use client";

import "lenis/dist/lenis.css";

import Lenis from "lenis";
import { useEffect } from "react";

// Inertial smooth scrolling for the marketing pages, including in-page anchor
// links (#product, #developers…). Skipped entirely for reduced-motion users,
// who keep the browser's native scroll.
export function SmoothScroll() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const lenis = new Lenis({ autoRaf: true, anchors: { offset: -80 }, lerp: 0.1 });
    return () => lenis.destroy();
  }, []);
  return null;
}
