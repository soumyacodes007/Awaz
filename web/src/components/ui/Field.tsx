"use client";

import { Eye, EyeOff } from "lucide-react";
import { useId, useState } from "react";

type FieldProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "id"> & {
  label: string;
  hint?: React.ReactNode;
};

const input =
  "h-12 w-full rounded-xl bg-white px-4 text-[15px] text-ink shadow-[0_1px_2px_rgba(0,0,0,0.04)] ring-1 ring-black/[0.1] transition outline-none placeholder:text-[#a3a3a3] hover:ring-black/[0.18] focus:ring-2 focus:ring-[#556adc]";

/** Labelled text input; type="password" gets a show/hide toggle. */
export function Field({ label, hint, type = "text", className = "", ...props }: FieldProps) {
  const id = useId();
  const [shown, setShown] = useState(false);
  const isPassword = type === "password";

  return (
    <div className={className}>
      <div className="mb-1.5 flex items-baseline justify-between">
        <label htmlFor={id} className="text-sm font-[525] text-[#3d3d3d]">
          {label}
        </label>
        {hint}
      </div>
      <div className="relative">
        <input id={id} type={isPassword && shown ? "text" : type} className={`${input} ${isPassword ? "pr-12" : ""}`} {...props} />
        {isPassword ? (
          <button
            type="button"
            onClick={() => setShown((s) => !s)}
            aria-label={shown ? "Hide password" : "Show password"}
            className="absolute top-1/2 right-3 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-[#888] transition hover:bg-black/[0.04] hover:text-ink"
          >
            {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        ) : null}
      </div>
    </div>
  );
}
