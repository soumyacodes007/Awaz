import type { Metadata } from "next";

import { getApiKeysApiV1UserApiKeysGet } from "@/client";
import { authHeaders, ensureAuthorized } from "@/lib/server-api";

import { ApiKeysView } from "./ApiKeysView";

export const metadata: Metadata = { title: "API keys | Awaz" };

export default async function ApiKeysPage() {
  const res = await getApiKeysApiV1UserApiKeysGet({ headers: await authHeaders(), query: { include_archived: true } });
  ensureAuthorized(res);
  return <ApiKeysView keys={res.data ?? []} />;
}
