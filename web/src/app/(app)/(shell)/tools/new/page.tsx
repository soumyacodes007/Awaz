import type { Metadata } from "next";
import Link from "next/link";

import { listCredentialsApiV1CredentialsGet, listRecordingsApiV1WorkflowRecordingsGet } from "@/client";
import { PageBody, PageHeader } from "@/components/app/PageHeader";
import { authHeaders } from "@/lib/server-api";
import { blankTool, TOOL_KINDS, type ToolKind } from "@/lib/tools";

import { ToolForm } from "../ToolForm";

export const metadata: Metadata = { title: "New tool | Awaz" };

export default async function NewToolPage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { kind: raw } = await searchParams;
  const kind = raw && raw in TOOL_KINDS ? (raw as ToolKind) : null;

  if (!kind) {
    return (
      <>
        <PageHeader title="New tool" sub="What should this tool do?" back={{ href: "/tools", label: "Tools" }} />
        <PageBody>
          <div className="grid max-w-[880px] gap-3 sm:grid-cols-2">
            {(Object.keys(TOOL_KINDS) as ToolKind[]).map((k) => {
              const { label, icon: Icon, color, blurb } = TOOL_KINDS[k];
              return (
                <Link key={k} href={`/tools/new?kind=${k}`} className="flex gap-3 rounded-lg bg-white p-4 border transition hover:border-foreground/25">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted">
                    <Icon className="size-5" style={{ color }} strokeWidth={1.75} />
                  </span>
                  <span>
                    <span className="block text-[14.5px] text-foreground">{label}</span>
                    <span className="mt-0.5 block text-[13px] text-muted-foreground">{blurb}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        </PageBody>
      </>
    );
  }

  const headers = await authHeaders();
  const [creds, clips] = await Promise.all([listCredentialsApiV1CredentialsGet({ headers }), listRecordingsApiV1WorkflowRecordingsGet({ headers })]);

  return (
    <>
      <PageHeader title="New tool" sub={`${TOOL_KINDS[kind].label}: ${TOOL_KINDS[kind].blurb}`} back={{ href: "/tools", label: "Tools" }} />
      <PageBody className="max-w-[880px]">
        <ToolForm
          init={blankTool(kind)}
          credentials={(creds.data ?? []).map((c) => ({ uuid: c.uuid, name: c.name }))}
          clips={(clips.data?.recordings ?? []).map((r) => ({ id: r.recording_id, transcript: r.transcript }))}
        />
      </PageBody>
    </>
  );
}
