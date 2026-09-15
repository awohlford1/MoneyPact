import { TransferView } from "../transfer-view";
export const metadata = { title: "Primary-ownership transfer" };
export default async function Page({ params, searchParams }: { params: Promise<{ id: string; transferId: string }>; searchParams: Promise<{ resume?: string }> }) {
  const { id, transferId } = await params;
  const { resume } = await searchParams;
  return <TransferView key={`${id}:${transferId}`} id={id} transferId={transferId} resume={resume === "confirm"} />;
}
