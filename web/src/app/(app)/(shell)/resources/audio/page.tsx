import type { Metadata } from "next";

import { listRecordingsApiV1WorkflowRecordingsGet } from "@/client";
import { authHeaders, ensureAuthorized } from "@/lib/server-api";

import { AudioView } from "./AudioView";

export const metadata: Metadata = { title: "Audio clips | Awaz" };

export default async function AudioPage() {
  const res = await listRecordingsApiV1WorkflowRecordingsGet({ headers: await authHeaders() });
  ensureAuthorized(res);
  return <AudioView clips={res.data?.recordings ?? []} />;
}
