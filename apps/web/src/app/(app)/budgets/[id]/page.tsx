import { Dashboard } from "../../journey";
import { SpaceNavigation } from "../../invitations-shared";
export const metadata = { title: "Budget dashboard" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // PK-8: the members, invitations, primary-ownership and notices pages are reached from the dashboard.
  return <><SpaceNavigation id={id} /><Dashboard key={id} id={id} /></>;
}
