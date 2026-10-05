// Session cookie shared by middleware (proxying/redirects) and the auth server
// actions. httpOnly: page scripts never see the token; middleware attaches it
// as the Authorization header when forwarding /api/v1/* to the backend.
export const SESSION_COOKIE = "awaz_session";

// Dograh's JWTs are long-lived; keep the cookie for 30 days.
export const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

/** Pages that require a signed-in user. Everything else is public. */
export const APP_PREFIXES = [
  "/dashboard",
  "/onboarding",
  "/agents",
  "/tools",
  "/phone-numbers",
  "/campaigns",
  "/resources",
  "/tests",
  "/simulations",
  "/logs",
  "/recordings",
  "/metrics",
  "/runs",
  "/api-keys",
  "/integrations",
  "/billing",
  "/settings",
  "/profile",
];

export function isAppPath(pathname: string) {
  return APP_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
