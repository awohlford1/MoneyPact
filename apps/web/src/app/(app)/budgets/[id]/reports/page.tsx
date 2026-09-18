import { ReportsView } from "./reports-view";
export const metadata = { title: "Reports" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReportsView key={id} id={id} />;
}
