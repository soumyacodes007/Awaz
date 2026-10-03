"use client";

import { FormRow, inputCls } from "@/components/app/ui";
import type { TelephonyProviderUiField } from "@/client";

// Renders a telephony provider's credential form from the field metadata the
// backend serves (/organizations/telephony-providers/metadata).

export type Values = Record<string, unknown>;

const isMasked = (v: unknown) => typeof v === "string" && v.includes("****");

export function ProviderFields({
  fields,
  values,
  onChange,
  editing,
}: {
  fields: TelephonyProviderUiField[];
  values: Values;
  onChange: (v: Values) => void;
  editing: boolean;
}) {
  const set = (k: string, v: unknown) => onChange({ ...values, [k]: v });
  const visible = fields.filter((f) => !f.visible_when || values[f.visible_when.field] === f.visible_when.equals);

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {visible.map((f) => {
        const id = `tp-${f.name}`;
        const v = values[f.name];
        const wide = f.type === "textarea" || f.type === "string-array" || f.type === "readonly";
        const hint = f.description ?? undefined;
        let control: React.ReactNode;

        if (f.type === "readonly") {
          control = <p className="rounded-md bg-muted px-3.5 py-2.5 font-mono text-[12.5px] text-foreground/80">{typeof v === "string" && v ? v : "Generated after you save"}</p>;
        } else if (f.type === "string-array") {
          const list = Array.isArray(v) ? (v as string[]) : [];
          control = (
            <textarea
              id={id}
              rows={2}
              value={list.join("\n")}
              onChange={(e) => set(f.name, e.target.value.split(/[\n,]/).map((x) => x.trim()).filter(Boolean))}
              placeholder={f.placeholder ?? "+919876543210"}
              className={`${inputCls} resize-y py-2.5 font-mono text-[13px]`}
            />
          );
        } else if (f.type === "textarea") {
          control = (
            <textarea
              id={id}
              rows={4}
              value={isMasked(v) ? "" : typeof v === "string" ? v : ""}
              placeholder={isMasked(v) ? "Saved. Paste a new value to replace it." : (f.placeholder ?? undefined)}
              onChange={(e) => set(f.name, e.target.value)}
              className={`${inputCls} resize-y py-2.5 font-mono text-[12.5px]`}
            />
          );
        } else if (f.type === "select" && f.options) {
          control = (
            <select id={id} value={typeof v === "string" ? v : ""} onChange={(e) => set(f.name, e.target.value)} className={`${inputCls} h-10`}>
              <option value="">Choose…</option>
              {f.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          );
        } else {
          const secret = f.type === "password";
          control = (
            <input
              id={id}
              type={secret ? "password" : "text"}
              autoComplete="off"
              required={f.required && !(editing && isMasked(v))}
              value={isMasked(v) ? "" : typeof v === "string" ? v : ""}
              placeholder={isMasked(v) ? `Saved (${String(v).slice(-4)})` : (f.placeholder ?? undefined)}
              onChange={(e) => set(f.name, e.target.value)}
              className={`${inputCls} h-10 ${secret ? "font-mono text-[13px]" : ""}`}
            />
          );
        }

        return (
          <FormRow key={f.name} label={`${f.label}${f.required ? "" : " (optional)"}`} htmlFor={id} hint={hint} className={wide ? "sm:col-span-2" : ""}>
            {control}
          </FormRow>
        );
      })}
    </div>
  );
}

/**
 * On edit, masked secrets the user didn't touch must go back unchanged (the
 * backend swaps them for the stored values); empty ones are dropped.
 */
export function cleanValues(fields: TelephonyProviderUiField[], values: Values, original: Values) {
  const out: Values = {};
  for (const f of fields) {
    if (f.type === "readonly") continue;
    const v = values[f.name];
    if (v === "" || v == null) {
      if (isMasked(original[f.name])) out[f.name] = original[f.name];
      continue;
    }
    out[f.name] = v;
  }
  return out;
}
