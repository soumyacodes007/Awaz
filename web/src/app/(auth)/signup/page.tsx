import type { Metadata } from "next";

import { AuthForm } from "../AuthForm";

export const metadata: Metadata = { title: "Create your account | Awaz" };

export default function SignupPage() {
  return <AuthForm mode="signup" />;
}
