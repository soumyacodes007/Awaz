import { redirect } from "next/navigation";

import {
  getCurrentPeriodUsageApiV1OrganizationsUsageCurrentPeriodGet,
  getCurrentUserApiV1AuthMeGet,
  getUserOnboardingStateApiV1UserOnboardingStateGet,
} from "@/client";
import { authHeaders, ensureAuthorized } from "@/lib/server-api";

import { Sidebar } from "./Sidebar";

// App chrome for signed-in pages. New accounts that haven't finished (or
// skipped) onboarding are sent there first.
export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const headers = await authHeaders();
  const [me, onboarding, usage] = await Promise.all([
    getCurrentUserApiV1AuthMeGet({ headers }),
    getUserOnboardingStateApiV1UserOnboardingStateGet({ headers }),
    getCurrentPeriodUsageApiV1OrganizationsUsageCurrentPeriodGet({ headers }),
  ]);
  ensureAuthorized(me);
  ensureAuthorized(onboarding);
  if (onboarding.data && !onboarding.data.completed_at && !onboarding.data.skipped) redirect("/onboarding");

  const minutes = usage.data ? Math.round(usage.data.total_duration_seconds / 60) : null;

  return (
    <div className="font-app min-h-svh bg-background text-foreground md:flex">
      <Sidebar email={me.data?.email ?? ""} minutes={minutes} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
