/**
 * PK-6: the pre-counter ceremony gate (`SEC-STAGES-F02` precedent) and the
 * `__Host-mp_invitation_ceremony` cookie helpers.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FastifyRequest } from "fastify";
import type { ApiSurfaceGate } from "../rate-limit/http.js";
import { INVITATION_CEREMONY_COOKIE_NAME, invitationCeremonyCookie, readInvitationCeremonyCookie } from "./cookie.ts";
import { INVITATION_CEREMONY_RECORD_ID, invitationSurfaceGate, namesResolvableCeremony } from "./surface-gate.ts";

const CEREMONY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SAMPLE = "0123456789abcdef".repeat(4);

function request(url: string, params: Record<string, unknown>, cookie?: string): FastifyRequest {
  return { routeOptions: { url }, params, headers: cookie === undefined ? {} : { cookie }, ip: "127.0.0.1", method: "POST" } as unknown as FastifyRequest;
}

describe("the invitation ceremony cookie", () => {
  it("is __Host-prefixed, Secure, HttpOnly, Path=/, SameSite=Strict and bounded to the ceremony's life", () => {
    const header = invitationCeremonyCookie(SAMPLE, "2026-09-15T12:30:00.000Z", new Date("2026-09-15T12:00:00.000Z"));
    assert.match(header, new RegExp(`^${INVITATION_CEREMONY_COOKIE_NAME}=${SAMPLE}; `));
    for (const attribute of ["Path=/", "Secure", "HttpOnly", "SameSite=Strict", "Max-Age=1800"]) assert.ok(header.split("; ").includes(attribute), attribute);
  });
  it("reads only the exact name, and treats a value outside the token shape as absent", () => {
    assert.equal(readInvitationCeremonyCookie(`other=1; ${INVITATION_CEREMONY_COOKIE_NAME}=${SAMPLE}; more=2`), SAMPLE);
    assert.equal(readInvitationCeremonyCookie("__Host-cobudget_session=abc.def"), undefined);
    assert.equal(readInvitationCeremonyCookie(`${INVITATION_CEREMONY_COOKIE_NAME}=short`), undefined);
    assert.equal(readInvitationCeremonyCookie(`${INVITATION_CEREMONY_COOKIE_NAME}=has space${"x".repeat(20)}`), undefined);
    assert.equal(readInvitationCeremonyCookie(undefined), undefined);
  });
});

describe("the pre-counter ceremony gate", () => {
  const located = new Set([CEREMONY]);
  const locate = async (id: string) => located.has(id) ? { budgetSpaceId: "space-1" } : null;
  const cookie = `${INVITATION_CEREMONY_COOKIE_NAME}=${SAMPLE}`;

  it("names a resolvable ceremony only with a well-formed id, a well-formed cookie and a row behind the id", async () => {
    assert.equal(await namesResolvableCeremony(request("/v1/invitations/:ceremonyId/decline", { ceremonyId: CEREMONY }, cookie), locate), true);
    assert.equal(await namesResolvableCeremony(request("/v1/invitations/:ceremonyId/decline", { ceremonyId: CEREMONY.toUpperCase() }, cookie), locate), true, "case-insensitive UUID");
    assert.equal(await namesResolvableCeremony(request("/v1/invitations/:ceremonyId/decline", { ceremonyId: CEREMONY }), locate), false, "no cookie");
    assert.equal(await namesResolvableCeremony(request("/v1/invitations/:ceremonyId/decline", { ceremonyId: "not-a-uuid" }, cookie), locate), false, "malformed id");
    assert.equal(await namesResolvableCeremony(request("/v1/invitations/:ceremonyId/decline", { ceremonyId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }, cookie), locate), false, "no row");
  });

  it("denies an unresolvable verify-channel or decline as deny_input_invalid before the inner gate, and lets resolve and every other surface through", async () => {
    const seen: string[] = [];
    const inner: ApiSurfaceGate = {
      evidence: (r) => ({ registration_id: r.routeOptions.url ?? "", surface_id: "surf-266-invitation-accept", parameter_record_id: r.routeOptions.url === "/other" ? "rlp-266-mutation-v1" : INVITATION_CEREMONY_RECORD_ID } as unknown as ReturnType<ApiSurfaceGate["evidence"]>),
      enforce: async (r) => { seen.push(r.routeOptions.url ?? ""); return { outcome: "allow", provenance: "test-only", release: async () => undefined }; },
      reserved: async () => false,
    };
    const gate = invitationSurfaceGate(inner, locate);
    assert.deepEqual(await gate.enforce(request("/v1/invitations/:ceremonyId/verify-channel", { ceremonyId: CEREMONY }), undefined), { outcome: "deny_input_invalid" });
    assert.deepEqual(await gate.enforce(request("/v1/invitations/:ceremonyId/decline", { ceremonyId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }, cookie), undefined), { outcome: "deny_input_invalid" });
    assert.deepEqual(seen, [], "nothing reached the inner gate, so nothing was counted");
    assert.equal((await gate.enforce(request("/v1/invitations/:ceremonyId/verify-channel", { ceremonyId: CEREMONY }, cookie), undefined)).outcome, "allow");
    assert.equal((await gate.enforce(request("/v1/invitations/resolve", {}), undefined)).outcome, "allow", "resolve has no ceremony yet");
    assert.equal((await gate.enforce(request("/other", { ceremonyId: "x" }), "actor")).outcome, "allow", "another record is never gated here");
    assert.deepEqual(seen, ["/v1/invitations/:ceremonyId/verify-channel", "/v1/invitations/resolve", "/other"]);
    assert.equal(await gate.reserved?.(request("/other", {}), "actor"), false, "reserved delegates");
  });
});
