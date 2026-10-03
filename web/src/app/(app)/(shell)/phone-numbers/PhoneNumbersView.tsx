"use client";

import { CheckCircle2, ChevronRight, CircleAlert, LoaderCircle, Phone, Plus, Server, Star } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  createPhoneNumberApiV1OrganizationsTelephonyConfigsConfigIdPhoneNumbersPost,
  createTelephonyConfigurationApiV1OrganizationsTelephonyConfigsPost,
  setDefaultCallerIdApiV1OrganizationsTelephonyConfigsConfigIdPhoneNumbersPhoneNumberIdSetDefaultCallerPost,
  updatePhoneNumberApiV1OrganizationsTelephonyConfigsConfigIdPhoneNumbersPhoneNumberIdPut,
  type PhoneNumberResponse,
  type TelephonyConfigurationCreateRequest,
  type TelephonyConfigurationListItem,
  type TelephonyProviderMetadata,
} from "@/client";
import { Modal } from "@/components/app/client";
import { PageBody, PageHeader } from "@/components/app/PageHeader";
import { Badge, btn, Card, CardHeader, EmptyState, ErrorNote, FormRow, inputCls, Table, td, th, tr } from "@/components/app/ui";
import { apiError } from "@/lib/errors";

import { cleanValues, ProviderFields, type Values } from "./ProviderFields";

type Num = PhoneNumberResponse & { providerName: string; provider: string };
type Agent = { id: number; name: string };

function ConnectProvider({ metadata, onDone }: { metadata: TelephonyProviderMetadata[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [provider, setProvider] = useState(metadata.find((m) => m.provider === "vobiz")?.provider ?? metadata[0]?.provider ?? "");
  const [name, setName] = useState("");
  const [values, setValues] = useState<Values>({});
  const [isDefault, setIsDefault] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const meta = metadata.find((m) => m.provider === provider);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!meta) return;
    setBusy(true);
    setError(null);
    const res = await createTelephonyConfigurationApiV1OrganizationsTelephonyConfigsPost({
      body: {
        name: name.trim() || meta.display_name,
        is_default_outbound: isDefault,
        config: { provider, ...cleanValues(meta.fields, values, {}) } as TelephonyConfigurationCreateRequest["config"],
      },
    }).catch(() => null);
    setBusy(false);
    if (!res?.data) return setError(apiError(res?.error, "Couldn't connect the provider. Check the credentials."));
    setOpen(false);
    setValues({});
    setName("");
    onDone();
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={btn("secondary")}>
        <Server className="size-4" /> Connect provider
      </button>
      <Modal open={open} onClose={() => !busy && setOpen(false)} width={640} title="Connect a telephony provider" sub="Awaz places and receives calls through your own carrier account.">
        <form onSubmit={submit} className="space-y-5">
          <div className="flex flex-wrap gap-2">
            {metadata.map((m) => (
              <button
                key={m.provider}
                type="button"
                aria-pressed={provider === m.provider}
                onClick={() => {
                  setProvider(m.provider);
                  setValues({});
                }}
                className={`rounded-full px-3.5 py-1.5 text-[13px] transition ${
                  provider === m.provider ? "bg-primary text-white" : "bg-white text-foreground/80 border hover:border-foreground/25"
                }`}
              >
                {m.display_name}
              </button>
            ))}
          </div>
          {meta ? (
            <>
              <FormRow label="Name" htmlFor="tp-name">
                <input id="tp-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={`${meta.display_name} production`} className={`${inputCls} h-10`} />
              </FormRow>
              <ProviderFields fields={meta.fields} values={values} onChange={setValues} editing={false} />
              <label className="flex items-center gap-2 text-[13.5px] text-foreground/80">
                <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} className="accent-foreground" />
                Use for outbound calls by default
              </label>
              {meta.docs_url ? (
                <a href={meta.docs_url} target="_blank" rel="noreferrer" className="inline-block text-[13px] text-foreground hover:underline">
                  {meta.display_name} setup guide
                </a>
              ) : null}
            </>
          ) : null}
          {error ? <ErrorNote>{error}</ErrorNote> : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className={btn("ghost")}>
              Cancel
            </button>
            <button type="submit" disabled={busy || !meta} className={btn("primary")}>
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : null} Connect
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

function AddNumber({ providers, agents, onDone }: { providers: TelephonyConfigurationListItem[]; agents: Agent[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<number | "">(providers[0]?.id ?? "");
  const [address, setAddress] = useState("+91");
  const [label, setLabel] = useState("");
  const [agent, setAgent] = useState<number | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!config) return;
    setBusy(true);
    setError(null);
    const res = await createPhoneNumberApiV1OrganizationsTelephonyConfigsConfigIdPhoneNumbersPost({
      path: { config_id: config },
      body: { address: address.replace(/\s+/g, ""), label: label || null, inbound_workflow_id: agent || null },
    }).catch(() => null);
    setBusy(false);
    if (!res?.data) return setError(apiError(res?.error, "Couldn't add the number."));
    setOpen(false);
    setAddress("+91");
    setLabel("");
    onDone();
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} disabled={!providers.length} className={btn("primary")}>
        <Plus className="size-4" /> Add number
      </button>
      <Modal open={open} onClose={() => !busy && setOpen(false)} title="Add a phone number" sub="Register a number you own with your provider so Awaz can use it.">
        <form onSubmit={submit} className="space-y-4">
          <FormRow label="Provider" htmlFor="n-config">
            <select id="n-config" value={config} onChange={(e) => setConfig(Number(e.target.value))} className={`${inputCls} h-10`}>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </FormRow>
          <FormRow label="Number" htmlFor="n-address" hint="E.164 format with country code, or a SIP address.">
            <input id="n-address" required value={address} onChange={(e) => setAddress(e.target.value)} className={`${inputCls} h-10 font-mono`} />
          </FormRow>
          <FormRow label="Label (optional)" htmlFor="n-label">
            <input id="n-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Front desk" className={`${inputCls} h-10`} />
          </FormRow>
          <FormRow label="Answer incoming calls with" htmlFor="n-agent">
            <select id="n-agent" value={agent} onChange={(e) => setAgent(e.target.value ? Number(e.target.value) : "")} className={`${inputCls} h-10`}>
              <option value="">No agent (outbound only)</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </FormRow>
          {error ? <ErrorNote>{error}</ErrorNote> : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className={btn("ghost")}>
              Cancel
            </button>
            <button type="submit" disabled={busy} className={btn("primary")}>
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : null} Add number
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

function NumberRow({ n, agents, onChanged }: { n: Num; agents: Agent[]; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  async function assign(id: string) {
    setBusy(true);
    await updatePhoneNumberApiV1OrganizationsTelephonyConfigsConfigIdPhoneNumbersPhoneNumberIdPut({
      path: { config_id: n.telephony_configuration_id, phone_number_id: n.id },
      body: id ? { inbound_workflow_id: Number(id) } : { clear_inbound_workflow: true },
    }).catch(() => null);
    setBusy(false);
    onChanged();
  }
  async function makeDefault() {
    setBusy(true);
    await setDefaultCallerIdApiV1OrganizationsTelephonyConfigsConfigIdPhoneNumbersPhoneNumberIdSetDefaultCallerPost({
      path: { config_id: n.telephony_configuration_id, phone_number_id: n.id },
    }).catch(() => null);
    setBusy(false);
    onChanged();
  }
  return (
    <tr className={tr}>
      <td className={td}>
        <span className="flex items-center gap-2 font-mono text-[13.5px] text-foreground">
          {n.address}
          {n.is_default_caller_id ? <Star className="size-3.5 fill-[#f59e0b] text-[#f59e0b]" aria-label="Default caller ID" /> : null}
        </span>
        {n.label ? <span className="text-[12px] text-muted-foreground">{n.label}</span> : null}
      </td>
      <td className={`${td} text-foreground/80`}>{n.providerName}</td>
      <td className={td}>
        <select
          aria-label={`Agent answering ${n.address}`}
          value={n.inbound_workflow_id ?? ""}
          disabled={busy}
          onChange={(e) => assign(e.target.value)}
          className={`${inputCls} h-8 max-w-[220px] text-[13px]`}
        >
          <option value="">Not answered</option>
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </td>
      <td className={td}>{n.is_active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}</td>
      <td className={`${td} text-right`}>
        {!n.is_default_caller_id ? (
          <button type="button" onClick={makeDefault} disabled={busy} className="text-[12.5px] text-muted-foreground transition hover:text-foreground">
            Make default caller ID
          </button>
        ) : null}
      </td>
    </tr>
  );
}

export function PhoneNumbersView({
  providers,
  numbers,
  metadata,
  agents,
}: {
  providers: TelephonyConfigurationListItem[];
  numbers: Num[];
  metadata: TelephonyProviderMetadata[];
  agents: Agent[];
}) {
  const router = useRouter();
  const refresh = () => router.refresh();
  const display = (p: string) => metadata.find((m) => m.provider === p)?.display_name ?? p;

  return (
    <>
      <PageHeader
        title="Phone numbers"
        sub="Numbers your agents call from and answer on, through your telephony providers."
        actions={
          <>
            <ConnectProvider metadata={metadata} onDone={refresh} />
            <AddNumber providers={providers} agents={agents} onDone={refresh} />
          </>
        }
      />
      <PageBody>
        <Card>
          <CardHeader title="Numbers" sub="Pick which agent answers each number." />
          {numbers.length ? (
            <Table
              head={
                <tr>
                  <th className={th}>Number</th>
                  <th className={th}>Provider</th>
                  <th className={th}>Inbound agent</th>
                  <th className={th}>Status</th>
                  <th className={th} />
                </tr>
              }
            >
              {numbers.map((n) => (
                <NumberRow key={n.id} n={n} agents={agents} onChanged={refresh} />
              ))}
            </Table>
          ) : (
            <EmptyState
              icon={Phone}
              title="No numbers yet"
              body={providers.length ? "Add a number you own with your provider." : "Connect a telephony provider like Vobiz, Exotel, Plivo or Twilio first."}
            />
          )}
        </Card>

        <div>
          <h2 className="mb-3 text-[15px] font-medium text-foreground">Providers</h2>
          {providers.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {providers.map((p) => (
                <Link
                  key={p.id}
                  href={`/phone-numbers/providers/${p.id}`}
                  className="group rounded-lg bg-white p-4 border transition hover:border-foreground/25"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[14.5px] text-foreground">{p.name}</p>
                      <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                        {display(p.provider)} · {p.connectivity === "sip" ? "SIP" : "API"} · {p.phone_number_count ?? 0} numbers
                      </p>
                    </div>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground/70 transition group-hover:text-foreground" />
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    {p.is_default_outbound ? <Badge tone="blue">Default outbound</Badge> : null}
                    {p.inactive ? (
                      <Badge tone="red">Inactive</Badge>
                    ) : p.is_ready_for_outbound ? (
                      <Badge tone="green">
                        <CheckCircle2 className="size-3" /> Ready
                      </Badge>
                    ) : (
                      <Badge tone="amber">
                        <CircleAlert className="size-3" /> Setup needed
                      </Badge>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <Card>
              <EmptyState icon={Server} title="No providers connected" body="Connect your carrier account to start calling." action={<ConnectProvider metadata={metadata} onDone={refresh} />} />
            </Card>
          )}
        </div>
      </PageBody>
    </>
  );
}
