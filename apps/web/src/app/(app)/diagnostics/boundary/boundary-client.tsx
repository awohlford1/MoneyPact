"use client";
import { ApiError } from "../../../../api/client";

// UI-P07 test-only diagnostic (see ./page.tsx). Throwing during this page's own server render would carry
// the error across to the client as a generic, reconstructed object -- losing the `ApiError` class
// `../../../../ui/resource.tsx`'s `classifyFailure` and `../error.tsx` both rely on. `typeof window` is
// undefined during the server render (so that pass renders the plain paragraph below) and defined from the
// very first client render, including hydration -- so the throw happens entirely in the browser, on the
// exact `ApiError` instance the nearest `error.tsx` boundary receives.
export function BoundaryDiagnosticClient({ status }: { status: number }) {
  if (typeof window !== "undefined" && status !== 200) throw new ApiError(status, "diagnostic");
  return <p>Boundary diagnostic{status === 200 ? ": no error thrown." : "…"}</p>;
}
