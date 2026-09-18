import { AccountsView } from "./accounts-view";
export const metadata = { title: "Accounts" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AccountsView key={id} id={id} />;
}
