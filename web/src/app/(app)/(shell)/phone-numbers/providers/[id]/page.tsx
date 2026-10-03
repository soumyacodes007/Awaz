import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  getTelephonyConfigurationByIdApiV1OrganizationsTelephonyConfigsConfigIdGet,
  getTelephonyProvidersMetadataApiV1OrganizationsTelephonyProvidersMetadataGet,
} from "@/client";
import { authHeaders, ensureAuthorized } from "@/lib/server-api";

import { ProviderDetail } from "./ProviderDetail";

export const metadata: Metadata = { title: "Provider | Awaz" };

export default async function ProviderPage({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const headers = await authHeaders();
  const [cfg, meta] = await Promise.all([
    getTelephonyConfigurationByIdApiV1OrganizationsTelephonyConfigsConfigIdGet({ headers, path: { config_id: id } }),
    getTelephonyProvidersMetadataApiV1OrganizationsTelephonyProvidersMetadataGet({ headers }),
  ]);
  ensureAuthorized(cfg);
  if (!cfg.data) notFound();
  const providerMeta = meta.data?.providers.find((p) => p.provider === cfg.data!.provider) ?? null;
  return <ProviderDetail config={cfg.data} meta={providerMeta} />;
}
