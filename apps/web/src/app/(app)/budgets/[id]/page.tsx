import { Dashboard } from "../../journey";
import { Spending } from "../spending";
export const metadata = { title: "Budget dashboard" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // PROTO-INCREMENT-B-001: accounts, expenses and progress are composed beside the CBD-153 dashboard.
  return <>
    <Dashboard key={id} id={id} />
    <Spending key={`spending:${id}`} id={id} />
  </>;
}
