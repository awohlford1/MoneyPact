import { CalendarView } from "./calendar-view";
export const metadata = { title: "Calendar" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CalendarView key={id} id={id} />;
}
