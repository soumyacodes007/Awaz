"use client";

import { Check, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  createTelephonyTrunkApiV1OrganizationsTelephonyConfigsConfigIdTrunksPost,
  deleteTelephonyConfigurationApiV1OrganizationsTelephonyConfigsConfigIdDelete,
  deleteTelephonyTrunkApiV1OrganizationsTelephonyConfigsConfigIdTrunksTrunkIdDelete,
  setDefaultOutboundApiV1OrganizationsTelephonyConfigsConfigIdSetDefaultOutboundPost,
  updateTelephonyConfigurationApiV1OrganizationsTelephonyConfigsConfigIdPut,
  type TelephonyConfigurationDetail,
  type TelephonyConfigurationUpdateRequest,
  type TelephonyProviderMetadata,
} from "@/client";
import { CopyButton, Modal } from "@/components/app/client";
import { PageBody, PageHeader } from "@/components/app/PageHeader";
import { Badge, btn, Card, CardHeader, ErrorNote, FormRow, inputCls } from "@/components/app/ui";
import { apiError } from "@/lib/errors";

import { cleanValues, ProviderFields, type Values } from "../../ProviderFields";

const CLOUDONIX_REGIONS = ["India", "UAE", "Global"];

function AddTrunk({ configId, onDone }: { configId: number; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [region, setRegion] = useState("India");
  const [domain, setDomain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await createTelephonyTrunkApiV1OrganizationsTelephonyConfigsConfigIdTrunksPost({
      path: { config_id: configId },
      body: { name: name || `${region} trunk`, enabled: true, settings: { region, sip_domain: domain } },
    }).catch(() => null);
    setBusy(false);
    if (!res?.data) return setError(apiError(res?.error, "Couldn't add the trunk."));
    setOpen(false);
    onDone();
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={btn("secondary", "sm")}>
        <Plus className="size-3.5" /> Add trunk
      </button>
      <Modal open={open} onClose={() => !busy && setOpen(false)} title="Add an outbound trunk" sub="Where outbound calls are sent: your SIP carrier or PBX.">
        <form onSubmit={submit} className="space-y-4">
          <FormRow label="Name" htmlFor="tr-name">
            <input id="tr-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Carrier trunk" className={`${inputCls} h-10`} />
          </FormRow>
          <FormRow label="Region" htmlFor="tr-region" hint="The SIP edge that sends your calls. Allow its origin IP on your carrier.">
            <select id="tr-region" value={region} onChange={(e) => setRegion(e.target.value)} className={`${inputCls} h-10`}>
              {CLOUDONIX_REGIONS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </FormRow>
          <FormRow label="SIP domain" htmlFor="tr-domain" hint="The domain your carrier expects in the SIP To header.">
            <input id="tr-domain" required value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="sip.mycarrier.in" className={`${inputCls} h-10 font-mono`} />
          </FormRow>
          {error ? <ErrorNote>{error}</ErrorNote> : null}
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className={btn("ghost")}>
              Cancel
            </button>
            <button type="submit" disabled={busy} className={btn("primary")}>
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : null} Add trunk
            </button>
          </div>
        </form>
      </Modal>
    </>
  );
}

export function ProviderDetail({ config, meta }: { config: TelephonyConfigurationDetail; meta: TelephonyProviderMetadata | null }) {
  const router = useRouter();
  const [name, setName] = useState(config.name);
  const [values, setValues] = useState<Values>(config.credentials);
  const [busy, setBusy] = useState<"save" | "default" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const checklist = config.setup_checklist;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!meta) return;
    setBusy("save");
    setError(null);
    const res = await updateTelephonyConfigurationApiV1OrganizationsTelephonyConfigsConfigIdPut({
      path: { config_id: config.id },
      body: {
        name,
        config: { provider: config.provider, ...cleanValues(meta.fields, values, config.credentials) } as TelephonyConfigurationUpdateRequest["config"],
      },
    }).catch(() => null);
    setBusy(null);
    if (!res || res.error) return setError(apiError(res?.error, "Couldn't save."));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    router.refresh();
  }

  async function makeDefault() {
    setBusy("default");
    await setDefaultOutboundApiV1OrganizationsTelephonyConfigsConfigIdSetDefaultOutboundPost({ path: { config_id: config.id } }).catch(() => null);
    setBusy(null);
    router.refresh();
  }

  async function remove() {
    if (!window.confirm(`Remove "${config.name}"? Its numbers stop working in Awaz.`)) return;
    setBusy("delete");
    const res = await deleteTelephonyConfigurationApiV1OrganizationsTelephonyConfigsConfigIdDelete({ path: { config_id: config.id } }).catch(() => null);
    setBusy(null);
    if (res && !res.error) {
      router.push("/phone-numbers");
      router.refresh();
    } else setError(apiError(res?.error, "Couldn't remove the provider."));
  }

  async function removeTrunk(trunkId: number) {
    if (!window.confirm("Remove this trunk?")) return;
    await deleteTelephonyTrunkApiV1OrganizationsTelephonyConfigsConfigIdTrunksTrunkIdDelete({ path: { config_id: config.id, trunk_id: trunkId } }).catch(() => null);
    router.refresh();
  }

  return (
    <>
      <PageHeader
        title={config.name}
        sub={`${meta?.display_name ?? config.provider} · ${config.connectivity === "sip" ? "SIP" : "API"}`}
        back={{ href: "/phone-numbers", label: "Phone numbers" }}
        actions={
          config.is_default_outbound ? (
            <Badge tone="blue">Default outbound</Badge>
          ) : (
            <button type="button" onClick={makeDefault} disabled={busy !== null} className={btn("secondary")}>
              {busy === "default" ? <LoaderCircle className="size-4 animate-spin" /> : null} Use for outbound calls
            </button>
          )
        }
      />
      <PageBody className="max-w-[920px]">
        {checklist ? (
          <Card>
            <CardHeader
              title="Setup"
              sub={checklist.ready_for_outbound ? "Ready to place outbound calls." : (checklist.outbound_blocked_reason ?? undefined)}
              actions={checklist.ready_for_outbound ? <Badge tone="green">Ready</Badge> : <Badge tone="amber">Setup needed</Badge>}
            />
            <ol className="space-y-3 p-5">
              {checklist.steps.map((s) => (
                <li key={s.key} className="flex gap-3">
                  <span
                    className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full ${s.complete ? "bg-emerald-600 text-white" : "border"}`}
                  >
                    {s.complete ? <Check className="size-3" strokeWidth={3} /> : null}
                  </span>
                  <span>
                    <span className="block text-[14px] text-foreground">{s.title}</span>
                    <span className="mt-0.5 block text-[13px] leading-relaxed text-muted-foreground">{s.description}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Card>
        ) : null}

        {config.sip_connectivity ? (
          <Card>
            <CardHeader title="SIP endpoints" sub="Point your carrier or PBX at one of these for inbound calls, and allow the origin IP for outbound." />
            <div className="divide-y divide-border">
              {config.sip_connectivity.regions.map((r) => (
                <div key={r.region} className="space-y-2 px-5 py-4">
                  <div className="flex items-center justify-between">
                    <p className="text-[14px] text-foreground">{r.region}</p>
                    <span className="flex items-center gap-1 font-mono text-[12px] text-muted-foreground">
                      Origin IP {r.outbound_origin_ip}
                      <CopyButton value={r.outbound_origin_ip} label="Copy IP" />
                    </span>
                  </div>
                  {r.inbound_transports.map((t) => (
                    <div key={t.uri} className="flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5 font-mono text-[12px]">
                      <span className="w-9 shrink-0 text-muted-foreground">{t.transport}</span>
                      <span className="min-w-0 flex-1 truncate text-foreground/80">{t.uri}</span>
                      <CopyButton value={t.uri} label="Copy URI" />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </Card>
        ) : null}

        {config.supports_trunks ? (
          <Card>
            <CardHeader title="Outbound trunks" actions={<AddTrunk configId={config.id} onDone={() => router.refresh()} />} />
            {config.trunks?.length ? (
              <ul className="divide-y divide-border">
                {config.trunks.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <span>
                      <span className="block text-[14px] text-foreground">{t.name}</span>
                      <span className="font-mono text-[12px] text-muted-foreground">
                        {String(t.settings.region ?? "")} · {String(t.settings.sip_domain ?? "")}
                      </span>
                    </span>
                    <button type="button" onClick={() => removeTrunk(t.id)} aria-label={`Remove ${t.name}`} className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-red-600">
                      <Trash2 className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-5 py-5 text-[13px] text-muted-foreground">No trunks yet. Outbound calls need at least one.</p>
            )}
          </Card>
        ) : null}

        {meta ? (
          <Card>
            <CardHeader title="Credentials" sub="Secrets are stored encrypted and never shown again." />
            <form onSubmit={save} className="space-y-5 p-5">
              <FormRow label="Name" htmlFor="p-name">
                <input id="p-name" value={name} onChange={(e) => setName(e.target.value)} className={`${inputCls} h-10 max-w-[360px]`} />
              </FormRow>
              <ProviderFields fields={meta.fields} values={values} onChange={setValues} editing />
              {error ? <ErrorNote>{error}</ErrorNote> : null}
              <div className="flex items-center justify-between">
                <button type="button" onClick={remove} disabled={busy !== null} className={btn("danger", "sm")}>
                  {busy === "delete" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />} Remove provider
                </button>
                <div className="flex items-center gap-3">
                  {saved ? <span className="text-[13px] text-emerald-700">Saved</span> : null}
                  <button type="submit" disabled={busy !== null} className={btn("primary")}>
                    {busy === "save" ? <LoaderCircle className="size-4 animate-spin" /> : null} Save
                  </button>
                </div>
              </div>
            </form>
          </Card>
        ) : null}
      </PageBody>
    </>
  );
}
