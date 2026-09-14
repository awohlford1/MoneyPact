import NextLink from "next/link";
import type { ReactNode } from "react";

import { brandFoundation } from "../../content/brand-foundation";
import { ThemeToggle } from "../../theme/ThemeToggle";

/**
 * The shell shared by the public, unauthenticated pages (CBD-127): a header
 * with the wordmark and one navigation link, the page, and a footer with the
 * theme choice. Landmarks — banner, navigation, main, contentinfo — come from
 * the elements. Nothing here knows whether an account exists, and nothing
 * here loads from anywhere but this origin.
 *
 * `/foundation` deliberately sits outside this group: it is a working
 * surface, not a public page.
 */
export default function PublicLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex w-[min(100%,72rem)] items-center justify-between gap-6 px-6 py-5">
          <NextLink href="/" className="rounded-sm font-display text-lg font-semibold tracking-tight text-on-surface">
            {brandFoundation.brand}
          </NextLink>
          <nav aria-label="Site">
            <NextLink href="/sign-in" className="mr-4 rounded-sm font-semibold text-interactive underline underline-offset-4">Sign in</NextLink>
            <NextLink
              href="/mission"
              className="rounded-sm font-semibold text-interactive underline decoration-1 underline-offset-4 hover:decoration-2"
            >
              Our mission
            </NextLink>
          </nav>
        </div>
      </header>

      <main className="mx-auto w-[min(100%,72rem)] flex-1 px-6 py-12">{children}</main>

      <footer className="border-t border-border">
        <div className="mx-auto flex w-[min(100%,72rem)] flex-wrap items-center justify-between gap-6 px-6 py-8 text-sm text-on-surface-muted">
          <p>{brandFoundation.brand}</p>
          <ThemeToggle />
        </div>
      </footer>
    </div>
  );
}
