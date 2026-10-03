import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { SESSION_COOKIE } from "@/lib/session";

/**
 * Auth headers for calling the Dograh API from server components. Sends the
 * visitor to /login when there is no session.
 */
export async function authHeaders() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) redirect("/login");
  return { Authorization: `Bearer ${token}` };
}

/**
 * A 401 means the stored token is no longer valid (expired, or the backend's
 * secret changed). Server components can't clear cookies, so hand off to the
 * /logout route, which does.
 */
export function ensureAuthorized(res: { response?: Response } | null | undefined) {
  if (res?.response?.status === 401) redirect("/logout");
}
