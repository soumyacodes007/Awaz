"use client";

import { LoaderCircle } from "lucide-react";
import { useFormStatus } from "react-dom";

/** Full-width navy pill that shows a spinner while its form is submitting. */
export function SubmitButton({ children, pendingLabel }: { children: React.ReactNode; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[linear-gradient(180deg,#3a3f5c_0%,#1e2033_100%)] text-base font-[525] text-white shadow-[0_2px_6px_rgba(30,32,51,0.3)] transition duration-200 hover:-translate-y-px hover:brightness-125 active:translate-y-0 active:scale-[0.98] disabled:cursor-wait disabled:opacity-80 disabled:hover:translate-y-0 motion-reduce:transform-none"
    >
      {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
      {pending ? pendingLabel : children}
    </button>
  );
}
