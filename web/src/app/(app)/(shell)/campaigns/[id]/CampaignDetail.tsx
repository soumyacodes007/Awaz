"use client";

import { Download, LoaderCircle, Pause, Play, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  downloadCampaignReportApiV1CampaignCampaignIdReportGet,
  pauseCampaignApiV1CampaignCampaignIdPausePost,
  redialCampaignApiV1CampaignCampaignIdRedialPost,
  resumeCampaignApiV1CampaignCampaignIdResumePost,
  startCampaignApiV1CampaignCampaignIdStartPost,
  type CampaignResponse,
} from "@/client";
import { PageBody, PageHeader } from "@/components/app/PageHeader";
import { Badge, btn, Card, CardHeader, ErrorNote, Stat, Table, td, th, tr } from "@/components/app/ui";
import { apiError } from "@/lib/errors";
import { dateTime, duration, humanize, num } from "@/lib/format";

import { CampaignState, Progress } from "../parts";

type Run = { id: number; createdAt: string; phone: string | null; name: string | null; duration: number | null; disposition: string | null; completed: boolean };

const LEVEL_TONE: Record<string, "red" | "amber" | "neutral"> = { error: "red", warning: "amber" };

export function CampaignDetail({ campaign: c, runs, totalRuns }: { campaign: CampaignResponse; runs: Run[]; totalRuns: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = c.state === "running" || c.state === "syncing";

  // Keep numbers fresh while calls are going out.
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(t);
  }, [live, router]);

  async function act(kind: "start" | "pause" | "resume" | "redial") {
    setBusy(kind);
    setError(null);
    const path = { campaign_id: c.id };
    const res =
      kind === "start"
        ? await startCampaignApiV1CampaignCampaignIdStartPost({ path }).catch(() => null)
        : kind === "pause"
          ? await pauseCampaignApiV1CampaignCampaignIdPausePost({ path }).catch(() => null)
          : kind === "resume"
            ? await resumeCampaignApiV1CampaignCampaignIdResumePost({ path }).catch(() => null)
            : await redialCampaignApiV1CampaignCampaignIdRedialPost({ path, body: { retry_on_busy: true, retry_on_no_answer: true, retry_on_voicemail: true } }).catch(() => null);
    setBusy(null);
    if (!res || res.error) return setError(apiError(res?.error, `Couldn't ${kind} the campaign.`));
    if (kind === "redial" && res.data && "id" in (res.data as object)) router.push(`/campaigns/${(res.data as { id: number }).id}`);
    router.refresh();
  }

  async function report() {
    setBusy("report");
    const res = await downloadCampaignReportApiV1CampaignCampaignIdReportGet({ path: { campaign_id: c.id }, parseAs: "blob" }).catch(() => null);
    setBusy(null);
    if (!res?.data) return setError(apiError(res?.error, "Couldn't download the report."));
    const url = URL.createObjectURL(res.data as Blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: `${c.name.replace(/\s+/g, "-")}-report.csv` });
    a.click();
    URL.revokeObjectURL(url);
  }

  const spin = (k: string) => (busy === k ? <LoaderCircle className="size-4 animate-spin" /> : null);

  return (
    <>
      <PageHeader
        title={c.name}
        sub={
          <span className="flex flex-wrap items-center gap-2">
            <CampaignState state={c.state} />
            <span>
              <Link href={`/agents/${c.workflow_id}`} className="hover:text-foreground hover:underline">
                {c.workflow_name}
              </Link>
              {c.telephony_configuration_name ? ` · ${c.telephony_configuration_name}` : ""}
            </span>
          </span>
        }
        back={{ href: "/campaigns", label: "Campaigns" }}
        actions={
          <>
            <button type="button" onClick={report} disabled={busy !== null} className={btn("secondary")}>
              {spin("report") ?? <Download className="size-4" />} Report
            </button>
            {c.state === "completed" && c.failed_rows > 0 ? (
              <button type="button" onClick={() => act("redial")} disabled={busy !== null} className={btn("secondary")}>
                {spin("redial") ?? <RotateCcw className="size-4" />} Redial unanswered
              </button>
            ) : null}
            {c.state === "created" ? (
              <button type="button" onClick={() => act("start")} disabled={busy !== null} className={btn("primary")}>
                {spin("start") ?? <Play className="size-4" />} Start calling
              </button>
            ) : null}
            {live ? (
              <button type="button" onClick={() => act("pause")} disabled={busy !== null} className={btn("secondary")}>
                {spin("pause") ?? <Pause className="size-4" />} Pause
              </button>
            ) : null}
            {c.state === "paused" ? (
              <button type="button" onClick={() => act("resume")} disabled={busy !== null} className={btn("primary")}>
                {spin("resume") ?? <Play className="size-4" />} Resume
              </button>
            ) : null}
          </>
        }
      />
      <PageBody>
        {error ? <ErrorNote>{error}</ErrorNote> : null}
        {c.warnings?.length ? (
          <div className="space-y-1 rounded-md bg-amber-50 px-4 py-3 text-[13px] text-amber-800 border border-amber-200">
            {c.warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </div>
        ) : null}

        <Card className="p-5">
          <div className="flex items-baseline justify-between">
            <p className="text-[13px] text-muted-foreground">Progress</p>
            <p className="text-[13px] text-muted-foreground">
              {num(c.processed_rows)} / {num(c.total_rows ?? 0)}
            </p>
          </div>
          <div className="mt-2">
            <Progress done={c.processed_rows} total={c.total_rows ?? 0} failed={c.failed_rows} />
          </div>
        </Card>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Contacts" value={num(c.total_rows ?? 0)} />
          <Stat label="Calls placed" value={num(c.executed_count ?? c.processed_rows)} />
          <Stat label="Failed" value={num(c.failed_rows)} />
          <Stat
            label="Settings"
            value={<span className="text-[18px]">{c.max_concurrency ?? "–"} at once</span>}
            note={c.retry_config.enabled ? `${c.retry_config.max_retries} retries, ${Math.round(c.retry_config.retry_delay_seconds / 60)} min apart` : "No retries"}
          />
        </div>

        <Card>
          <CardHeader title="Calls" sub={`${num(totalRuns)} so far`} />
          {runs.length ? (
            <Table
              head={
                <tr>
                  <th className={th}>Contact</th>
                  <th className={th}>Started</th>
                  <th className={th}>Duration</th>
                  <th className={th}>Outcome</th>
                </tr>
              }
            >
              {runs.map((r) => (
                <tr key={r.id} className={tr}>
                  <td className={td}>
                    <Link href={`/runs/${c.workflow_id}/${r.id}`} className="block hover:underline">
                      <span className="block font-mono text-[13px] text-foreground">{r.phone ?? `#${r.id}`}</span>
                      {r.name ? <span className="text-[12px] text-muted-foreground">{r.name}</span> : null}
                    </Link>
                  </td>
                  <td className={`${td} text-muted-foreground`}>{dateTime(r.createdAt)}</td>
                  <td className={`${td} tabular-nums text-muted-foreground`}>{duration(r.duration)}</td>
                  <td className={td}>{r.disposition ? <Badge>{humanize(r.disposition)}</Badge> : r.completed ? "–" : <Badge tone="blue">In progress</Badge>}</td>
                </tr>
              ))}
            </Table>
          ) : (
            <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">{c.state === "created" ? "Start the campaign to begin calling." : "No calls yet."}</p>
          )}
        </Card>

        {c.logs?.length ? (
          <Card>
            <CardHeader title="Activity" />
            <ul className="divide-y divide-border">
              {[...c.logs].reverse().slice(0, 30).map((l, i) => (
                <li key={i} className="flex gap-3 px-5 py-2.5 text-[13px]">
                  <span className="w-28 shrink-0 text-muted-foreground tabular-nums">{dateTime(l.ts)}</span>
                  {LEVEL_TONE[l.level] ? <Badge tone={LEVEL_TONE[l.level]}>{l.level}</Badge> : null}
                  <span className="text-foreground/80">{l.message}</span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </PageBody>
    </>
  );
}
