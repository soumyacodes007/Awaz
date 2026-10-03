"use client";

import { KeyRound, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  createCredentialApiV1CredentialsPost,
  deleteCredentialApiV1CredentialsCredentialUuidDelete,
  type CredentialResponse,
  type WebhookCredentialType,
} from "@/client";
import { Modal } from "@/components/app/client";
import { PageBody, PageHeader } from "@/components/app/PageHeader";
import { Badge, btn, Card, EmptyState, ErrorNote, FormRow, inputCls } from "@/components/app/ui";
import { apiError } from "@/lib/errors";
import { ago } from "@/lib/format";

const TYPES: { id: Exclude<WebhookCredentialType, "none">; label: string; fields: { key: string; label: string; secret?: boolean; placeholder?: string }[] }[] = [
  { id: "bearer_token", label: "Bearer token", fields: [{ key: "token", label: "Token", secret: true }] },
  {
    id: "api_key",
    label: "API key header",
    fields: [
      { key: "header_name", label: "Header name", placeholder: "X-API-Key" },
      { key: "api_key", label: "API key", secret: true },
    ],
  },
  {
    id: "basic_auth",
    label: "Username and password",
    fields: [
      { key: "username", label: "Username" },
      { key: "password", label: "Password", secret: true },
    ],
  },
  {
    id: "custom_header",
    label: "Custom header",
    fields: [
      { key: "header_name", label: "Header name", placeholder: "X-Signature" },
      { key: "header_value", label: "Header value", secret: true },
    ],
  },
];

export function CredentialsView({ credentials }: { credentials: CredentialResponse[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState(TYPES[0].id);
  const [data, setData] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const spec = TYPES.find((t) => t.id === type)!;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await createCredentialApiV1CredentialsPost({ body: { name, credential_type: type, credential_data: data } }).catch(() => null);
    setBusy(false);
    if (!res?.data) return setError(apiError(res?.error, "Couldn't save the credential."));
    setOpen(false);
    setName("");
    setData({});
    router.refresh();
  }

  async function remove(c: CredentialResponse) {
    if (!window.confirm(`Delete "${c.name}"? Tools and webhooks using it will stop authenticating.`)) return;
    await deleteCredentialApiV1CredentialsCredentialUuidDelete({ path: { credential_uuid: c.uuid } }).catch(() => null);
    router.refresh();
  }

  return (
    <>
      <PageHeader
        title="Credentials"
        sub="Secrets your tools and webhooks send when calling your systems. Encrypted at rest and never shown again."
        back={{ href: "/integrations", label: "Integrations" }}
        actions={
          <button type="button" onClick={() => setOpen(true)} className={btn("primary")}>
            <Plus className="size-4" /> New credential
          </button>
        }
      />
      <PageBody className="max-w-[920px]">
        <Card>
          {credentials.length ? (
            <ul className="divide-y divide-border">
              {credentials.map((c) => (
                <li key={c.uuid} className="flex items-center gap-3 px-5 py-3.5">
                  <span className="flex size-8 items-center justify-center rounded-lg bg-muted">
                    <KeyRound className="size-4 text-foreground" strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] text-foreground">{c.name}</span>
                    <span className="text-[12px] text-muted-foreground">Added {ago(c.created_at)}</span>
                  </span>
                  <Badge>{TYPES.find((t) => t.id === c.credential_type)?.label ?? c.credential_type}</Badge>
                  <button type="button" onClick={() => remove(c)} aria-label={`Delete ${c.name}`} className="flex size-8 items-center justify-center rounded-lg text-muted-foreground/70 hover:bg-accent hover:text-red-600">
                    <Trash2 className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={KeyRound} title="No credentials yet" body="Add one, then pick it under Authentication on an API tool or webhook." />
          )}
        </Card>
      </PageBody>

      <Modal open={open} onClose={() => !busy && setOpen(false)} title="New credential">
        <form onSubmit={create} className="space-y-4">
          <FormRow label="Name" htmlFor="cr-name">
            <input id="cr-name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="CRM production key" className={`${inputCls} h-10`} />
          </FormRow>
          <FormRow label="Type" htmlFor="cr-type">
            <select
              id="cr-type"
              value={type}
              onChange={(e) => {
                setType(e.target.value as typeof type);
                setData({});
              }}
              className={`${inputCls} h-10`}
            >
              {TYPES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </FormRow>
          {spec.fields.map((f) => (
            <FormRow key={f.key} label={f.label} htmlFor={`cr-${f.key}`}>
              <input
                id={`cr-${f.key}`}
                required
                type={f.secret ? "password" : "text"}
                autoComplete="off"
                value={data[f.key] ?? ""}
                placeholder={f.placeholder}
                onChange={(e) => setData({ ...data, [f.key]: e.target.value })}
                className={`${inputCls} h-10 ${f.secret ? "font-mono text-[13px]" : ""}`}
              />
            </FormRow>
          ))}
          {error ? <ErrorNote>{error}</ErrorNote> : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className={btn("ghost")}>
              Cancel
            </button>
            <button type="submit" disabled={busy} className={btn("primary")}>
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : null} Save credential
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}
