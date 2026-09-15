import { CeremonyView } from "../../ceremony-view";
export const metadata = { title: "Your invitation", robots: { index: false, follow: false } };
export default async function Page({ params }: { params: Promise<{ ceremonyId: string }> }) {
  const { ceremonyId } = await params;
  return <CeremonyView key={ceremonyId} ceremonyId={ceremonyId} />;
}
