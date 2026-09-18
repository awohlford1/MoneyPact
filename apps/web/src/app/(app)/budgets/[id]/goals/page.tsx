import { GoalsView } from "./goals-view";
export const metadata = { title: "Goals" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GoalsView key={id} id={id} />;
}
