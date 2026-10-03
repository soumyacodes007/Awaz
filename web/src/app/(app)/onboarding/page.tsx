import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getUserOnboardingStateApiV1UserOnboardingStateGet } from "@/client";
import { authHeaders, ensureAuthorized } from "@/lib/server-api";

import { OnboardingFlow } from "./OnboardingFlow";

export const metadata: Metadata = { title: "Set up Awaz" };

export default async function OnboardingPage() {
  const res = await getUserOnboardingStateApiV1UserOnboardingStateGet({ headers: await authHeaders() });
  ensureAuthorized(res);
  // Already done (or skipped): onboarding never re-opens.
  if (res.data?.completed_at || res.data?.skipped) redirect("/dashboard");

  return <OnboardingFlow />;
}
