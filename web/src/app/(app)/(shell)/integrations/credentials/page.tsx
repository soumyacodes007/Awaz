import type { Metadata } from "next";

import { listCredentialsApiV1CredentialsGet } from "@/client";
import { authHeaders, ensureAuthorized } from "@/lib/server-api";

import { CredentialsView } from "./CredentialsView";

export const metadata: Metadata = { title: "Credentials | Awaz" };

export default async function CredentialsPage() {
  const res = await listCredentialsApiV1CredentialsGet({ headers: await authHeaders() });
  ensureAuthorized(res);
  return <CredentialsView credentials={res.data ?? []} />;
}
