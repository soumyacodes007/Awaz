"use client";

import { KeyRound, LoaderCircle, Plus, TriangleAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  archiveApiKeyApiV1UserApiKeysApiKeyIdDelete,
  createApiKeyApiV1UserApiKeysPost,
  reactivateApiKeyApiV1UserApiKeysApiKeyIdReactivatePut,
  type ApiKeyResponse,
} from "@/client";
import { CopyButton, Modal } from "@/components/app/client";
import { PageBody, PageHeader } from "@/components/app/PageHeader";
import { Badge, btn, Card, CardHeader, EmptyState, ErrorNote, FormRow, inputCls, Table, td, th, tr } from "@/components/app/ui";
import { apiError } from "@/lib/errors";
import { ago } from "@/lib/format";

export function ApiKeysView({ keys }: { keys: ApiKeyResponse[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await createApiKeyApiV1UserApiKeysPost({ body: { name } }).catch(() => null);
    setBusy(false);
    if (!res?.data) return setError(apiError(res?.error, "Couldn't create the key."));
    setCreated(res.data.api_key);
    setName("");
    router.refresh();
  }

  async function toggle(k: ApiKeyResponse) {
    if (k.is_active) {
      if (!window.confirm(`Revoke "${k.name}"? Anything using it stops working immediately.`)) return;
      await archiveApiKeyApiV1UserApiKeysApiKeyIdDelete({ path: { api_key_id: k.id } }).catch(() => null);
    } else {
      await reactivateApiKeyApiV1UserApiKeysApiKeyIdReactivatePut({ path: { api_key_id: k.id } }).catch(() => null);
    }
    router.refresh();
  }

  const sample = `curl ${origin}/api/v1/workflow/fetch \\\n  -H "X-API-Key: $AWAZ_API_KEY"`;

  return (
    <>
      <PageHeader
        title="API keys"
        sub="Use the Awaz API from your backend: start calls, read transcripts, manage agents."
        actions={
          <button
            type="button"
            onClick={() => {
              setCreated(null);
              setOpen(true);
            }}
            className={btn("primary")}
          >
            <Plus className="size-4" /> New key
          </button>
        }
      />
      <PageBody className="max-w-[980px]">
        <Card>
          {keys.length ? (
            <Table
              head={
                <tr>
                  <th className={th}>Name</th>
                  <th className={th}>Key</th>
                  <th className={`${th} hidden md:table-cell`}>Last used</th>
                  <th className={th}>Status</th>
                  <th className={th} />
                </tr>
              }
            >
              {keys.map((k) => (
                <tr key={k.id} className={tr}>
                  <td className={td}>
                    <span className="block text-foreground">{k.name}</span>
                    <span className="text-[12px] text-muted-foreground">Created {ago(k.created_at)}</span>
                  </td>
                  <td className={`${td} font-mono text-[12.5px] text-muted-foreground`}>{k.key_prefix}••••••••</td>
                  <td className={`${td} hidden text-muted-foreground md:table-cell`}>{ago(k.last_used_at)}</td>
                  <td className={td}>{k.is_active ? <Badge tone="green">Active</Badge> : <Badge>Revoked</Badge>}</td>
                  <td className={`${td} text-right`}>
                    <button type="button" onClick={() => toggle(k)} className={`text-[13px] transition ${k.is_active ? "text-red-600 hover:underline" : "text-foreground hover:underline"}`}>
                      {k.is_active ? "Revoke" : "Restore"}
                    </button>
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <EmptyState icon={KeyRound} title="No API keys" body="Create a key to call Awaz from your own code." />
          )}
        </Card>

        <Card>
          <CardHeader title="Quick start" sub="Send the key in the X-API-Key header. To start a call, turn on the API trigger in an agent's Advanced tab." />
          <div className="relative p-5">
            <pre className="overflow-x-auto rounded-md bg-zinc-950 p-4 font-mono text-[12.5px] leading-relaxed text-zinc-100">{sample}</pre>
            <div className="absolute top-7 right-7 rounded-md bg-white/10 [&_button]:text-white/70 [&_button:hover]:bg-white/10 [&_button:hover]:text-white">
              <CopyButton value={sample} label="Copy command" />
            </div>
          </div>
        </Card>
      </PageBody>

      <Modal open={open} onClose={() => !busy && setOpen(false)} title={created ? "Copy your key now" : "New API key"}>
        {created ? (
          <div className="space-y-4">
            <p className="flex items-start gap-2 rounded-md bg-amber-50 px-3.5 py-2.5 text-[13px] text-amber-800 border border-amber-200">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              This is the only time the full key is shown. Store it in your secrets manager.
            </p>
            <div className="flex items-center gap-2 rounded-md bg-muted px-3.5 py-2.5 font-mono text-[13px] border">
              <span className="min-w-0 flex-1 break-all">{created}</span>
              <CopyButton value={created} label="Copy key" />
            </div>
            <div className="flex justify-end">
              <button type="button" onClick={() => setOpen(false)} className={btn("primary")}>
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={create} className="space-y-4">
            <FormRow label="Name" htmlFor="key-name" hint="So you know where it's used.">
              <input id="key-name" autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder="Production backend" className={`${inputCls} h-10`} />
            </FormRow>
            {error ? <ErrorNote>{error}</ErrorNote> : null}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setOpen(false)} className={btn("ghost")}>
                Cancel
              </button>
              <button type="submit" disabled={busy} className={btn("primary")}>
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : null} Create key
              </button>
            </div>
          </form>
        )}
      </Modal>
    </>
  );
}
