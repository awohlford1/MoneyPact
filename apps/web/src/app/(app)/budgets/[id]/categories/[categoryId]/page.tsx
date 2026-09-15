import { CategoryDetailView } from "../../../spending";
export const metadata = { title: "Category detail" };
export default async function Page({ params }: { params: Promise<{ id: string; categoryId: string }> }) {
  const { id, categoryId } = await params;
  return <CategoryDetailView key={`${id}:${categoryId}`} id={id} categoryId={categoryId} />;
}
