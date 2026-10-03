import type { Metadata } from "next";

import {
  getBillingCreditsApiV1OrganizationsBillingCreditsGet,
  getCurrentPeriodUsageApiV1OrganizationsUsageCurrentPeriodGet,
  getDailyUsageBreakdownApiV1OrganizationsUsageDailyBreakdownGet,
  getModelConfigurationV2ApiV1OrganizationsModelConfigurationsV2Get,
} from "@/client";
import { PageBody, PageHeader } from "@/components/app/PageHeader";
import { Card, CardHeader, Stat, Table, td, th, tr } from "@/components/app/ui";
import { dateTime, longDate, num, usd } from "@/lib/format";
import { authHeaders, ensureAuthorized } from "@/lib/server-api";

import { BuyCredits } from "./BuyCredits";

export const metadata: Metadata = { title: "Billing & usage | Awaz" };

export default async function BillingPage() {
  const headers = await authHeaders();
  const [usage, credits, model, daily] = await Promise.all([
    getCurrentPeriodUsageApiV1OrganizationsUsageCurrentPeriodGet({ headers }),
    getBillingCreditsApiV1OrganizationsBillingCreditsGet({ headers }),
    getModelConfigurationV2ApiV1OrganizationsModelConfigurationsV2Get({ headers }),
    getDailyUsageBreakdownApiV1OrganizationsUsageDailyBreakdownGet({ headers }),
  ]);
  ensureAuthorized(usage);
  const u = usage.data;
  const c = credits.data;
  const managed = (model.data?.configuration as { mode?: string } | null)?.mode === "dograh";
  const remaining = c?.remaining_credits ?? 0;
  const quota = c?.total_quota ?? 0;
  const perMinute = u?.price_per_second_usd != null ? u.price_per_second_usd * 60 : null;

  return (
    <>
      <PageHeader title="Billing & usage" sub={u ? `Current period: ${longDate(u.period_start)} to ${longDate(u.period_end)}` : undefined} />
      <PageBody className="max-w-[1080px]">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Talk time this period" value={`${num(Math.round((u?.total_duration_seconds ?? 0) / 60))} min`} />
          <Stat label="Spend this period" value={u?.used_amount_usd != null ? usd(u.used_amount_usd) : "–"} note={u?.used_amount_usd == null ? "Self-hosted: you pay providers directly" : u.currency ?? undefined} />
          <Stat label="Price per minute" value={perMinute != null ? usd(perMinute, 3) : "–"} />
          <Stat label="Model credits left" value={managed ? num(Math.round(remaining)) : "–"} note={managed ? `of ${num(Math.round(quota))}` : "Only for Dograh-managed models"} />
        </div>

        {managed ? (
          <Card>
            <CardHeader title="Model credits" sub="Credits pay for Dograh's hosted speech and LLM models. Bring your own keys in Integrations to skip them." actions={<BuyCredits />} />
            <div className="p-5">
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${quota ? Math.min(100, (remaining / quota) * 100) : 0}%` }} />
              </div>
              <p className="mt-2 text-[12.5px] text-muted-foreground">
                {num(Math.round(c?.total_credits_used ?? 0))} used · {num(Math.round(remaining))} remaining
              </p>
            </div>
            {c?.ledger_entries?.length ? (
              <Table
                head={
                  <tr>
                    <th className={th}>Date</th>
                    <th className={th}>Entry</th>
                    <th className={`${th} text-right`}>Credits</th>
                    <th className={`${th} text-right`}>Balance</th>
                  </tr>
                }
              >
                {c.ledger_entries.slice(0, 20).map((e) => (
                  <tr key={e.id} className={tr}>
                    <td className={`${td} text-muted-foreground`}>{dateTime(e.created_at)}</td>
                    <td className={td}>{e.metric_code ?? e.entry_type}</td>
                    <td className={`${td} text-right tabular-nums ${e.credits_delta < 0 ? "text-red-600" : "text-emerald-700"}`}>
                      {e.credits_delta > 0 ? "+" : ""}
                      {e.credits_delta.toFixed(2)}
                    </td>
                    <td className={`${td} text-right text-foreground/80 tabular-nums`}>{e.balance_after.toFixed(2)}</td>
                  </tr>
                ))}
              </Table>
            ) : null}
          </Card>
        ) : null}

        {daily.data?.breakdown.length ? (
          <Card>
            <CardHeader title="Daily usage" />
            <Table
              head={
                <tr>
                  <th className={th}>Day</th>
                  <th className={`${th} text-right`}>Calls</th>
                  <th className={`${th} text-right`}>Minutes</th>
                  <th className={`${th} text-right`}>Cost</th>
                </tr>
              }
            >
              {daily.data.breakdown.map((d) => (
                <tr key={d.date} className={tr}>
                  <td className={td}>{longDate(d.date)}</td>
                  <td className={`${td} text-right tabular-nums`}>{num(d.call_count)}</td>
                  <td className={`${td} text-right tabular-nums`}>{d.minutes.toFixed(1)}</td>
                  <td className={`${td} text-right tabular-nums`}>{usd(d.cost_usd)}</td>
                </tr>
              ))}
            </Table>
          </Card>
        ) : null}
      </PageBody>
    </>
  );
}
