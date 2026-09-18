import { TransactionsView } from "./transactions-view";
export const metadata = { title: "Transactions" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TransactionsView key={id} id={id} />;
}
