import { AccountDetailView } from "../accounts-view";
export const metadata = { title: "Account detail" };
export default async function Page({ params }: { params: Promise<{ id: string; accountId: string }> }) {
  const { id, accountId } = await params;
  return <AccountDetailView key={`${id}:${accountId}`} id={id} accountId={accountId} />;
}
