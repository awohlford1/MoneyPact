import type { ReactNode } from "react";
import { SessionProvider } from "../../../session/SessionProvider";
import { BudgetNavigation } from "../journey";
export default function NoticesLayout({ children }: { children: ReactNode }) {
  return <SessionProvider><BudgetNavigation />{children}</SessionProvider>;
}
