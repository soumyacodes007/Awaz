import type { Metadata } from "next";

import { getCurrentOrganizationContextApiV1OrganizationsContextGet, getPreferencesApiV1OrganizationsPreferencesGet } from "@/client";
import { PageBody, PageHeader } from "@/components/app/PageHeader";
import { authHeaders, ensureAuthorized } from "@/lib/server-api";

import { SettingsForm } from "./SettingsForm";

export const metadata: Metadata = { title: "Workspace settings | Awaz" };

export default async function SettingsPage() {
  const headers = await authHeaders();
  const [prefs, ctx] = await Promise.all([
    getPreferencesApiV1OrganizationsPreferencesGet({ headers }),
    getCurrentOrganizationContextApiV1OrganizationsContextGet({ headers }),
  ]);
  ensureAuthorized(prefs);
  return (
    <>
      <PageHeader title="Workspace settings" sub="Defaults that apply to every agent in this workspace." />
      <PageBody className="max-w-[880px]">
        <SettingsForm prefs={prefs.data ?? null} workspaceId={ctx.data?.organization_id ?? null} />
      </PageBody>
    </>
  );
}
