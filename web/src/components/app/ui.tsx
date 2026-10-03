// Presentational building blocks for the signed-in app, in shadcn's style:
// zinc palette, 1px borders, small radii, text-sm density. Server-safe: no
// hooks, so pages can render these directly.

import type { LucideIcon } from "lucide-react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground shadow-xs hover:bg-primary/90",
  secondary: "border border-input bg-background text-foreground shadow-xs hover:bg-accent",
  ghost: "text-foreground/80 hover:bg-accent hover:text-foreground",
  danger: "border border-red-200 bg-background text-destructive shadow-xs hover:bg-red-50",
};
const SIZES: Record<Size, string> = {
  sm: "h-8 gap-1.5 rounded-md px-3 text-[13px]",
  md: "h-9 gap-2 rounded-md px-4 text-sm",
};

/** Class string for a button or link styled as a button. */
export function btn(variant: Variant = "secondary", size: Size = "md", extra = "") {
  return `inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${extra}`;
}

/** Input styling without a width, for controls that size themselves. */
export const inputBase =
  "rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60";
export const inputCls = `w-full ${inputBase}`;

export function Card({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return <div className={`rounded-lg border bg-card shadow-xs ${className}`}>{children}</div>;
}

export function CardHeader({ title, sub, actions }: { title: string; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3.5">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {sub ? <p className="mt-0.5 text-[13px] text-muted-foreground">{sub}</p> : null}
      </div>
      {actions}
    </div>
  );
}

const TONES = {
  neutral: "border-border bg-muted text-foreground/80",
  green: "border-emerald-200 bg-emerald-50 text-emerald-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  red: "border-red-200 bg-red-50 text-red-700",
  blue: "border-blue-200 bg-blue-50 text-blue-700",
  violet: "border-violet-200 bg-violet-50 text-violet-700",
} as const;
export type Tone = keyof typeof TONES;

export function Badge({ tone = "neutral", children, className = "" }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-px text-xs font-medium ${TONES[tone]} ${className}`}>
      {children}
    </span>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon;
  title: string;
  body: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <span className="flex size-10 items-center justify-center rounded-md border bg-background shadow-xs">
        <Icon className="size-[18px] text-foreground" strokeWidth={1.75} />
      </span>
      <p className="mt-4 text-sm font-semibold text-foreground">{title}</p>
      <div className="mt-1 max-w-sm text-[13px] leading-relaxed text-muted-foreground">{body}</div>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/** Label + control + optional hint, stacked. */
export function FormRow({
  label,
  hint,
  htmlFor,
  children,
  className = "",
}: {
  label: string;
  hint?: React.ReactNode;
  htmlFor?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-medium text-foreground">
        {label}
      </label>
      {children}
      {hint ? <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function ErrorNote({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700">{children}</p>;
}

/** Table shell with the app's header styling. */
export function Table({ head, children }: { head: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="border-b text-xs text-muted-foreground">{head}</thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
export const th = "h-10 px-4 font-medium";
export const td = "px-4 py-2.5";
export const tr = "border-b last:border-b-0 transition-colors hover:bg-muted/50";

/** Small labelled number used in stat strips. */
export function Stat({ label, value, note }: { label: string; value: React.ReactNode; note?: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-4 shadow-xs">
      <p className="text-[13px] text-muted-foreground">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tracking-tight text-foreground tabular-nums">{value}</p>
      {note ? <p className="mt-1 text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}
