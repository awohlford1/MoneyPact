"use client";
// The [id] layout's own navigation (CBD-35): one destination registry every route under
// budgets/[id]/layout.tsx renders from, so a tab is added by the packet that builds its route and never before.
import { usePathname } from "next/navigation";
import NextLink from "next/link";

interface Destination {
  key: string;
  label: string;
  href(id: string): string;
}

// DESTINATION REGISTRY -- append-only. Add your destination as the next entry, in the order its tab should
// render; a destination absent here is simply not offered yet, never disabled.
const DESTINATION_REGISTRY: readonly Destination[] = [
  { key: "dashboard", label: "Dashboard", href: id => `/budgets/${encodeURIComponent(id)}` },
  { key: "plan", label: "Category plan", href: id => `/budgets/${encodeURIComponent(id)}/plan` },
  { key: "members", label: "Members", href: id => `/budgets/${encodeURIComponent(id)}/members` },
  { key: "invitations", label: "Invitations", href: id => `/budgets/${encodeURIComponent(id)}/invitations` },
];

/** `<nav aria-label="Budget sections">` with `aria-current="page"` on the active destination. `current` names the
 * destination's key explicitly when the caller already knows it; otherwise the active tab is the one whose href
 * matches the current pathname exactly. */
export function BudgetTabs({ id, current }: { id: string; current?: string }) {
  const pathname = usePathname();
  return <nav aria-label="Budget sections"><ul className="flex flex-wrap gap-4">
    {DESTINATION_REGISTRY.map(destination => {
      const href = destination.href(id);
      const active = current !== undefined ? current === destination.key : pathname === href;
      return <li key={destination.key}>
        <NextLink href={href} aria-current={active ? "page" : undefined} className="text-interactive underline">{destination.label}</NextLink>
      </li>;
    })}
  </ul></nav>;
}
