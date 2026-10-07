"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileSpreadsheet,
  LoaderCircle,
  Pencil,
  Trash2,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import {
  createCampaignApiV1CampaignCreatePost,
  getPresignedUploadUrlApiV1S3PresignedUploadUrlPost,
} from "@/client";
import { btn, ErrorNote, inputCls } from "@/components/app/ui";
import { apiError } from "@/lib/errors";

import { HubSpotSource, type HubSpotPick } from "./HubSpotSource";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const TIMEZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Australia/Sydney",
  "UTC",
];
const WAITS = [
  { label: "15 min", s: 900 },
  { label: "30 min", s: 1800 },
  { label: "1 hour", s: 3600 },
  { label: "2 hours", s: 7200 },
  { label: "4 hours", s: 14400 },
];
const HOUR_PRESETS = [
  {
    label: "Weekdays, 10 AM–7 PM",
    days: [0, 1, 2, 3, 4],
    from: "10:00",
    to: "19:00",
  },
  {
    label: "Mon–Sat, 10 AM–7 PM",
    days: [0, 1, 2, 3, 4, 5],
    from: "10:00",
    to: "19:00",
  },
  {
    label: "Every day, 9 AM–9 PM",
    days: [0, 1, 2, 3, 4, 5, 6],
    from: "09:00",
    to: "21:00",
  },
];
const STEPS = ["Leads", "Agent", "Schedule", "Retries", "Review"] as const;

type Source = "csv" | "hubspot";

/** Read the header row and count data rows, to preview the CSV before upload. */
async function inspectCsv(file: File) {
  const text = await file.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const headers = (lines[0] ?? "")
    .split(",")
    .map((h) => h.trim().replace(/^"|"$/g, ""));
  return { headers, rows: Math.max(0, lines.length - 1) };
}

const dayRange = (days: number[]) => {
  const s = [...days].sort();
  if (!s.length) return "No days";
  if (s.length === 7) return "Every day";
  const contiguous = s.every((d, i) => i === 0 || d === s[i - 1] + 1);
  return contiguous && s.length > 2
    ? `${DAYS[s[0]]}–${DAYS[s[s.length - 1]]}`
    : s.map((d) => DAYS[d]).join(", ");
};

const time12 = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "AM" : "PM"}`;
};

/** A big selectable option card. */
function Option({
  on,
  onClick,
  title,
  body,
  icon,
}: {
  on: boolean;
  onClick: () => void;
  title: string;
  body: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-all ${on ? "border-foreground ring-1 ring-foreground" : "hover:border-foreground/30 hover:bg-muted/40"}`}
    >
      {icon}
      <span className="min-w-0 flex-1">
        <span className="block text-[14.5px] font-medium text-foreground">
          {title}
        </span>
        <span className="mt-0.5 block text-[13px] leading-relaxed text-muted-foreground">
          {body}
        </span>
      </span>
      <span
        className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border ${on ? "border-foreground bg-primary text-primary-foreground" : ""}`}
      >
        {on ? <Check className="size-3" /> : null}
      </span>
    </button>
  );
}

function Pill({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`h-9 rounded-full border px-4 text-[13.5px] font-medium transition-colors ${on ? "border-foreground bg-primary text-primary-foreground" : "bg-background text-foreground hover:bg-accent"}`}
    >
      {children}
    </button>
  );
}

function Label({
  children,
  hint,
}: {
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="mb-2">
      <p className="text-[14px] font-medium text-foreground">{children}</p>
      {hint ? (
        <p className="text-[12.5px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function NewCampaignForm({
  agents,
  telephony,
  concurrencyLimit,
  retryDefaults,
  initialAgent,
  initialSource,
  hubspotResult,
}: {
  agents: { id: number; name: string }[];
  telephony: { id: number; name: string; isDefault: boolean }[];
  concurrencyLimit: number;
  retryDefaults: Record<string, unknown>;
  initialAgent: number | null;
  initialSource: Source;
  hubspotResult: string | null;
}) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const browserTz =
    typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : "Asia/Kolkata";

  const [step, setStep] = useState(0);
  const [reached, setReached] = useState(0);
  const [dir, setDir] = useState(1);

  const [name, setName] = useState("");
  const [source, setSource] = useState<Source>(initialSource);
  const [file, setFile] = useState<File | null>(null);
  const [csv, setCsv] = useState<Awaited<ReturnType<typeof inspectCsv>> | null>(
    null,
  );
  const [hubspot, setHubspot] = useState<HubSpotPick | null>(null);
  const [agent, setAgent] = useState<number | "">(
    initialAgent ?? agents[0]?.id ?? "",
  );
  const [config, setConfig] = useState<number | "">(
    telephony.find((t) => t.isDefault)?.id ?? telephony[0]?.id ?? "",
  );

  const [hoursOn, setHoursOn] = useState(true);
  const [days, setDays] = useState<number[]>([0, 1, 2, 3, 4]);
  const [from, setFrom] = useState("10:00");
  const [to, setTo] = useState("19:00");
  const [tz, setTz] = useState(
    TIMEZONES.includes(browserTz) ? browserTz : "Asia/Kolkata",
  );

  const [attempts, setAttempts] = useState(
    Math.min(5, Number(retryDefaults.max_retries ?? 1) + 1),
  );
  const [wait, setWait] = useState(
    Math.max(900, Number(retryDefaults.retry_delay_seconds ?? 1800)),
  );
  const [when, setWhen] = useState({
    retry_on_no_answer: retryDefaults.retry_on_no_answer !== false,
    retry_on_busy: retryDefaults.retry_on_busy !== false,
    retry_on_voicemail: retryDefaults.retry_on_voicemail === true,
  });
  const [concurrency, setConcurrency] = useState(Math.min(5, concurrencyLimit));

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pick(f: File | null) {
    setFile(f);
    setCsv(f ? await inspectCsv(f) : null);
    if (f && !name)
      setName(f.name.replace(/\.csv$/i, "").replace(/[_-]+/g, " "));
  }

  const missingPhone =
    csv && !csv.headers.map((h) => h.toLowerCase()).includes("phone_number");
  const leadCount =
    source === "csv" ? (csv?.rows ?? 0) : (hubspot?.dialable ?? 0);
  const valid = [
    source === "csv"
      ? Boolean(file && csv && !missingPhone && csv.rows > 0)
      : Boolean(hubspot && (hubspot.dialable ?? 0) > 0),
    Boolean(agent),
    !hoursOn || (days.length > 0 && from < to),
    true,
    true,
  ];
  const why = [
    source === "csv"
      ? missingPhone
        ? "The CSV needs a phone_number column."
        : "Choose a CSV to continue."
      : "Connect HubSpot and pick contacts with phone numbers.",
    "Choose an agent.",
    "Pick at least one day, with the end time after the start.",
    "",
    "",
  ];

  const agentName = agents.find((a) => a.id === agent)?.name ?? "–";
  const fromName = telephony.find((t) => t.id === config)?.name ?? "No number";
  const waitLabel =
    WAITS.find((w) => w.s === wait)?.label ?? `${Math.round(wait / 60)} min`;
  const leadsLabel =
    source === "csv" ? (file?.name ?? "CSV") : (hubspot?.label ?? "HubSpot");

  const go = (to: number) => {
    setDir(to > step ? 1 : -1);
    setStep(to);
    setReached((r) => Math.max(r, to));
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  async function create() {
    setBusy(true);
    setError(null);
    let sourceId: string;
    if (source === "csv") {
      const presign = await getPresignedUploadUrlApiV1S3PresignedUploadUrlPost({
        body: {
          file_name: file!.name,
          file_size: file!.size,
          content_type: "text/csv",
        },
      }).catch(() => null);
      if (!presign?.data) {
        setBusy(false);
        return setError(
          apiError(presign?.error, "Couldn't prepare the upload."),
        );
      }
      const put = await fetch(presign.data.upload_url, {
        method: "PUT",
        body: file!,
        headers: { "content-type": "text/csv" },
      }).catch(() => null);
      if (!put?.ok) {
        setBusy(false);
        return setError(
          "Upload failed. Check that file storage (MinIO) is reachable from your browser.",
        );
      }
      sourceId = presign.data.file_key;
    } else {
      sourceId = JSON.stringify(hubspot!.config);
    }

    const res = await createCampaignApiV1CampaignCreatePost({
      body: {
        name: name.trim() || (source === "csv" ? file!.name : hubspot!.label),
        workflow_id: agent as number,
        source_type: source,
        source_id: sourceId,
        telephony_configuration_id: config || null,
        max_concurrency: concurrency,
        retry_config: {
          enabled: attempts > 1,
          max_retries: Math.max(0, attempts - 1),
          retry_delay_seconds: wait,
          ...when,
        },
        schedule_config: hoursOn
          ? {
              enabled: true,
              timezone: tz,
              slots: days.map((d) => ({
                day_of_week: d,
                start_time: from,
                end_time: to,
              })),
            }
          : null,
      },
    }).catch(() => null);
    setBusy(false);
    if (!res?.data)
      return setError(apiError(res?.error, "Couldn't create the campaign."));
    router.push(`/campaigns/${res.data.id}`);
    router.refresh();
  }

  const titles = [
    {
      title: "Who should we call?",
      sub: "Bring your leads from a CSV file or straight from HubSpot.",
    },
    {
      title: "Which agent makes the calls?",
      sub: "Pick the agent and the number it calls from.",
    },
    {
      title: "When should calls go out?",
      sub: "Calls pause outside these hours and continue on their own.",
    },
    {
      title: "What if nobody picks up?",
      sub: "Try again later, and control how many calls run at once.",
    },
    {
      title: "Review and create",
      sub: "Check everything. Nothing is dialed until you start the campaign.",
    },
  ];

  const nav = (
    <div className="flex items-center gap-2">
      {!valid[step] ? (
        <span className="hidden max-w-[260px] truncate text-[12.5px] text-muted-foreground xl:inline">
          {why[step]}
        </span>
      ) : null}
      {step > 0 ? (
        <button
          type="button"
          onClick={() => go(step - 1)}
          className={btn("secondary", "md", "h-9")}
        >
          <ArrowLeft className="size-4" /> Back
        </button>
      ) : null}
      {step < STEPS.length - 1 ? (
        <button
          type="button"
          onClick={() => go(step + 1)}
          disabled={!valid[step]}
          className={btn("primary", "md", "h-9 px-4")}
          title={valid[step] ? undefined : why[step]}
        >
          Continue <ArrowRight className="size-4" />
        </button>
      ) : (
        <button
          type="button"
          onClick={create}
          disabled={busy || !valid.every(Boolean)}
          className={btn("primary", "md", "h-9 px-4")}
        >
          {busy ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <Check className="size-4" />
          )}
          {busy
            ? source === "hubspot"
              ? "Checking contacts…"
              : "Creating…"
            : "Create campaign"}
        </button>
      )}
    </div>
  );

  return (
    <div className="flex h-[calc(100svh-3.5rem)] flex-col md:h-svh">
      {/* Top bar: where you are, progress, and the way forward */}
      <header className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b px-5 py-3 sm:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href="/campaigns"
            aria-label="Back to campaigns"
            className="flex size-8 shrink-0 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-[15px] font-semibold text-foreground">
              New campaign
            </h1>
            <p className="text-[12px] text-muted-foreground">
              Step {step + 1} of {STEPS.length}
            </p>
          </div>
        </div>
        <ol className="order-3 flex w-full items-center gap-1.5 lg:order-none lg:w-auto lg:flex-1 lg:justify-center">
          {STEPS.map((label, i) => {
            const done = i < step || (i <= reached && i !== step && valid[i]);
            const current = i === step;
            const clickable = i <= reached && i !== step;
            return (
              <li key={label} className="min-w-0 flex-1 lg:max-w-[130px]">
                <button
                  type="button"
                  disabled={!clickable}
                  onClick={() => go(i)}
                  className="group w-full text-left disabled:cursor-default"
                >
                  <span
                    className={`block h-1 rounded-full transition-colors ${current || done ? "bg-foreground" : "bg-muted"}`}
                  />
                  <span
                    className={`mt-1 flex items-center gap-1 truncate text-[12px] ${current ? "font-semibold text-foreground" : done ? "text-foreground/80 group-hover:underline" : "text-muted-foreground"}`}
                  >
                    {done ? <Check className="size-3 shrink-0" /> : null}
                    {label}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <div className="ml-auto">{nav}</div>
      </header>

      {/* The step itself: no box, one screen */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex h-full w-full max-w-[860px] flex-col px-5 py-6 sm:px-8 lg:py-8">
          <div className="mb-5">
            <h2 className="text-[22px] font-semibold tracking-tight text-foreground">
              {titles[step].title}
            </h2>
            <p className="mt-1 text-[14px] text-muted-foreground">
              {titles[step].sub}
            </p>
          </div>
          <AnimatePresence mode="wait" initial={false} custom={dir}>
            <motion.div
              key={step}
              custom={dir}
              initial={{ opacity: 0, x: dir * 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: dir * -24 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              className="pb-4"
            >
              {step === 0 ? (
                <div className="space-y-5">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Option
                      on={source === "csv"}
                      onClick={() => setSource("csv")}
                      title="Upload a CSV"
                      body="A spreadsheet with a phone_number column."
                      icon={
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50">
                          <FileSpreadsheet className="size-4.5 text-emerald-700" />
                        </span>
                      }
                    />
                    <Option
                      on={source === "hubspot"}
                      onClick={() => setSource("hubspot")}
                      title="HubSpot"
                      body="Call a HubSpot list or all contacts."
                      icon={
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#ff7a59] text-[14px] font-bold text-white">
                          H
                        </span>
                      }
                    />
                  </div>

                  {source === "csv" ? (
                    <>
                      <input
                        ref={fileInput}
                        type="file"
                        accept=".csv,text/csv"
                        className="hidden"
                        onChange={(e) => pick(e.target.files?.[0] ?? null)}
                      />
                      {file && csv ? (
                        <div className="rounded-xl border bg-muted/30 p-4">
                          <div className="flex items-center gap-3">
                            <FileSpreadsheet className="size-5 text-emerald-700" />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[14px] font-medium text-foreground">
                                {file.name}
                              </span>
                              <span className="text-[12.5px] text-muted-foreground">
                                {csv.rows.toLocaleString("en-IN")} contacts ·{" "}
                                {csv.headers.length} columns
                              </span>
                            </span>
                            <button
                              type="button"
                              onClick={() => pick(null)}
                              aria-label="Remove file"
                              className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-red-600"
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {csv.headers.map((h) => (
                              <code
                                key={h}
                                className={`rounded-md border px-1.5 py-0.5 font-mono text-[12px] ${h.toLowerCase() === "phone_number" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "bg-background text-foreground/80"}`}
                              >
                                {h}
                              </code>
                            ))}
                          </div>
                          {missingPhone ? (
                            <p className="mt-3 text-[13px] text-red-600">
                              No phone_number column found. Rename your phone
                              column to phone_number.
                            </p>
                          ) : null}
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
                          className="flex w-full flex-col items-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors hover:bg-accent/50"
                        >
                          <Upload className="size-6 text-muted-foreground" />
                          <span className="mt-3 text-[14.5px] font-medium text-foreground">
                            Drop a CSV here, or click to choose
                          </span>
                          <span className="mt-1 text-[12.5px] text-muted-foreground">
                            Phone numbers in a{" "}
                            <code className="font-mono">phone_number</code>{" "}
                            column, like +919876543210. Other columns become
                            variables.
                          </span>
                        </button>
                      )}
                    </>
                  ) : (
                    <HubSpotSource
                      onChange={setHubspot}
                      justConnected={hubspotResult === "connected"}
                    />
                  )}
                  {source === "hubspot" &&
                  hubspotResult &&
                  hubspotResult !== "connected" ? (
                    <p className="text-[13px] text-destructive">
                      {hubspotResult === "denied"
                        ? "HubSpot access wasn't approved."
                        : "HubSpot sign-in failed. Try again."}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {step === 1 ? (
                <div className="space-y-6">
                  <div>
                    <Label hint="It uses the agent's published version.">
                      Agent
                    </Label>
                    {agents.length ? (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {agents.map((a) => (
                          <Option
                            key={a.id}
                            on={agent === a.id}
                            onClick={() => setAgent(a.id)}
                            title={a.name}
                            body={`Agent #${a.id}`}
                            icon={
                              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-[13px] font-semibold text-foreground uppercase">
                                {a.name.charAt(0)}
                              </span>
                            }
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="text-[13.5px] text-muted-foreground">
                        No agents yet.{" "}
                        <Link
                          href="/agents"
                          className="font-medium text-foreground underline underline-offset-4"
                        >
                          Create one first
                        </Link>
                        .
                      </p>
                    )}
                  </div>
                  <div>
                    <Label hint="Calls rotate across this provider's caller IDs.">
                      Call from
                    </Label>
                    {telephony.length ? (
                      <select
                        value={config}
                        onChange={(e) => setConfig(Number(e.target.value))}
                        className={`${inputCls} h-11`}
                      >
                        {telephony.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                            {t.isDefault ? " (default)" : ""}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <p className="text-[13.5px] text-muted-foreground">
                        <Link
                          href="/phone-numbers"
                          className="font-medium text-foreground underline underline-offset-4"
                        >
                          Connect a phone provider
                        </Link>{" "}
                        to place calls.
                      </p>
                    )}
                  </div>
                </div>
              ) : null}

              {step === 2 ? (
                <div className="space-y-6">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Option
                      on={hoursOn}
                      onClick={() => setHoursOn(true)}
                      title="Set calling hours"
                      body="Recommended. Calls only go out in these hours."
                      icon={null}
                    />
                    <Option
                      on={!hoursOn}
                      onClick={() => setHoursOn(false)}
                      title="Call anytime"
                      body="Calls start as soon as you launch, at any hour."
                      icon={null}
                    />
                  </div>
                  {hoursOn ? (
                    <>
                      <div>
                        <Label>Quick pick</Label>
                        <div className="flex flex-wrap gap-2">
                          {HOUR_PRESETS.map((p) => (
                            <Pill
                              key={p.label}
                              on={
                                p.from === from &&
                                p.to === to &&
                                p.days.length === days.length &&
                                p.days.every((d) => days.includes(d))
                              }
                              onClick={() => (
                                setDays(p.days),
                                setFrom(p.from),
                                setTo(p.to)
                              )}
                            >
                              {p.label}
                            </Pill>
                          ))}
                        </div>
                      </div>
                      <div>
                        <Label>Days</Label>
                        <div className="flex flex-wrap gap-2">
                          {DAYS.map((d, i) => (
                            <button
                              key={d}
                              type="button"
                              aria-pressed={days.includes(i)}
                              onClick={() =>
                                setDays(
                                  days.includes(i)
                                    ? days.filter((x) => x !== i)
                                    : [...days, i].sort(),
                                )
                              }
                              className={`size-11 rounded-full border text-[13px] font-medium transition-colors ${days.includes(i) ? "border-foreground bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-accent"}`}
                            >
                              {d.slice(0, 2)}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="grid gap-4 sm:grid-cols-3">
                        <label className="block">
                          <span className="mb-2 block text-[14px] font-medium text-foreground">
                            From
                          </span>
                          <input
                            type="time"
                            value={from}
                            onChange={(e) => setFrom(e.target.value)}
                            className={`${inputCls} h-11`}
                          />
                        </label>
                        <label className="block">
                          <span className="mb-2 block text-[14px] font-medium text-foreground">
                            Until
                          </span>
                          <input
                            type="time"
                            value={to}
                            onChange={(e) => setTo(e.target.value)}
                            className={`${inputCls} h-11`}
                          />
                        </label>
                        <label className="block">
                          <span className="mb-2 block text-[14px] font-medium text-foreground">
                            Timezone
                          </span>
                          <select
                            value={tz}
                            onChange={(e) => setTz(e.target.value)}
                            className={`${inputCls} h-11`}
                          >
                            {[...new Set([tz, ...TIMEZONES])].map((z) => (
                              <option key={z} value={z}>
                                {z.replace(/_/g, " ")}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <p className="text-[12.5px] text-muted-foreground">
                        In India, TRAI allows promotional calls between 9 AM and
                        9 PM.
                      </p>
                    </>
                  ) : null}
                </div>
              ) : null}

              {step === 3 ? (
                <div className="space-y-7">
                  <div>
                    <Label hint="Including the first call.">
                      Calls per contact
                    </Label>
                    <div className="flex flex-wrap gap-2">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Pill
                          key={n}
                          on={attempts === n}
                          onClick={() => setAttempts(n)}
                        >
                          {n === 1 ? "Just once" : `Up to ${n}`}
                        </Pill>
                      ))}
                    </div>
                  </div>
                  {attempts > 1 ? (
                    <>
                      <div>
                        <Label>Wait before trying again</Label>
                        <div className="flex flex-wrap gap-2">
                          {WAITS.map((w) => (
                            <Pill
                              key={w.s}
                              on={wait === w.s}
                              onClick={() => setWait(w.s)}
                            >
                              {w.label}
                            </Pill>
                          ))}
                        </div>
                      </div>
                      <div>
                        <Label>Try again when the call</Label>
                        <div className="flex flex-wrap gap-2">
                          {(
                            [
                              ["retry_on_no_answer", "isn't answered"],
                              ["retry_on_busy", "is busy"],
                              ["retry_on_voicemail", "reaches voicemail"],
                            ] as const
                          ).map(([k, label]) => (
                            <Pill
                              key={k}
                              on={when[k]}
                              onClick={() =>
                                setWhen({ ...when, [k]: !when[k] })
                              }
                            >
                              {when[k] ? (
                                <Check className="mr-1.5 inline size-3.5" />
                              ) : null}
                              {label}
                            </Pill>
                          ))}
                        </div>
                      </div>
                    </>
                  ) : null}
                  <div className="rounded-xl bg-muted/50 p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-[14px] font-medium text-foreground">
                        Calls at the same time
                      </p>
                      <span className="rounded-md bg-background px-2.5 py-0.5 text-[14px] font-semibold text-foreground tabular-nums shadow-xs">
                        {concurrency}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={Math.max(1, concurrencyLimit)}
                      value={concurrency}
                      onChange={(e) => setConcurrency(Number(e.target.value))}
                      className="mt-3 w-full accent-foreground"
                      aria-label="Calls at the same time"
                    />
                    <p className="mt-1 text-[12.5px] text-muted-foreground">
                      Up to {concurrencyLimit} on your plan. Start low and raise
                      it once calls go well.
                    </p>
                  </div>
                </div>
              ) : null}

              {step === 4 ? (
                <div className="space-y-5">
                  <div>
                    <label
                      htmlFor="c-name"
                      className="mb-2 block text-[14px] font-medium text-foreground"
                    >
                      Campaign name
                    </label>
                    <input
                      id="c-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="March EMI reminders"
                      className={`${inputCls} h-11 text-[15px]`}
                      autoFocus
                    />
                  </div>
                  <ul className="divide-y rounded-xl border">
                    {[
                      {
                        step: 0,
                        label: "Leads",
                        value: `${leadCount.toLocaleString("en-IN")} ${leadCount === 1 ? "contact" : "contacts"} · ${leadsLabel}`,
                      },
                      {
                        step: 1,
                        label: "Agent",
                        value: `${agentName} · from ${fromName}`,
                      },
                      {
                        step: 2,
                        label: "Schedule",
                        value: hoursOn
                          ? `${dayRange(days)}, ${time12(from)}–${time12(to)} (${tz.replace(/_/g, " ")})`
                          : "Anytime",
                      },
                      {
                        step: 3,
                        label: "Retries",
                        value: `${attempts > 1 ? `Up to ${attempts} calls, ${waitLabel} apart` : "One call each"} · ${concurrency} at a time`,
                      },
                    ].map((r) => (
                      <li
                        key={r.label}
                        className="flex items-center gap-4 px-4 py-3.5"
                      >
                        <span className="w-20 shrink-0 text-[13px] text-muted-foreground">
                          {r.label}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-foreground">
                          {r.value}
                        </span>
                        <button
                          type="button"
                          onClick={() => go(r.step)}
                          aria-label={`Edit ${r.label}`}
                          className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                  {error ? <ErrorNote>{error}</ErrorNote> : null}
                </div>
              ) : null}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
