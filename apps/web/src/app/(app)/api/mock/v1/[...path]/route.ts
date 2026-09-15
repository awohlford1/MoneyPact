import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { handleMockRequest, createServerMock } from "../../../../../../api/mock-server";
import type { MockWire } from "../../../../../../api/mock-server";
import { mockMode } from "@/api/runtime-mode";

const mockGlobal = globalThis as typeof globalThis & { moneyPactMockSessions?: Map<string, MockWire> };
const sessions = mockGlobal.moneyPactMockSessions ??= new Map();
const cookieName = "__Host-cobudget_mock";
export const dynamic = "force-dynamic";
/**
 * DEVELOPMENT ONLY (localhost, mock mode). One HttpOnly session cookie; the CSRF value travels only in the
 * GET /identity/me bootstrap body and back in X-CoBudget-CSRF, exactly as the API does (CBD-191 section 5.1).
 */
async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const url = new URL(request.url);
  if (!mockMode || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return new Response(null, { status: 404 });
  const { path } = await context.params;
  if (request.method === "POST" && path.join("/") === "identity/begin") {
    if (request.headers.get("origin") !== url.origin || request.headers.get("sec-fetch-site") !== "same-origin") return new Response(null, { status: 403 });
    const body = await request.json();
    if (body.ceremony !== "sign_in" || !["home", "budgets"].includes(body.postResultDestinationId)) return new Response(null, { status: 400 });
    const id = randomUUID(); sessions.set(id, createServerMock());
    const response = NextResponse.json({ navigateTo: "/budgets" });
    response.cookies.set(cookieName, id, { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
    response.headers.set("Cache-Control", "no-store"); return response;
  }
  const cookie = request.headers.get("cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  const api = cookie ? sessions.get(cookie) : undefined;
  if (!api) return NextResponse.json({ outcome: "deny", reason: "denied" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const response = await handleMockRequest(api, request, path);
  if (path.join("/") === "identity/logout" && request.method === "POST" && response.ok) {
    sessions.delete(cookie!);
    const next = new NextResponse(response.body, { status: response.status, headers: response.headers });
    next.cookies.set(cookieName, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
    return next;
  }
  return response;
}
export { handle as GET, handle as POST, handle as PUT, handle as PATCH };
