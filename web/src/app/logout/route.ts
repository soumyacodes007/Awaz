import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { SESSION_COOKIE } from "@/lib/session";

// Clears the session and returns to /login. Used for expired sessions, where
// server components can't modify cookies themselves.
export async function GET(req: Request) {
  (await cookies()).delete(SESSION_COOKIE);
  return NextResponse.redirect(new URL("/login", req.url));
}
