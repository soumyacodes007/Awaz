import { type NextRequest, NextResponse } from "next/server";

import { isAppPath, SESSION_COOKIE } from "@/lib/session";

const BACKEND = (process.env.BACKEND_URL || "http://127.0.0.1:8000").replace(/\/+$/, "");

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const token = req.cookies.get(SESSION_COOKIE)?.value;

  // Same-origin API proxy: forward to the backend with the session token.
  if (pathname.startsWith("/api/v1/")) {
    const headers = new Headers(req.headers);
    if (token && !headers.has("authorization")) headers.set("authorization", `Bearer ${token}`);
    return NextResponse.rewrite(new URL(`${pathname}${search}`, BACKEND), { request: { headers } });
  }

  // Signed-out visitors can't reach app pages; signed-in ones skip auth pages.
  if (isAppPath(pathname) && !token) {
    const login = new URL("/login", req.url);
    login.searchParams.set("next", `${pathname}${search}`);
    return NextResponse.redirect(login);
  }
  if ((pathname === "/login" || pathname === "/signup") && token) {
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  return NextResponse.next();
}

// Matcher entries must be static, so this mirrors APP_PREFIXES in lib/session.
export const config = {
  matcher: [
    "/api/v1/:path*",
    "/login",
    "/signup",
    "/dashboard/:path*",
    "/onboarding/:path*",
    "/agents/:path*",
    "/tools/:path*",
    "/phone-numbers/:path*",
    "/campaigns/:path*",
    "/resources/:path*",
    "/evals/:path*",
    "/simulations/:path*",
    "/logs/:path*",
    "/recordings/:path*",
    "/metrics/:path*",
    "/runs/:path*",
    "/api-keys/:path*",
    "/integrations/:path*",
    "/billing/:path*",
    "/settings/:path*",
    "/profile/:path*",
  ],
};
