import type { Metadata } from "next";

import {
  getModelConfigurationV2DefaultsApiV1OrganizationsModelConfigurationsV2DefaultsGet,
  getModelConfigurationV2ApiV1OrganizationsModelConfigurationsV2Get,
} from "@/client";
import { PageBody, PageHeader } from "@/components/app/PageHeader";
import type { Defaults, ModelConfigV2 } from "@/lib/models";
import { authHeaders, ensureAuthorized } from "@/lib/server-api";

import { ModelsForm } from "./ModelsForm";

export const metadata: Metadata = { title: "Model providers | Awaz" };

export default async function ModelsPage() {
  const headers = await authHeaders();
  const [model, defaults] = await Promise.all([
    getModelConfigurationV2ApiV1OrganizationsModelConfigurationsV2Get({ headers }),
    getModelConfigurationV2DefaultsApiV1OrganizationsModelConfigurationsV2DefaultsGet({ headers }),
  ]);
  ensureAuthorized(model);
  return (
    <>
      <PageHeader
        title="Model providers"
        sub="The speech-to-text, LLM and voice every agent uses unless it has its own. Keys are stored encrypted."
        back={{ href: "/integrations", label: "Integrations" }}
      />
      <PageBody className="max-w-[920px]">
        <ModelsForm initial={(model.data?.configuration ?? null) as ModelConfigV2 | null} defaults={defaults.data as Defaults} />
      </PageBody>
    </>
  );
}
