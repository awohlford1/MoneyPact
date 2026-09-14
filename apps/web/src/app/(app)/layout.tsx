import type { ReactNode } from "react";
import NextLink from "next/link";
import { mockMode } from "@/api/runtime-mode";
export default function AppLayout({ children }: { children: ReactNode }) {
  return <div className="min-h-screen">
    <a href="#app-main" className="sr-only focus:not-sr-only">Skip to content</a>
    <header className="border-b border-border px-6 py-5"><NextLink href="/" className="font-display text-xl font-semibold">MoneyPact</NextLink></header>
    <main id="app-main" tabIndex={-1} className="mx-auto w-full max-w-5xl space-y-6 px-6 py-8 outline-none">
      {mockMode && <p role="status">Local demonstration · synthetic data · changes last until the development server restarts.</p>}
      {children}
    </main>
  </div>;
}
