import type { Metadata } from "next";

import { listDocumentsApiV1KnowledgeBaseDocumentsGet } from "@/client";
import { authHeaders, ensureAuthorized } from "@/lib/server-api";

import { KnowledgeView } from "./KnowledgeView";

export const metadata: Metadata = { title: "Knowledge base | Awaz" };

export default async function KnowledgePage() {
  const res = await listDocumentsApiV1KnowledgeBaseDocumentsGet({ headers: await authHeaders(), query: { limit: 200 } });
  ensureAuthorized(res);
  return <KnowledgeView documents={res.data?.documents ?? []} />;
}
