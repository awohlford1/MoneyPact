import { BoundaryDiagnosticClient } from "./boundary-client";

export const metadata = { title: "Boundary diagnostic" };

/**
 * UI-P07 test-only diagnostic. Nothing in today's app throws an `ApiError` during render -- every read
 * that can fail is caught inside `useResource` and rendered by the failure classifier as component state
 * (`../../../ui/resource.tsx`'s `Failure`), never by React's own render-phase error boundary. `../error.tsx`
 * exists for the day something does, and this is the only way to make that day happen on demand in the
 * browser suite: the client half throws the requested status after mount (`./boundary-client.tsx`), so
 * the error is a real, same-realm `ApiError` thrown client-side -- never carried across the server/client
 * boundary, where Next would replace it with a generic message and lose its class entirely.
 *
 * Never linked from anywhere in the product (the same convention `/foundation` uses for the same reason,
 * `apps/web/AGENTS.md`). `?status=200` renders without throwing, for a control case.
 */
export default async function BoundaryDiagnosticPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  return <BoundaryDiagnosticClient status={Number(status ?? "500")} />;
}
