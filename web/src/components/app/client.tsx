"use client";

import { Check, Copy, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";

/** Anchored panel with arbitrary content; closes on outside click and Escape. */
export function Popover({
  trigger,
  children,
  align = "left",
  width = 280,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: "left" | "right";
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open ? (
        <div style={{ width }} className={`absolute top-[calc(100%+6px)] z-40 rounded-md border bg-background p-2 shadow-md ${align === "right" ? "right-0" : "left-0"}`}>
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

export type MenuItem ={ label: string; hint?: string; icon?: React.ComponentType<{ className?: string }>; onSelect: () => void; danger?: boolean; disabled?: boolean };

/** shadcn-style dropdown: any trigger, a list of items, closes on outside click. */
export function Dropdown({
  trigger,
  items,
  align = "right",
  width = 208,
  header,
}: {
  trigger: (props: { open: boolean; toggle: () => void }) => React.ReactNode;
  items: MenuItem[];
  align?: "left" | "right";
  width?: number;
  header?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", esc);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open ? (
        <div
          role="menu"
          style={{ width }}
          className={`absolute top-[calc(100%+6px)] z-40 rounded-md border bg-background p-1 shadow-md ${align === "right" ? "right-0" : "left-0"}`}
        >
          {header}
          {items.map(({ label, hint, icon: Icon, onSelect, danger, disabled }) => (
            <button
              key={label}
              type="button"
              role="menuitem"
              disabled={disabled}
              onClick={() => {
                setOpen(false);
                onSelect();
              }}
              className={`flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50 ${
                danger ? "text-destructive" : "text-foreground"
              }`}
            >
              {Icon ? <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> : null}
              <span className="min-w-0">
                <span className="block">{label}</span>
                {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Centered dialog. Closes on Escape and backdrop click. */
export function Modal({
  open,
  onClose,
  title,
  sub,
  children,
  footer,
  width = 520,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  sub?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
}) {
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 px-4 py-[8vh] backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            style={{ maxWidth: width }}
            className="w-full rounded-lg bg-white border shadow-lg"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="flex items-start justify-between gap-4 px-6 pt-5">
              <div>
                <h2 id={titleId} className="text-[17px] font-medium text-foreground">
                  {title}
                </h2>
                {sub ? <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{sub}</p> : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="-mr-2 flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="px-6 py-5">{children}</div>
            {footer ? <div className="flex justify-end gap-2 border-t border-border px-6 py-4">{footer}</div> : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

/** Accessible on/off switch. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors duration-200 disabled:opacity-50 ${
        checked ? "bg-primary" : "bg-black/[0.14]"
      }`}
    >
      <span
        className={`absolute top-[3px] left-[3px] size-4 rounded-full bg-white shadow-xs transition-transform duration-200 ${
          checked ? "translate-x-4" : ""
        }`}
      />
    </button>
  );
}

/** Row with a title, description and a switch on the right. */
export function SwitchRow({
  title,
  body,
  checked,
  onChange,
}: {
  title: string;
  body?: React.ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div>
        <p className="text-[14px] text-foreground">{title}</p>
        {body ? <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{body}</p> : null}
      </div>
      <Switch checked={checked} onChange={onChange} label={title} />
    </div>
  );
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(value).catch(() => null);
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      }}
      aria-label={label}
      title={label}
      className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
    >
      {done ? <Check className="size-3.5 text-emerald-700" /> : <Copy className="size-3.5" />}
    </button>
  );
}

/** Underlined tab strip. Controlled. */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string; icon?: React.ComponentType<{ className?: string; strokeWidth?: number }> }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {tabs.map(({ id, label, icon: Icon }) => {
        const on = id === value;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(id)}
            className={`relative flex h-11 items-center gap-2 px-3 text-[14px] whitespace-nowrap transition-colors ${
              on ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {Icon ? <Icon className={`size-4 ${on ? "text-foreground" : ""}`} strokeWidth={1.75} /> : null}
            {label}
            {on ? <motion.span layoutId="tab-underline" className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" /> : null}
          </button>
        );
      })}
    </div>
  );
}
