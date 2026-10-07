"use client";

import {
  AlertTriangle,
  Check,
  ChevronDown,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  Unplug,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  connectTokenApiV1CrmHubspotTokenPost,
  disconnectApiV1CrmHubspotDelete,
  type HubSpotList,
  type HubSpotProperty,
  type HubSpotSourceConfig,
  type HubSpotStatus,
  type LeadPreview,
  listsApiV1CrmHubspotListsGet,
  oauthStartApiV1CrmHubspotOauthStartGet,
  previewApiV1CrmHubspotPreviewPost,
  propertiesApiV1CrmHubspotPropertiesGet,
  statusApiV1CrmHubspotGet,
} from "@/client";
import { Popover } from "@/components/app/client";
import { btn, inputBase, inputCls } from "@/components/app/ui";
import { apiError } from "@/lib/errors";

export type HubSpotPick = {
  config: Required<
    Pick<
      HubSpotSourceConfig,
      "phone_property" | "properties" | "default_country_code" | "max_contacts"
    >
  > &
    HubSpotSourceConfig;
  dialable: number | null;
  label: string;
};

const DEFAULT_FIELDS = ["firstname", "lastname", "email", "company"];
const VAR_NAME: Record<string, string> = {
  firstname: "first_name",
  lastname: "last_name",
};

function Mark() {
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#ff7a59] text-[13px] font-bold text-white">
      H
    </span>
  );
}

function Connect({
  status,
  onConnected,
}: {
  status: HubSpotStatus | null;
  onConnected: (s: HubSpotStatus) => void;
}) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<"oauth" | "token" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState(!status?.oauth_available);

  const oauth = async () => {
    setBusy("oauth");
    setError(null);
    const res = await oauthStartApiV1CrmHubspotOauthStartGet({
      query: { return_to: "/campaigns/new?source=hubspot" },
    }).catch(() => null);
    if (!res?.data) {
      setBusy(null);
      return setError(apiError(res?.error, "Couldn't start HubSpot sign-in."));
    }
    window.location.href = res.data.authorize_url;
  };

  const connect = async () => {
    setBusy("token");
    setError(null);
    const res = await connectTokenApiV1CrmHubspotTokenPost({
      body: { access_token: token.trim() },
    }).catch(() => null);
    setBusy(null);
    if (!res?.data)
      return setError(apiError(res?.error, "Couldn't connect to HubSpot."));
    setToken("");
    onConnected(res.data);
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={oauth}
          disabled={!status?.oauth_available || busy != null}
          className="group flex flex-col items-start rounded-lg border p-4 text-left transition-colors hover:border-[#ff7a59]/60 hover:bg-[#ff7a59]/[0.04] disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:border-border disabled:hover:bg-transparent"
        >
          <span className="flex items-center gap-2.5">
            <Mark />
            <span className="text-[14.5px] font-medium text-foreground">
              Connect with HubSpot
            </span>
            {busy === "oauth" ? (
              <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
            ) : null}
          </span>
          <span className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            {status?.oauth_available
              ? "Sign in to HubSpot and approve read access to contacts and lists. Recommended."
              : "Needs a HubSpot app on this server (HUBSPOT_CLIENT_ID and secret). Use a private app token for now."}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setManual((m) => !m)}
          aria-expanded={manual}
          className={`flex flex-col items-start rounded-lg border p-4 text-left transition-colors hover:bg-muted/50 ${manual ? "border-foreground/40 bg-muted/40" : ""}`}
        >
          <span className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg border bg-background">
              <KeyRound className="size-4 text-muted-foreground" />
            </span>
            <span className="text-[14.5px] font-medium text-foreground">
              Add connection manually
            </span>
          </span>
          <span className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            Paste a private app access token from your HubSpot portal.
          </span>
        </button>
      </div>
      {manual ? (
        <div className="rounded-lg border bg-muted/30 p-4">
          <label
            htmlFor="hs-token"
            className="mb-1.5 block text-[13px] font-medium text-foreground"
          >
            Private app access token
          </label>
          <div className="flex gap-2">
            <input
              id="hs-token"
              type="password"
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onKeyDown={(e) =>
                e.key === "Enter" &&
                token.trim() &&
                (e.preventDefault(), connect())
              }
              placeholder="pat-na1-…"
              className={`${inputCls} h-10 font-mono`}
            />
            <button
              type="button"
              onClick={connect}
              disabled={!token.trim() || busy != null}
              className={btn("primary", "md", "h-10")}
            >
              {busy === "token" ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : null}{" "}
              Connect
            </button>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            In HubSpot: Settings → Integrations → Private apps → Create. Give it{" "}
            <code className="font-mono">crm.objects.contacts.read</code> and{" "}
            <code className="font-mono">crm.lists.read</code>. The token is
            stored for this workspace and never shown again.
          </p>
        </div>
      ) : null}
      {error ? <p className="text-[13px] text-destructive">{error}</p> : null}
    </div>
  );
}

function FieldPicker({
  props,
  selected,
  onAdd,
}: {
  props: HubSpotProperty[];
  selected: string[];
  onAdd: (name: string) => void;
}) {
  const [q, setQ] = useState("");
  const options = useMemo(
    () =>
      props
        .filter(
          (p) =>
            !selected.includes(p.name) &&
            (p.label.toLowerCase().includes(q.toLowerCase()) ||
              p.name.includes(q.toLowerCase())),
        )
        .slice(0, 60),
    [props, selected, q],
  );
  return (
    <Popover
      width={300}
      trigger={({ toggle }) => (
        <button
          type="button"
          onClick={toggle}
          className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed px-2.5 text-[12.5px] text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
        >
          <Plus className="size-3.5" /> Add field
        </button>
      )}
    >
      {(close) => (
        <div>
          <label className="relative block">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search HubSpot properties"
              className={`${inputCls} h-8 pl-8 text-[13px]`}
            />
          </label>
          <div className="mt-1.5 max-h-64 overflow-y-auto">
            {options.map((p) => (
              <button
                key={p.name}
                type="button"
                onClick={() => {
                  onAdd(p.name);
                  close();
                }}
                className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-[13px] hover:bg-accent"
              >
                <span className="truncate text-foreground">{p.label}</span>
                <code className="shrink-0 font-mono text-[11px] text-muted-foreground">
                  {p.name}
                </code>
              </button>
            ))}
            {!options.length ? (
              <p className="px-2 py-3 text-[13px] text-muted-foreground">
                No matching properties.
              </p>
            ) : null}
          </div>
        </div>
      )}
    </Popover>
  );
}

export function HubSpotSource({
  onChange,
  justConnected,
}: {
  onChange: (pick: HubSpotPick | null) => void;
  justConnected: boolean;
}) {
  const [status, setStatus] = useState<HubSpotStatus | null>(null);
  const [lists, setLists] = useState<HubSpotList[] | null>(null);
  const [props, setProps] = useState<HubSpotProperty[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [listId, setListId] = useState<string>("");
  const [phone, setPhone] = useState("phone");
  const [fields, setFields] = useState<string[]>(DEFAULT_FIELDS);
  const [cc, setCc] = useState("+91");
  const [max, setMax] = useState(5000);
  const [customize, setCustomize] = useState(false);
  const [preview, setPreview] = useState<LeadPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    statusApiV1CrmHubspotGet()
      .then((r) => setStatus(r.data ?? null))
      .catch(() => setStatus(null));
  }, []);

  const connected = Boolean(status?.connected);
  useEffect(() => {
    if (!connected) return;
    setLoadError(null);
    Promise.all([
      listsApiV1CrmHubspotListsGet().catch(() => null),
      propertiesApiV1CrmHubspotPropertiesGet().catch(() => null),
    ]).then(([l, p]) => {
      if (!l?.data || !p?.data)
        setLoadError(apiError(l?.error ?? p?.error, "Couldn't read HubSpot."));
      setLists(l?.data ?? []);
      setProps(p?.data ?? []);
    });
  }, [connected]);

  const listName = listId
    ? (lists?.find((l) => l.id === listId)?.name ?? `List ${listId}`)
    : null;
  const config = useMemo(
    () => ({
      list_id: listId || null,
      list_name: listName,
      phone_property: phone,
      properties: fields,
      default_country_code: cc,
      max_contacts: max,
    }),
    [listId, listName, phone, fields, cc, max],
  );

  const runPreview = useCallback(async () => {
    setPreviewing(true);
    setPreviewError(null);
    const res = await previewApiV1CrmHubspotPreviewPost({ body: config }).catch(
      () => null,
    );
    setPreviewing(false);
    if (!res?.data) {
      setPreview(null);
      setPreviewError(apiError(res?.error, "Couldn't preview the leads."));
      return;
    }
    setPreview(res.data);
  }, [config]);

  // Preview whenever the audience or mapping changes (debounced).
  useEffect(() => {
    if (!connected || lists == null) return;
    const t = setTimeout(runPreview, 400);
    return () => clearTimeout(t);
  }, [connected, lists, runPreview]);

  useEffect(() => {
    if (!connected) return onChangeRef.current(null);
    onChangeRef.current({
      config,
      dialable: preview ? preview.dialable : null,
      label: listName ? `HubSpot · ${listName}` : "HubSpot · All contacts",
    });
  }, [connected, config, preview, listName]);

  const disconnect = async () => {
    if (
      !confirm(
        "Disconnect HubSpot from this workspace? Campaigns already created keep their contacts.",
      )
    )
      return;
    const res = await disconnectApiV1CrmHubspotDelete().catch(() => null);
    if (res?.data) {
      setStatus(res.data);
      setLists(null);
      setPreview(null);
    }
  };

  if (!status) {
    return (
      <div className="flex items-center gap-2 py-6 text-[13px] text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" /> Checking HubSpot…
      </div>
    );
  }
  if (!connected) return <Connect status={status} onConnected={setStatus} />;

  const phoneProps = props.filter((p) => p.phone);
  const label = (name: string) =>
    props.find((p) => p.name === name)?.label ?? name;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2">
        <Mark />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[14px] font-medium text-foreground">
            HubSpot connected{" "}
            {justConnected ? (
              <Check className="size-4 text-emerald-600" />
            ) : null}
          </p>
          <p className="truncate text-[12.5px] text-muted-foreground">
            Portal {status.portal_id} ·{" "}
            {status.auth_type === "oauth"
              ? "OAuth"
              : `Private app token ${status.token_hint ?? ""}`}
          </p>
        </div>
        {status.ui_domain && status.portal_id ? (
          <a
            href={`https://${status.ui_domain}/contacts/${status.portal_id}/objects/0-1/views/all/list`}
            target="_blank"
            rel="noreferrer"
            className={btn("ghost", "sm")}
          >
            Open HubSpot <ExternalLink className="size-3.5" />
          </a>
        ) : null}
        <button
          type="button"
          onClick={disconnect}
          className={btn(
            "ghost",
            "sm",
            "text-muted-foreground hover:text-destructive",
          )}
        >
          <Unplug className="size-3.5" /> Disconnect
        </button>
      </div>

      {loadError ? (
        <p className="text-[13px] text-destructive">{loadError}</p>
      ) : null}

      <div>
        <label
          htmlFor="hs-list"
          className="mb-1.5 block text-[13px] font-medium text-foreground"
        >
          Who to call
        </label>
        <div className="relative">
          <select
            id="hs-list"
            value={listId}
            onChange={(e) => setListId(e.target.value)}
            className={`${inputCls} h-10 appearance-none pr-9`}
          >
            <option value="">All contacts</option>
            {(lists ?? []).map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {l.size != null ? ` · ${l.size.toLocaleString("en-IN")}` : ""}
                {l.dynamic ? " · active list" : ""}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {lists && !lists.length
            ? "No contact lists in HubSpot yet, so every contact is used."
            : "Contacts are fetched when the campaign starts."}
        </p>
      </div>
      <div className="rounded-lg border">
        <button
          type="button"
          onClick={() => setCustomize((c) => !c)}
          aria-expanded={customize}
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
        >
          <span className="min-w-0">
            <span className="block text-[13.5px] font-medium text-foreground">
              Customize fields
            </span>
            <span className="block truncate text-xs text-muted-foreground">
              Calls {label(phone)} ({cc}) · agent gets{" "}
              {fields.map((f) => `{{${VAR_NAME[f] ?? f}}}`).join(", ") ||
                "no extra fields"}{" "}
              · up to {max.toLocaleString("en-IN")} contacts
            </span>
          </span>
          <ChevronDown
            className={`size-4 shrink-0 text-muted-foreground transition-transform ${customize ? "rotate-180" : ""}`}
          />
        </button>
        {customize ? (
          <div className="space-y-5 border-t px-4 py-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="hs-phone"
                  className="mb-1.5 block text-[13px] font-medium text-foreground"
                >
                  Phone number field
                </label>
                <div className="flex gap-2">
                  <select
                    id="hs-phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className={`${inputCls} h-10`}
                  >
                    {(phoneProps.length
                      ? phoneProps
                      : [
                          {
                            name: "phone",
                            label: "Phone Number",
                          } as HubSpotProperty,
                        ]
                    ).map((p) => (
                      <option key={p.name} value={p.name}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="Default country code"
                    value={cc}
                    onChange={(e) => setCc(e.target.value)}
                    className={`${inputBase} h-10 w-20 text-center font-mono`}
                  />
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Falls back to mobile phone. Numbers without a country code get{" "}
                  {cc || "none"}.
                </p>
              </div>
              <div>
                <label
                  htmlFor="hs-max"
                  className="mb-1.5 block text-[13px] font-medium text-foreground"
                >
                  Most contacts to call
                </label>
                <input
                  id="hs-max"
                  type="number"
                  min={1}
                  max={20000}
                  value={max}
                  onChange={(e) =>
                    setMax(
                      Math.max(1, Math.min(20000, Number(e.target.value) || 1)),
                    )
                  }
                  className={`${inputCls} h-10`}
                />
              </div>
            </div>
            <div>
              <p className="mb-1.5 text-[13px] font-medium text-foreground">
                Fields the agent can use
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                {fields.map((f) => (
                  <span
                    key={f}
                    className="inline-flex h-7 items-center gap-1.5 rounded-full border bg-background pr-1.5 pl-2.5 text-[12.5px] text-foreground"
                  >
                    {label(f)}
                    <code className="font-mono text-[11px] text-muted-foreground">{`{{${VAR_NAME[f] ?? f}}}`}</code>
                    <button
                      type="button"
                      aria-label={`Remove ${label(f)}`}
                      onClick={() => setFields(fields.filter((x) => x !== f))}
                      className="flex size-5 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
                <FieldPicker
                  props={props}
                  selected={fields}
                  onAdd={(n) => setFields([...fields, n])}
                />
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                Use them in the agent&apos;s prompt or first message, like “Hi{" "}
                {"{{first_name}}"}”.{" "}
                <code className="font-mono">{"{{name}}"}</code> and{" "}
                <code className="font-mono">{"{{hubspot_contact_id}}"}</code>{" "}
                are always included.
              </p>
            </div>
          </div>
        ) : null}
      </div>

      <div className="rounded-lg border">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
          <p className="text-[13px] font-medium text-foreground">
            Lead preview
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={runPreview}
              disabled={previewing}
              aria-label="Refresh preview"
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <RefreshCw
                className={`size-3.5 ${previewing ? "animate-spin" : ""}`}
              />
            </button>
          </div>
        </div>
        {previewError ? (
          <p className="px-4 py-4 text-[13px] text-destructive">
            {previewError}
          </p>
        ) : !preview ? (
          <p className="flex items-center gap-2 px-4 py-4 text-[13px] text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" /> Reading contacts
            from HubSpot…
          </p>
        ) : (
          <>
            <div className="grid grid-cols-3 divide-x border-b text-center [&>div]:py-2">
              <div className="px-3 py-3">
                <p className="text-lg font-semibold text-foreground tabular-nums">
                  {preview.dialable.toLocaleString("en-IN")}
                </p>
                <p className="text-xs text-muted-foreground">will be called</p>
              </div>
              <div className="px-3 py-3">
                <p className="text-lg font-semibold text-foreground tabular-nums">
                  {preview.no_phone.toLocaleString("en-IN")}
                </p>
                <p className="text-xs text-muted-foreground">no phone number</p>
              </div>
              <div className="px-3 py-3">
                <p className="text-lg font-semibold text-foreground tabular-nums">
                  {preview.bad_phone.toLocaleString("en-IN")}
                </p>
                <p className="text-xs text-muted-foreground">unusable number</p>
              </div>
            </div>
            {preview.sample.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-[13px]">
                  <thead className="text-xs text-muted-foreground">
                    <tr className="border-b">
                      <th className="px-4 py-2 font-medium">Name</th>
                      <th className="px-4 py-2 font-medium">Calls</th>
                      {preview.variables
                        .filter(
                          (v) => v !== "name" && v !== "hubspot_contact_id",
                        )
                        .slice(0, 3)
                        .map((v) => (
                          <th key={v} className="px-4 py-2 font-medium">
                            <code className="font-mono">{v}</code>
                          </th>
                        ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sample.slice(0, 3).map((c, i) => (
                      <tr key={i} className="border-b last:border-b-0">
                        <td className="px-4 py-2 text-foreground">
                          {c.name || "–"}
                        </td>
                        <td className="px-4 py-2 font-mono text-foreground">
                          {c.phone_number}
                        </td>
                        {preview.variables
                          .filter(
                            (v) => v !== "name" && v !== "hubspot_contact_id",
                          )
                          .slice(0, 3)
                          .map((v) => (
                            <td
                              key={v}
                              className="max-w-[180px] truncate px-4 py-2 text-muted-foreground"
                            >
                              {c.variables[v] || "–"}
                            </td>
                          ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex items-start gap-2.5 px-4 py-4 text-[13px] text-amber-800">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  {preview.scanned
                    ? `None of the ${preview.scanned} contacts${listName ? ` in “${listName}”` : ""} have a usable phone number in “${label(phone)}”. Add numbers in HubSpot or pick another field.`
                    : "This list has no contacts yet."}
                  {preview.bad_phone_samples.length
                    ? ` Unusable values look like: ${preview.bad_phone_samples.join(", ")}.`
                    : ""}
                </span>
              </div>
            )}
            {preview.capped ? (
              <p className="border-t px-4 py-2 text-xs text-muted-foreground">
                Counted the first {preview.scanned.toLocaleString("en-IN")}{" "}
                contacts. All {max.toLocaleString("en-IN")} are fetched at
                launch.
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
