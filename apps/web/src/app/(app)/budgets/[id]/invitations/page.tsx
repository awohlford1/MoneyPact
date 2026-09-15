import { InvitationsView } from "./invitations-view";
export const metadata = { title: "Invitations" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <InvitationsView key={id} id={id} />;
}
