"use client";

import { FileSpreadsheet, LoaderCircle, Plus, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { createCampaignApiV1CampaignCreatePost, getPresignedUploadUrlApiV1S3PresignedUploadUrlPost } from "@/client";
import { SwitchRow } from "@/components/app/client";
import { btn, Card, ErrorNote, FormRow, inputBase, inputCls } from "@/components/app/ui";
import { apiError } from "@/lib/errors";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
type Slot = { day_of_week: number; start_time: string; end_time: string };

/** Read the header row and count data rows, to preview the CSV before upload. */
async function inspectCsv(file: File) {
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const headers = (lines[0] ?? "").split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  return { headers, rows: Math.max(0, lines.length - 1), sample: lines.slice(1, 4).map((l) => l.split(",")) };
}

export function NewCampaignForm({
  agents,
  telephony,
  concurrencyLimit,
  retryDefaults,
  initialAgent,
}: {
  agents: { id: number; name: string }[];
  telephony: { id: number; name: string; isDefault: boolean }[];
  concurrencyLimit: number;
  retryDefaults: Record<string, unknown>;
  initialAgent: number | null;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [agent, setAgent] = useState<number | "">(initialAgent ?? agents[0]?.id ?? "");
  const [config, setConfig] = useState<number | "">(telephony.find((t) => t.isDefault)?.id ?? telephony[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [csv, setCsv] = useState<Awaited<ReturnType<typeof inspectCsv>> | null>(null);
  const [concurrency, setConcurrency] = useState(Math.min(5, concurrencyLimit));
  const [retry, setRetry] = useState({
    enabled: retryDefaults.enabled !== false,
    max_retries: Number(retryDefaults.max_retries ?? 1),
    retry_delay_seconds: Number(retryDefaults.retry_delay_seconds ?? 120),
    retry_on_busy: retryDefaults.retry_on_busy !== false,
    retry_on_no_answer: retryDefaults.retry_on_no_answer !== false,
    retry_on_voicemail: retryDefaults.retry_on_voicemail === true,
  });
  const [schedule, setSchedule] = useState(false);
  const [slots, setSlots] = useState<Slot[]>([0, 1, 2, 3, 4, 5].map((d) => ({ day_of_week: d, start_time: "10:00", end_time: "19:00" })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(f: File | null) {
    setFile(f);
    setCsv(f ? await inspectCsv(f) : null);
    if (f && !name) setName(f.name.replace(/\.csv$/i, "").replace(/[_-]+/g, " "));
  }

  const missingPhone = csv && !csv.headers.map((h) => h.toLowerCase()).includes("phone_number");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file || !agent) return;
    setBusy(true);
    setError(null);

    const presign = await getPresignedUploadUrlApiV1S3PresignedUploadUrlPost({
      body: { file_name: file.name, file_size: file.size, content_type: "text/csv" },
    }).catch(() => null);
    if (!presign?.data) {
      setBusy(false);
      return setError(apiError(presign?.error, "Couldn't prepare the upload."));
    }
    const put = await fetch(presign.data.upload_url, { method: "PUT", body: file, headers: { "content-type": "text/csv" } }).catch(() => null);
    if (!put?.ok) {
      setBusy(false);
      return setError("Upload failed. Check that file storage (MinIO) is reachable from your browser.");
    }

    const res = await createCampaignApiV1CampaignCreatePost({
      body: {
        name: name.trim() || file.name,
        workflow_id: agent,
        source_type: "csv",
        source_id: presign.data.file_key,
        telephony_configuration_id: config || null,
        max_concurrency: concurrency,
        retry_config: retry,
        schedule_config: schedule
          ? { enabled: true, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata", slots }
          : null,
      },
    }).catch(() => null);
    setBusy(false);
    if (!res?.data) return setError(apiError(res?.error, "Couldn't create the campaign."));
    router.push(`/campaigns/${res.data.id}`);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <Card className="space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormRow label="Campaign name" htmlFor="c-name">
            <input id="c-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="March EMI reminders" className={`${inputCls} h-10`} />
          </FormRow>
          <FormRow label="Agent" htmlFor="c-agent">
            <select id="c-agent" required value={agent} onChange={(e) => setAgent(Number(e.target.value))} className={`${inputCls} h-10`}>
              {!agents.length ? <option value="">Create an agent first</option> : null}
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </FormRow>
          <FormRow label="Call from" htmlFor="c-config">
            <select id="c-config" value={config} onChange={(e) => setConfig(Number(e.target.value))} className={`${inputCls} h-10`}>
              {!telephony.length ? <option value="">Connect a provider first</option> : null}
              {telephony.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </FormRow>
          <FormRow label={`Calls at the same time · ${concurrency}`} htmlFor="c-conc" hint={`Your workspace allows up to ${concurrencyLimit}.`}>
            <input id="c-conc" type="range" min={1} max={concurrencyLimit} value={concurrency} onChange={(e) => setConcurrency(Number(e.target.value))} className="mt-3 w-full accent-foreground" />
          </FormRow>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="text-[15px] font-medium text-foreground">Contact list</h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          A CSV with a <code className="rounded bg-muted px-1">phone_number</code> column in E.164 format. Every other column becomes a variable, like{" "}
          <code className="rounded bg-muted px-1">{"{{first_name}}"}</code>.
        </p>
        <input ref={fileInput} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => pick(e.target.files?.[0] ?? null)} />
        {file && csv ? (
          <div className="mt-4 rounded-md bg-muted p-4">
            <div className="flex items-center gap-3">
              <FileSpreadsheet className="size-5 text-emerald-700" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] text-foreground">{file.name}</span>
                <span className="text-[12.5px] text-muted-foreground">
                  {csv.rows.toLocaleString("en-IN")} contacts · {csv.headers.length} columns
                </span>
              </span>
              <button type="button" onClick={() => pick(null)} aria-label="Remove file" className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-red-600">
                <Trash2 className="size-4" />
              </button>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {csv.headers.map((h) => (
                <code key={h} className={`rounded-md px-1.5 py-0.5 text-[12px] ${h.toLowerCase() === "phone_number" ? "bg-emerald-50 text-emerald-700" : "bg-white text-foreground/80 border"}`}>
                  {h}
                </code>
              ))}
            </div>
            {missingPhone ? <p className="mt-3 text-[13px] text-red-600">No phone_number column found. Rename your phone column to phone_number.</p> : null}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              pick(e.dataTransfer.files?.[0] ?? null);
            }}
            className="mt-4 flex w-full flex-col items-center rounded-md border-2 border-dashed border-border px-6 py-10 text-center transition hover:border-border hover:bg-accent"
          >
            <Upload className="size-5 text-muted-foreground" />
            <span className="mt-2 text-[14px] text-foreground">Drop a CSV here or click to choose</span>
          </button>
        )}
      </Card>

      <Card className="space-y-4 p-5">
        <SwitchRow title="Retry unanswered calls" body="Try again later when a call isn't picked up." checked={retry.enabled} onChange={(v) => setRetry({ ...retry, enabled: v })} />
        {retry.enabled ? (
          <div className="space-y-4 rounded-md bg-muted p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormRow label="Retries per contact" htmlFor="r-max">
                <input id="r-max" type="number" min={1} max={5} value={retry.max_retries} onChange={(e) => setRetry({ ...retry, max_retries: Number(e.target.value) })} className={`${inputCls} h-10`} />
              </FormRow>
              <FormRow label="Wait between attempts (minutes)" htmlFor="r-delay">
                <input
                  id="r-delay"
                  type="number"
                  min={1}
                  value={Math.round(retry.retry_delay_seconds / 60)}
                  onChange={(e) => setRetry({ ...retry, retry_delay_seconds: Number(e.target.value) * 60 })}
                  className={`${inputCls} h-10`}
                />
              </FormRow>
            </div>
            <div className="flex flex-wrap gap-4 text-[13.5px] text-foreground/80">
              {(
                [
                  ["retry_on_no_answer", "No answer"],
                  ["retry_on_busy", "Busy"],
                  ["retry_on_voicemail", "Voicemail"],
                ] as const
              ).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2">
                  <input type="checkbox" checked={retry[k]} onChange={(e) => setRetry({ ...retry, [k]: e.target.checked })} className="accent-foreground" />
                  {label}
                </label>
              ))}
            </div>
          </div>
        ) : null}

        <div className="border-t border-border pt-4">
          <SwitchRow title="Only call during set hours" body="Calls pause outside these windows and resume automatically." checked={schedule} onChange={setSchedule} />
        </div>
        {schedule ? (
          <div className="space-y-2 rounded-md bg-muted p-4">
            {slots.map((s, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Day"
                  value={s.day_of_week}
                  onChange={(e) => setSlots(slots.map((x, j) => (j === i ? { ...x, day_of_week: Number(e.target.value) } : x)))}
                  className={`${inputBase} h-9 w-24`}
                >
                  {DAYS.map((d, n) => (
                    <option key={d} value={n}>
                      {d}
                    </option>
                  ))}
                </select>
                <input type="time" aria-label="From" value={s.start_time} onChange={(e) => setSlots(slots.map((x, j) => (j === i ? { ...x, start_time: e.target.value } : x)))} className={`${inputBase} h-9 w-32`} />
                <span className="text-[13px] text-muted-foreground">to</span>
                <input type="time" aria-label="Until" value={s.end_time} onChange={(e) => setSlots(slots.map((x, j) => (j === i ? { ...x, end_time: e.target.value } : x)))} className={`${inputBase} h-9 w-32`} />
                <button type="button" onClick={() => setSlots(slots.filter((_, j) => j !== i))} aria-label="Remove window" className="flex size-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-red-600">
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
            <button type="button" onClick={() => setSlots([...slots, { day_of_week: 0, start_time: "10:00", end_time: "19:00" }])} className={btn("secondary", "sm")}>
              <Plus className="size-3.5" /> Add window
            </button>
            <p className="pt-1 text-[12.5px] text-muted-foreground">Times are in your timezone ({Intl.DateTimeFormat().resolvedOptions().timeZone}). TRAI allows promotional calls 9 AM to 9 PM.</p>
          </div>
        ) : null}
      </Card>

      {error ? <ErrorNote>{error}</ErrorNote> : null}
      <div className="flex justify-end gap-2">
        <button type="submit" disabled={busy || !file || !agent || Boolean(missingPhone)} className={btn("primary")}>
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : null} Create campaign
        </button>
      </div>
    </form>
  );
}
