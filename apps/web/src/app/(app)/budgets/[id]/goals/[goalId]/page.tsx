import { GoalDetailView } from "../goals-view";
export const metadata = { title: "Goal detail" };
export default async function Page({ params }: { params: Promise<{ id: string; goalId: string }> }) {
  const { id, goalId } = await params;
  return <GoalDetailView key={`${id}:${goalId}`} id={id} goalId={goalId} />;
}
