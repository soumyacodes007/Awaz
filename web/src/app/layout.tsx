import "./globals.css";

import type { Metadata } from "next";
import { Figtree, Geist, Geist_Mono } from "next/font/google";

// Landing: Geist display, Figtree body. The signed-in app uses Geist for
// everything plus Geist Mono for prompts, IDs and code (see .font-app).
const body = Figtree({
  variable: "--font-body",
  subsets: ["latin"],
});

// Both faces load as variable fonts so in-between weights (425, 525) work.
const display = Geist({
  variable: "--font-display-face",
  subsets: ["latin"],
});

const mono = Geist_Mono({
  variable: "--font-mono-face",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Awaz | Real-time voice agents for India",
  description:
    "Open source platform for building voice agents that speak Hindi, English and Hinglish, on any model and any carrier.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // Font variables live on <html> so anything referencing them (including
    // the body's own font-family) can resolve them.
    <html lang="en" className={`${body.variable} ${display.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
