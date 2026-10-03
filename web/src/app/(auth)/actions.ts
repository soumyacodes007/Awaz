"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { loginApiV1AuthLoginPost, signupApiV1AuthSignupPost } from "@/client";
import { SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/session";

export type AuthState = { error?: string; email?: string; name?: string };

// FastAPI errors arrive as { detail: string } or a list of validation errors
// ({ loc: ["body", field], msg }). Validation messages are verbose, so map
// them to short, field-level copy.
function message(error: unknown, fallback: string) {
  const detail = (error as { detail?: unknown } | undefined)?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail.length) {
    const field = detail[0]?.loc?.at?.(-1);
    if (field === "email") return "Enter a valid email address.";
    if (field === "password") return "Enter a valid password.";
    if (detail[0]?.msg) return String(detail[0].msg);
  }
  return fallback;
}

async function startSession(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

// Only follow same-site relative paths after login (no open redirects).
function safeNext(value: FormDataEntryValue | null) {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
}

export async function login(_: AuthState, form: FormData): Promise<AuthState> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password.", email };

  const res = await loginApiV1AuthLoginPost({ body: { email, password } }).catch(() => null);
  if (!res) return { error: "Can't reach the Awaz server. Is the API running?", email };
  if (res.error || !res.data) return { error: message(res.error, "Invalid email or password."), email };

  await startSession(res.data.token);
  redirect(safeNext(form.get("next")));
}

export async function signup(_: AuthState, form: FormData): Promise<AuthState> {
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and a password.", email, name };
  if (password.length < 8) return { error: "Use at least 8 characters for your password.", email, name };

  const res = await signupApiV1AuthSignupPost({ body: { email, password, name: name || null } }).catch(() => null);
  if (!res) return { error: "Can't reach the Awaz server. Is the API running?", email, name };
  if (res.error || !res.data) return { error: message(res.error, "Couldn't create your account."), email, name };

  await startSession(res.data.token);
  redirect("/onboarding");
}

export async function logout() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}
