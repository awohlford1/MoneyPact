import type { ReactNode } from "react";
import { BudgetTabs } from "../../../../ui/budget-nav";
// CBD-35: the [id] layout owns the budget-section navigation, so every route beneath it inherits BudgetTabs and
// never renders its own copy.
export default async function BudgetLayout({ params, children }: { params: Promise<{ id: string }>; children: ReactNode }) {
  const { id } = await params;
  return <>
    <BudgetTabs id={id} />
    {children}
  </>;
}
