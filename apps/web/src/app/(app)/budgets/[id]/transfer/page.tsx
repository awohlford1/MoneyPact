import { ProposeTransferView } from "./transfer-view";
export const metadata = { title: "Primary ownership" };
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProposeTransferView key={id} id={id} />;
}
