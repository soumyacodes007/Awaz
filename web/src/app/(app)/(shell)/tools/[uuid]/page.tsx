import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getToolApiV1ToolsToolUuidGet, listCredentialsApiV1CredentialsGet, listRecordingsApiV1WorkflowRecordingsGet } from "@/client";
import { PageBody, PageHeader } from "@/components/app/PageHeader";
import { authHeaders, ensureAuthorized } from "@/lib/server-api";
import { TOOL_KINDS, type ToolKind } from "@/lib/tools";

import { ToolForm } from "../ToolForm";

export const metadata: Metadata = { title: "Tool | Awaz" };

export default async function ToolPage({ params }: { params: Promise<{ uuid: string }> }) {
  const { uuid } = await params;
  const headers = await authHeaders();
  const [tool, creds, clips] = await Promise.all([
    getToolApiV1ToolsToolUuidGet({ headers, path: { tool_uuid: uuid } }),
    listCredentialsApiV1CredentialsGet({ headers }),
    listRecordingsApiV1WorkflowRecordingsGet({ headers }),
  ]);
  ensureAuthorized(tool);
  const t = tool.data;
  if (!t) notFound();
  const kind = t.category as ToolKind;
  if (!(kind in TOOL_KINDS)) {
    return (
      <>
        <PageHeader title={t.name} sub="This tool type can't be edited here yet." back={{ href: "/tools", label: "Tools" }} />
      </>
    );
  }

  return (
    <>
      <PageHeader title={t.name} sub={TOOL_KINDS[kind].label} back={{ href: "/tools", label: "Tools" }} />
      <PageBody className="max-w-[880px]">
        <ToolForm
          init={{
            uuid: t.tool_uuid,
            kind,
            name: t.name,
            description: t.description ?? "",
            config: ((t.definition as { config?: Record<string, unknown> }).config ?? {}) as Record<string, unknown>,
          }}
          credentials={(creds.data ?? []).map((c) => ({ uuid: c.uuid, name: c.name }))}
          clips={(clips.data?.recordings ?? []).map((r) => ({ id: r.recording_id, transcript: r.transcript }))}
        />
      </PageBody>
    </>
  );
}
