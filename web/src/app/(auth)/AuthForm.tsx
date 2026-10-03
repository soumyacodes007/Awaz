"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Field } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";

import { type AuthState, login, signup } from "./actions";

type Mode = "login" | "signup";

const copy = {
  login: {
    title: "Welcome back",
    sub: "Log in to your Awaz workspace.",
    submit: "Log in",
    pending: "Logging in…",
    switchText: "New to Awaz?",
    switchLink: { href: "/signup", label: "Create an account" },
  },
  signup: {
    title: "Create your account",
    sub: "Your first voice agent is a few minutes away.",
    submit: "Create account",
    pending: "Creating account…",
    switchText: "Already have an account?",
    switchLink: { href: "/login", label: "Log in" },
  },
} as const;

export function AuthForm({ mode, next }: { mode: Mode; next?: string }) {
  const [state, action] = useActionState<AuthState, FormData>(mode === "login" ? login : signup, {});
  const c = copy[mode];

  return (
    <div>
      <h1 className="font-display text-[30px] leading-tight font-[525] tracking-[-0.02em] text-[#1f1f1f]">{c.title}</h1>
      <p className="mt-2 text-[15px] text-[#666]">{c.sub}</p>

      <form action={action} className="mt-8 space-y-4" noValidate>
        {next ? <input type="hidden" name="next" value={next} /> : null}
        {mode === "signup" ? (
          <Field label="Name" name="name" autoComplete="name" placeholder="Priya Sharma" defaultValue={state.name} />
        ) : null}
        <Field
          label="Work email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
          defaultValue={state.email}
          required
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete={mode === "login" ? "current-password" : "new-password"}
          placeholder={mode === "signup" ? "At least 8 characters" : "Your password"}
          minLength={mode === "signup" ? 8 : undefined}
          required
        />

        <div aria-live="polite">
          {state.error ? (
            <p className="rounded-xl bg-[#fff1ee] px-4 py-3 text-sm text-[#b42318] ring-1 ring-[#fdd5cc]">{state.error}</p>
          ) : null}
        </div>

        <div className="pt-2">
          <SubmitButton pendingLabel={c.pending}>{c.submit}</SubmitButton>
        </div>
      </form>

      <p className="mt-8 text-center text-sm text-[#666]">
        {c.switchText}{" "}
        <Link href={c.switchLink.href} className="font-[525] text-ink underline-offset-4 hover:underline">
          {c.switchLink.label}
        </Link>
      </p>
    </div>
  );
}
