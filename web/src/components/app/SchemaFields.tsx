"use client";

import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";

import { Switch } from "@/components/app/client";
import { FormRow, inputCls } from "@/components/app/ui";
import type { PropSchema, ProviderSchema, ServiceConfig } from "@/lib/models";
import { humanize } from "@/lib/format";

// Renders a provider's settings straight from the JSON schema the backend
// serves, so new providers and fields show up without frontend changes.

const PRIMARY = ["model", "voice", "language", "api_key", "base_url", "endpoint"];

const isMasked = (v: unknown) => typeof v === "string" && v.includes("****");

function options(key: string, prop: PropSchema, values: ServiceConfig): string[] | null {
  if (prop.model_options && typeof values.model === "string" && prop.model_options[values.model]) {
    return prop.model_options[values.model];
  }
  const list = prop.enum ?? prop.examples;
  return list ? list.map(String) : null;
}

function Field({
  name,
  prop,
  values,
  required,
  onChange,
}: {
  name: string;
  prop: PropSchema;
  values: ServiceConfig;
  required: boolean;
  onChange: (key: string, value: unknown) => void;
}) {
  const id = useId();
  const listId = useId();
  const label = prop.title ?? humanize(name);
  const value = values[name];
  const type = prop.type ?? prop.anyOf?.find((a) => a.type && a.type !== "null")?.type ?? "string";

  if (name === "api_key") {
    const v = Array.isArray(value) ? String(value[0] ?? "") : typeof value === "string" ? value : "";
    return (
      <FormRow label="API key" htmlFor={id} hint={isMasked(v) ? "A key is saved. Paste a new one to replace it." : prop.description}>
        <input
          id={id}
          type="password"
          autoComplete="off"
          value={isMasked(v) ? "" : v}
          placeholder={isMasked(v) ? v : required ? "Required" : "Optional"}
          onChange={(e) => onChange(name, e.target.value || (isMasked(v) ? v : ""))}
          className={`${inputCls} h-10 font-mono text-[13px]`}
        />
      </FormRow>
    );
  }

  if (type === "boolean") {
    return (
      <div className="flex items-start justify-between gap-6 sm:col-span-2">
        <div>
          <p className="text-[13px] font-medium text-foreground/80">{label}</p>
          {prop.description ? <p className="mt-0.5 text-[12.5px] text-muted-foreground">{prop.description}</p> : null}
        </div>
        <Switch checked={value === true || (value === undefined && prop.default === true)} onChange={(v) => onChange(name, v)} label={label} />
      </div>
    );
  }

  if (type === "number" || type === "integer") {
    return (
      <FormRow label={label} htmlFor={id} hint={prop.description}>
        <input
          id={id}
          type="number"
          step={type === "integer" ? 1 : "any"}
          min={prop.minimum}
          max={prop.maximum}
          value={typeof value === "number" ? value : ""}
          placeholder={prop.default !== undefined ? String(prop.default) : undefined}
          onChange={(e) => onChange(name, e.target.value === "" ? undefined : Number(e.target.value))}
          className={`${inputCls} h-10`}
        />
      </FormRow>
    );
  }

  if (type !== "string") return null;

  const opts = options(name, prop, values);
  const str = typeof value === "string" ? value : value == null ? "" : String(value);

  if (opts && !prop.allow_custom_input) {
    return (
      <FormRow label={label} htmlFor={id} hint={prop.description}>
        <select id={id} value={str} onChange={(e) => onChange(name, e.target.value)} className={`${inputCls} h-10`}>
          {!opts.includes(str) ? <option value={str}>{str || "Select…"}</option> : null}
          {opts.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </FormRow>
    );
  }

  return (
    <FormRow label={label} htmlFor={id} hint={prop.description}>
      <input
        id={id}
        list={opts ? listId : undefined}
        value={str}
        placeholder={prop.default != null ? String(prop.default) : undefined}
        onChange={(e) => onChange(name, e.target.value)}
        className={`${inputCls} h-10`}
      />
      {opts ? (
        <datalist id={listId}>
          {opts.map((o) => (
            <option key={o} value={o} />
          ))}
        </datalist>
      ) : null}
    </FormRow>
  );
}

export function SchemaFields({
  schema,
  values,
  onChange,
}: {
  schema: ProviderSchema | undefined;
  values: ServiceConfig;
  onChange: (next: ServiceConfig) => void;
}) {
  const [more, setMore] = useState(false);
  if (!schema) return <p className="text-[13px] text-muted-foreground">No settings for this provider.</p>;

  const set = (key: string, value: unknown) => {
    const next: ServiceConfig = { ...values, [key]: value };
    // A new model can invalidate the voice list; fall back to that model's first voice.
    if (key === "model" && schema.properties.voice?.model_options?.[value as string]) {
      const voices = schema.properties.voice.model_options[value as string];
      if (!voices.includes(String(values.voice))) next.voice = voices[0];
    }
    onChange(next);
  };

  const required = new Set(schema.required ?? []);
  const keys = Object.keys(schema.properties).filter((k) => k !== "provider");
  const primary = keys.filter((k) => PRIMARY.includes(k) || required.has(k)).sort((a, b) => PRIMARY.indexOf(a) - PRIMARY.indexOf(b));
  const rest = keys.filter((k) => !primary.includes(k));

  const render = (k: string) => (
    <Field key={k} name={k} prop={schema.properties[k]} values={values} required={required.has(k)} onChange={set} />
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">{primary.map(render)}</div>
      {rest.length ? (
        <div>
          <button
            type="button"
            onClick={() => setMore((m) => !m)}
            className="flex items-center gap-1 text-[13px] text-muted-foreground transition hover:text-foreground"
          >
            <ChevronDown className={`size-3.5 transition-transform ${more ? "rotate-180" : ""}`} />
            {more ? "Fewer settings" : `More settings (${rest.length})`}
          </button>
          {more ? <div className="mt-4 grid gap-4 sm:grid-cols-2">{rest.map(render)}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
