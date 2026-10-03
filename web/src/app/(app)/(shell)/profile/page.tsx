import { LogOut } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { logout } from "@/app/(auth)/actions";
import { getCurrentUserApiV1AuthMeGet } from "@/client";
import { PageBody, PageHeader } from "@/components/app/PageHeader";
import { btn, Card, CardHeader } from "@/components/app/ui";
import { authHeaders, ensureAuthorized } from "@/lib/server-api";

export const metadata: Metadata = { title: "Profile | Awaz" };

export default async function ProfilePage() {
  const me = await getCurrentUserApiV1AuthMeGet({ headers: await authHeaders() });
  ensureAuthorized(me);
  const u = me.data;
  const initial = (u?.name || u?.email || "?").charAt(0).toUpperCase();

  return (
    <>
      <PageHeader title="Profile" />
      <PageBody className="max-w-[720px]">
        <Card className="flex items-center gap-4 p-5">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary text-[22px] font-medium text-white">
            {initial}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[17px] text-foreground">{u?.name || u?.email}</p>
            {u?.name ? <p className="truncate text-[14px] text-muted-foreground">{u.email}</p> : null}
          </div>
        </Card>

        <Card>
          <CardHeader title="Account" />
          <dl className="space-y-3 p-5 text-[14px]">
            {[
              ["Email", u?.email ?? "–"],
              ["User ID", u?.id != null ? String(u.id) : "–"],
              ["Workspace ID", u?.organization_id != null ? String(u.organization_id) : "–"],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="text-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card>
          <CardHeader title="Shortcuts" />
          <div className="flex flex-wrap gap-2 p-5">
            <Link href="/api-keys" className={btn("secondary", "sm")}>
              API keys
            </Link>
            <Link href="/settings" className={btn("secondary", "sm")}>
              Workspace settings
            </Link>
            <Link href="/billing" className={btn("secondary", "sm")}>
              Billing & usage
            </Link>
          </div>
        </Card>

        <form action={logout}>
          <button type="submit" className={btn("danger")}>
            <LogOut className="size-4" /> Sign out
          </button>
        </form>
      </PageBody>
    </>
  );
}
