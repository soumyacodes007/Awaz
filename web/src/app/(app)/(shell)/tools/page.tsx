import { ChevronRight, Plus, Wrench } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { listToolsApiV1ToolsGet } from "@/client";
import { PageBody, PageHeader } from "@/components/app/PageHeader";
import { Badge, btn, Card, EmptyState, Table, td, th, tr } from "@/components/app/ui";
import { ago } from "@/lib/format";
import { authHeaders, ensureAuthorized } from "@/lib/server-api";
import { TOOL_KINDS, type ToolKind } from "@/lib/tools";

export const metadata: Metadata = { title: "Tools | Awaz" };

export default async function ToolsPage() {
  const res = await listToolsApiV1ToolsGet({ headers: await authHeaders(), query: { status: "active" } });
  ensureAuthorized(res);
  const tools = [...(res.data ?? [])].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader
        title="Tools"
        sub="Reusable actions your agents can take during calls. Attach them to agents from the agent's Tools tab."
        actions={
          <Link href="/tools/new" className={btn("primary")}>
            <Plus className="size-4" /> New tool
          </Link>
        }
      />
      <PageBody>
        {/* Kinds of tools, as quick-create cards */}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {(Object.keys(TOOL_KINDS) as ToolKind[]).map((k) => {
            const { label, icon: Icon, color, blurb } = TOOL_KINDS[k];
            return (
              <Link
                key={k}
                href={`/tools/new?kind=${k}`}
                className="group rounded-lg bg-white p-4 border transition"
              >
                <span className="flex size-9 items-center justify-center rounded-md bg-muted">
                  <Icon className="size-[18px]" style={{ color }} strokeWidth={1.75} />
                </span>
                <p className="mt-3 flex items-center gap-1 text-[14px] text-foreground">
                  {label}
                  <Plus className="size-3.5 text-muted-foreground/70 transition group-hover:text-foreground" />
                </p>
                <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{blurb}</p>
              </Link>
            );
          })}
        </div>

        <Card>
          {tools.length ? (
            <Table
              head={
                <tr>
                  <th className={th}>Tool</th>
                  <th className={th}>Type</th>
                  <th className={`${th} hidden md:table-cell`}>Updated</th>
                  <th className={`${th} w-10`} />
                </tr>
              }
            >
              {tools.map((t) => {
                const kind = TOOL_KINDS[t.category as ToolKind];
                const Icon = kind?.icon ?? Wrench;
                return (
                  <tr key={t.tool_uuid} className={`${tr} group`}>
                    <td className={td}>
                      <Link href={`/tools/${t.tool_uuid}`} className="flex items-center gap-3">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                          <Icon className="size-4" style={{ color: kind?.color ?? "#888" }} strokeWidth={1.75} />
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-foreground">{t.name}</span>
                          {t.description ? <span className="line-clamp-1 text-[12.5px] text-muted-foreground">{t.description}</span> : null}
                        </span>
                      </Link>
                    </td>
                    <td className={td}>
                      <Badge>{kind?.label ?? t.category}</Badge>
                    </td>
                    <td className={`${td} hidden text-muted-foreground md:table-cell`}>{ago(t.updated_at ?? t.created_at)}</td>
                    <td className={td}>
                      <Link href={`/tools/${t.tool_uuid}`} aria-label={`Edit ${t.name}`} className="text-muted-foreground/70 transition group-hover:text-foreground">
                        <ChevronRight className="size-4" />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </Table>
          ) : (
            <EmptyState icon={Wrench} title="No tools yet" body="Start with an End call tool so agents can hang up, then add transfers and API calls." />
          )}
        </Card>
      </PageBody>
    </>
  );
}
