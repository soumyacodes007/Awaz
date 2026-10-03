import { ChevronRight, Megaphone, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { getCampaignsApiV1CampaignGet } from "@/client";
import { PageBody, PageHeader } from "@/components/app/PageHeader";
import { btn, Card, EmptyState, Table, td, th, tr } from "@/components/app/ui";
import { ago, num } from "@/lib/format";
import { authHeaders, ensureAuthorized } from "@/lib/server-api";

import { CampaignState, Progress } from "./parts";

export const metadata: Metadata = { title: "Campaigns | Awaz" };

export default async function CampaignsPage() {
  const res = await getCampaignsApiV1CampaignGet({ headers: await authHeaders() });
  ensureAuthorized(res);
  const campaigns = [...(res.data?.campaigns ?? [])].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));

  return (
    <>
      <PageHeader
        title="Campaigns"
        sub="Call a whole list of people with one agent, with retries and calling hours."
        actions={
          <Link href="/campaigns/new" className={btn("primary")}>
            <Plus className="size-4" /> New campaign
          </Link>
        }
      />
      <PageBody>
        <Card>
          {campaigns.length ? (
            <Table
              head={
                <tr>
                  <th className={th}>Campaign</th>
                  <th className={th}>Status</th>
                  <th className={`${th} w-[28%]`}>Progress</th>
                  <th className={`${th} hidden md:table-cell`}>Created</th>
                  <th className={`${th} w-10`} />
                </tr>
              }
            >
              {campaigns.map((c) => (
                <tr key={c.id} className={`${tr} group`}>
                  <td className={td}>
                    <Link href={`/campaigns/${c.id}`} className="block">
                      <span className="block text-foreground">{c.name}</span>
                      <span className="text-[12px] text-muted-foreground">{c.workflow_name}</span>
                    </Link>
                  </td>
                  <td className={td}>
                    <CampaignState state={c.state} />
                  </td>
                  <td className={td}>
                    <Progress done={c.processed_rows} total={c.total_rows ?? 0} failed={c.failed_rows} />
                    <span className="mt-1 block text-[12px] text-muted-foreground">
                      {num(c.processed_rows)} of {num(c.total_rows ?? 0)} called
                    </span>
                  </td>
                  <td className={`${td} hidden text-muted-foreground md:table-cell`}>{ago(c.created_at)}</td>
                  <td className={td}>
                    <Link href={`/campaigns/${c.id}`} aria-label={`Open ${c.name}`} className="text-muted-foreground/70 transition group-hover:text-foreground">
                      <ChevronRight className="size-4" />
                    </Link>
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <EmptyState
              icon={Megaphone}
              title="No campaigns yet"
              body="Upload a CSV of phone numbers and pick an agent. Every column becomes a variable the agent can use, like {{first_name}}."
              action={
                <Link href="/campaigns/new" className={btn("primary")}>
                  <Plus className="size-4" /> New campaign
                </Link>
              }
            />
          )}
        </Card>
      </PageBody>
    </>
  );
}
