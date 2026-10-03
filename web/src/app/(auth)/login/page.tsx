import type { Metadata } from "next";

import { AuthForm } from "../AuthForm";

export const metadata: Metadata = { title: "Log in | Awaz" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  return <AuthForm mode="login" next={next} />;
}
