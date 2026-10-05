"use client";

import { AlertTriangle, Ban, CheckCircle2, CircleDashed, LoaderCircle, XCircle } from "lucide-react";

export type ResultStatus = "queued" | "running" | "passed" | "failed" | "error" | "cancelled" | string;

const STATUS: Record<string, { label: string; cls: string; icon: React.ComponentType<{ className?: string }>; spin?: boolean }> = {
  passed: { label: "Passed", cls: "border-emerald-200 bg-emerald-50 text-emerald-700", icon: CheckCircle2 },
  failed: { label: "Failed", cls: "border-red-200 bg-red-50 text-red-700", icon: XCircle },
  error: { label: "Error", cls: "border-amber-200 bg-amber-50 text-amber-700", icon: AlertTriangle },
  running: { label: "Running", cls: "border-blue-200 bg-blue-50 text-blue-700", icon: LoaderCircle, spin: true },
  queued: { label: "Queued", cls: "border-border bg-muted text-muted-foreground", icon: CircleDashed },
  cancelled: { label: "Cancelled", cls: "border-border bg-muted text-muted-foreground", icon: Ban },
  completed: { label: "Completed", cls: "border-border bg-muted text-foreground/80", icon: CheckCircle2 },
};

export function StatusBadge({ status }: { status: ResultStatus }) {
  const s = STATUS[status] ?? STATUS.queued;
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${s.cls}`}>
      <Icon className={`size-3.5 ${s.spin ? "animate-spin" : ""}`} />
      {s.label}
    </span>
  );
}

/** Small status glyph for dense lists. */
export function StatusIcon({ status, className = "size-4" }: { status: ResultStatus; className?: string }) {
  if (status === "passed") return <CheckCircle2 className={`${className} text-emerald-600`} />;
  if (status === "failed") return <XCircle className={`${className} text-red-600`} />;
  if (status === "error") return <AlertTriangle className={`${className} text-amber-600`} />;
  if (status === "running") return <LoaderCircle className={`${className} animate-spin text-blue-600`} />;
  if (status === "cancelled") return <Ban className={`${className} text-muted-foreground`} />;
  return <CircleDashed className={`${className} text-muted-foreground`} />;
}

export const isActive = (status: string) => status === "queued" || status === "running";

export function since(iso: string | null | undefined) {
  if (!iso) return "–";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function elapsed(start: string | null | undefined, end: string | null | undefined) {
  if (!start) return "–";
  const s = Math.max(0, Math.round(((end ? new Date(end) : new Date()).getTime() - new Date(start).getTime()) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}
