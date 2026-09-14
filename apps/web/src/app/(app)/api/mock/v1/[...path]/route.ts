import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { ApiError } from "../../../../../../api/client";
import type { ApiClient } from "../../../../../../api/client";
import { createServerMock } from "../../../../../../api/mock-server";
import { mockMode } from "@/api/runtime-mode";

const mockGlobal = globalThis as typeof globalThis & { moneyPactMockSessions?: Map<string, ApiClient> };
const sessions = mockGlobal.moneyPactMockSessions ??= new Map();
const cookieName = "__Host-cobudget_mock";
export const dynamic = "force-dynamic";
async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const url = new URL(request.url);
  if (!mockMode || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return new Response(null, { status: 404 });
  const { path } = await context.params;
  if (request.method === "POST" && path.join("/") === "identity/begin") {
    if (request.headers.get("origin") !== url.origin || request.headers.get("sec-fetch-site") !== "same-origin") return new Response(null, { status: 403 });
    const body = await request.json();
    if (body.ceremony !== "sign_in" || body.postResultDestinationId !== "home") return new Response(null, { status: 400 });
    const id = randomUUID(); const mock = createServerMock(); sessions.set(id, mock);
    const response = NextResponse.json({ navigateTo: "/budgets" });
    response.cookies.set(cookieName, id, { httpOnly: true, secure: true, sameSite: "lax", path: "/" });
    response.cookies.set("__Host-cobudget_csrf", (await mock.me())!.csrf!, { secure: true, sameSite: "lax", path: "/" });
    response.headers.set("Cache-Control", "no-store"); return response;
  }
  const cookie = request.headers.get("cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  const api = cookie ? sessions.get(cookie) : undefined;
  try {
    if (!api) throw new ApiError(403, "unauthenticated");
    if (request.method !== "GET") {
      const session = await api.me();
      if (request.headers.get("origin") !== url.origin || request.headers.get("sec-fetch-site") !== "same-origin" || request.headers.get("x-csrf-token") !== session?.csrf) throw new ApiError(403, "authorization_denied");
    }
    const body = request.method === "GET" ? {} : await request.json().catch(() => ({}));
    const idempotency = request.headers.get("Idempotency-Key") ?? "";
    let value: unknown;
    if (path.join("/") === "identity/me" && request.method === "GET") value = await api.me();
    else if (path.join("/") === "identity/logout" && request.method === "POST") {
      await api.logout(); sessions.delete(cookie!);
      const response = new NextResponse(null, { status: 204 });
      response.cookies.set(cookieName, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
      response.cookies.set("__Host-cobudget_csrf", "", { secure: true, sameSite: "lax", path: "/", maxAge: 0 }); return response;
    } else if (path[0] === "budget-creation-proposals") {
      if (request.method === "POST" && !/^[\x21-\x7e]{16,128}$/.test(idempotency)) throw new ApiError(400, "validation_failed");
      if (path.length === 1 && request.method === "POST") value = await api.createProposal(body, idempotency, body.supersedesProposalId);
      else if (path.length === 2 && request.method === "GET") value = await api.readProposal(path[1]);
      else if (path.length === 3 && path[2] === "confirm" && request.method === "POST") {
        if (Object.keys(body).some(field => field !== "confirmationBinding")) throw new ApiError(400, "validation_failed");
        value = await api.confirmProposal(path[1], body.confirmationBinding, idempotency);
      } else throw new ApiError(404, "not_found");
    } else if (path[0] === "budget-spaces") {
      if (path.length === 1 && request.method === "GET") value = await api.listBudgets();
      else if (path.length === 2 && request.method === "GET") value = await api.budget(path[1]);
      else if (path[2] === "plan" && request.method === "GET") value = await api.plan(path[1], url.searchParams.get("periodId") ?? "");
      else if (path[2] === "categories" && request.method === "POST") value = await api.addCategory(path[1], body.name);
      else if (path[2] === "targets" && path[3] && request.method === "PUT") value = await api.saveTarget(path[1], path[3], body.baseAmount, body.expectedVersion);
      else throw new ApiError(404, "not_found");
    } else throw new ApiError(404, "not_found");
    return value === undefined ? new Response(null, { status: 204 }) : NextResponse.json(value, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof ApiError ? error.code : "request_failed", fieldErrors: error instanceof ApiError ? error.fieldErrors : [] }, { status: error instanceof ApiError ? error.status : 503, headers: { "Cache-Control": "no-store" } });
  }
}
export { handle as GET, handle as POST, handle as PUT };
