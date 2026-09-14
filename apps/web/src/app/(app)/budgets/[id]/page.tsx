import { Dashboard } from "../../journey";
export const metadata = { title: "Budget dashboard" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Dashboard key={id} id={id} />;
}
