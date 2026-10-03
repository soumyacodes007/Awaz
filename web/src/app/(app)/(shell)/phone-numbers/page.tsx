import type { Metadata } from "next";

import {
  getTelephonyProvidersMetadataApiV1OrganizationsTelephonyProvidersMetadataGet,
  getWorkflowsApiV1WorkflowFetchGet,
  listPhoneNumbersApiV1OrganizationsTelephonyConfigsConfigIdPhoneNumbersGet,
  listTelephonyConfigurationsApiV1OrganizationsTelephonyConfigsGet,
} from "@/client";
import { authHeaders, ensureAuthorized } from "@/lib/server-api";

import { PhoneNumbersView } from "./PhoneNumbersView";

export const metadata: Metadata = { title: "Phone numbers | Awaz" };

export default async function PhoneNumbersPage() {
  const headers = await authHeaders();
  const [configs, meta, agents] = await Promise.all([
    listTelephonyConfigurationsApiV1OrganizationsTelephonyConfigsGet({ headers }),
    getTelephonyProvidersMetadataApiV1OrganizationsTelephonyProvidersMetadataGet({ headers }),
    getWorkflowsApiV1WorkflowFetchGet({ headers, query: { status: "active" } }),
  ]);
  ensureAuthorized(configs);
  const providers = configs.data?.configurations ?? [];

  const numbers = (
    await Promise.all(
      providers.map((c) =>
        listPhoneNumbersApiV1OrganizationsTelephonyConfigsConfigIdPhoneNumbersGet({ headers, path: { config_id: c.id } }).then((r) =>
          (r.data?.phone_numbers ?? []).map((n) => ({ ...n, providerName: c.name, provider: c.provider })),
        ),
      ),
    )
  ).flat();

  return (
    <PhoneNumbersView
      providers={providers}
      numbers={numbers}
      metadata={meta.data?.providers ?? []}
      agents={(agents.data ?? []).map((a) => ({ id: a.id, name: a.name }))}
    />
  );
}
