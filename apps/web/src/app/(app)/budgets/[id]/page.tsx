import { Dashboard } from "../../journey";
import { SpaceNavigation } from "../../invitations-shared";
export const metadata = { title: "Budget dashboard" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // CBD-35 deviation: the plan called for deleting this SpaceNavigation now that [id]/layout.tsx renders
  // BudgetTabs above every route here, but BudgetTabs' destination registry is seeded with only Dashboard,
  // Category plan, Members and Invitations (per plan section 4.1) -- it carries no Primary-ownership or
  // Notices destination. Removing SpaceNavigation here breaks pk8Journey's only path from the dashboard to
  // the members list, and from the members page to Primary ownership, which P01-AC02 requires to keep passing
  // unchanged. Kept until a later packet either adds those destinations to the registry or replaces this nav
  // for a reason of its own.
  return <><SpaceNavigation id={id} /><Dashboard key={id} id={id} /></>;
}
