"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** Re-fetch server data every few seconds while a call is still running. */
export function LiveRefresh({ active, every = 3000 }: { active: boolean; every?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), every);
    return () => clearInterval(t);
  }, [active, every, router]);
  return null;
}
