"use client";

import { LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { savePreferencesApiV1OrganizationsPreferencesPut, type OrganizationPreferencesResponse } from "@/client";
import { CopyButton, SwitchRow } from "@/components/app/client";
import { btn, Card, CardHeader, ErrorNote, FormRow, inputCls } from "@/components/app/ui";
import { apiError } from "@/lib/errors";

const TIMEZONES = ["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Europe/London", "America/New_York", "America/Los_Angeles", "UTC"];

export function SettingsForm({ prefs, workspaceId }: { prefs: OrganizationPreferencesResponse | null; workspaceId: number | null }) {
  const router = useRouter();
  const [timezone, setTimezone] = useState(prefs?.timezone ?? "Asia/Kolkata");
  const [testPhone, setTestPhone] = useState(prefs?.test_phone_number ?? "");
  const [mapOn, setMapOn] = useState(prefs?.disposition_mapping_enabled ?? false);
  const [mapping, setMapping] = useState<[string, string][]>(Object.entries(prefs?.disposition_mapping ?? {}));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await savePreferencesApiV1OrganizationsPreferencesPut({
      body: {
        ...(prefs ?? {}),
        timezone,
        test_phone_number: testPhone.trim() || null,
        disposition_mapping_enabled: mapOn,
        disposition_mapping: Object.fromEntries(mapping.filter(([k, v]) => k.trim() && v.trim())),
      },
    }).catch(() => null);
    setBusy(false);
    if (!res || res.error) return setError(apiError(res?.error, "Couldn't save settings."));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    router.refresh();
  }

  return (
    <form onSubmit={save} className="space-y-5">
      <Card>
        <CardHeader title="General" />
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <FormRow label="Workspace ID">
            <div className="flex h-10 items-center gap-2 rounded-md bg-muted px-3.5 font-mono text-[13px] text-foreground/80">
              <span className="flex-1">{workspaceId ?? "–"}</span>
              {workspaceId ? <CopyButton value={String(workspaceId)} label="Copy workspace ID" /> : null}
            </div>
          </FormRow>
          <FormRow label="Timezone" htmlFor="tz" hint="Used for reports and campaign calling hours.">
            <select id="tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} className={`${inputCls} h-10`}>
              {[...new Set([timezone, ...TIMEZONES])].map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </FormRow>
          <FormRow label="Your test number" htmlFor="test-phone" hint="Pre-filled when you test an agent by phone." className="sm:col-span-2">
            <input id="test-phone" type="tel" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="+919876543210" className={`${inputCls} h-10 max-w-[280px]`} />
          </FormRow>
        </div>
      </Card>

      <Card>
        <CardHeader title="Outcome mapping" sub="Rename call outcomes to match the codes your CRM or dialer expects." />
        <div className="space-y-4 p-5">
          <SwitchRow title="Map outcomes" checked={mapOn} onChange={setMapOn} />
          {mapOn ? (
            <div className="space-y-2">
              {mapping.map(([k, v], i) => (
                <div key={i} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-2">
                  <input aria-label="Awaz outcome" value={k} onChange={(e) => setMapping(mapping.map((m, j) => (j === i ? [e.target.value, m[1]] : m)))} placeholder="APPOINTMENT_BOOKED" className={`${inputCls} h-9 font-mono text-[13px]`} />
                  <span className="text-muted-foreground/70">→</span>
                  <input aria-label="Your code" value={v} onChange={(e) => setMapping(mapping.map((m, j) => (j === i ? [m[0], e.target.value] : m)))} placeholder="BOOKED" className={`${inputCls} h-9 font-mono text-[13px]`} />
                  <button type="button" onClick={() => setMapping(mapping.filter((_, j) => j !== i))} aria-label="Remove mapping" className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-red-600">
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
              <button type="button" onClick={() => setMapping([...mapping, ["", ""]])} className={btn("secondary", "sm")}>
                <Plus className="size-3.5" /> Add mapping
              </button>
            </div>
          ) : null}
        </div>
      </Card>

      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <div className="flex items-center justify-end gap-3">
        {saved ? <span className="text-[13px] text-emerald-700">Saved</span> : null}
        <button type="submit" disabled={busy} className={btn("primary")}>
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : null} Save settings
        </button>
      </div>
    </form>
  );
}
