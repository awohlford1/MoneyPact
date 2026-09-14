import assert from "node:assert/strict";
import { test } from "node:test";
import type { FastifyRequest } from "fastify";
import type { BudgetCreationProposalResponse, BudgetCreationProposalReadResponse } from "../../../../packages/budget-application/src/creation-proposals/ports.ts";
import { FakeClock, testAuthContext, testPorts } from "../../../../packages/budget-application/src/creation-proposals/support.ts";
import { ProposalHandlers } from "./proposal-handlers.ts";

const body = { name: " Groceries ", timeZone: "America/New_York", currencyCode: "USD", schedule: { cadence: "weekly", anchor: "monday" } };
const request = (value: unknown = body, idempotency = "proposal-http-idem-0001", proposalId?: string): FastifyRequest =>
  ({ body: value, headers: { "idempotency-key": idempotency }, params: { proposalId } }) as unknown as FastifyRequest;

void test("proposal handlers map create, exact replay, conflicts, regeneration and lifecycle", async () => {
  const clock = new FakeClock("2026-09-15T12:00:00.000Z");
  const ports = testPorts({ clock });
  const handlers = new ProposalHandlers({ context: async (_req, subjectId) => testAuthContext({ subjectId }), ports: async () => ports });
  const created = await handlers.createOrRegenerate(request(), "subject-1");
  assert.equal(created.status, 201);
  const proposal = created.body as BudgetCreationProposalResponse;
  assert.equal(proposal.normalizedInputs.name, "Groceries");
  assert.equal(proposal.preview.periods.length, 4);
  assert.equal(proposal.issuedAt, "2026-09-15T12:00:00.000Z");
  assert.equal(proposal.expiresAt, "2026-09-15T12:30:00.000Z");
  assert.ok(proposal.confirmationBinding); assert.ok(proposal.previewDigest);
  assert.equal(Object.hasOwn(proposal, "budgetSpaceId"), false);
  assert.deepEqual(await handlers.createOrRegenerate(request(), "subject-1"), { status: 200, body: proposal });
  assert.equal((await handlers.createOrRegenerate(request({ ...body, name: "Changed" }), "subject-1")).status, 409);
  const successor = await handlers.createOrRegenerate(request({ ...body, name: "Changed", supersedesProposalId: proposal.proposalId }, "proposal-http-idem-0002"), "subject-1");
  assert.equal(successor.status, 201);
  assert.equal((successor.body as BudgetCreationProposalResponse).draftRevision, 2);
  const previous = await handlers.read(request(undefined, undefined, proposal.proposalId), "subject-1");
  assert.equal(previous.status, 200);
  assert.deepEqual((previous.body as BudgetCreationProposalReadResponse).lifecycle, { status: "invalidated", reason: "superseded", regenerateRequired: true });
  clock.advanceMs(30 * 60 * 1000);
  const expired = await handlers.read(request(undefined, undefined, (successor.body as BudgetCreationProposalResponse).proposalId), "subject-1");
  assert.equal((expired.body as BudgetCreationProposalReadResponse).lifecycle.status, "expired");
});

void test("proposal handlers reject client authority without writes and resolve identity before ports", async () => {
  const ports = testPorts(); let writes = 0; let accesses = 0;
  ports.store.createOrReplay = async () => { writes++; assert.fail("invalid proposal persisted"); };
  const handlers = new ProposalHandlers({ context: async (_req, subjectId) => testAuthContext({ subjectId }), ports: async () => { accesses++; return ports; } });
  assert.deepEqual(await handlers.createOrRegenerate(request(), undefined), { status: 401, body: { error: "unauthenticated" } });
  assert.equal(accesses, 0);
  const invalid = await handlers.createOrRegenerate(request({ ...body, subjectId: "forged", preview: [] }, ""), "subject-1");
  assert.equal(invalid.status, 400);
  const errors = invalid.body as { error: string; fieldErrors: { path: string }[] };
  assert.equal(errors.error, "validation_failed");
  assert.deepEqual(errors.fieldErrors.map(error => error.path), ["header.Idempotency-Key", "preview", "subjectId"]);
  assert.equal(writes, 0);
});

void test("proposal reads return uniform not-found across context dimensions and malformed identifiers", async () => {
  const ports = testPorts(); let context = testAuthContext();
  const handlers = new ProposalHandlers({ context: async () => context, ports: async () => ports });
  const created = await handlers.createOrRegenerate(request(), context.subjectId);
  const id = (created.body as BudgetCreationProposalResponse).proposalId;
  for (const change of [{ subjectId: "other" }, { accountId: "other" }, { profileId: "other" }, { environment: "other" }, { sessionGeneration: 2 }]) {
    context = testAuthContext(change);
    assert.deepEqual(await handlers.read(request(undefined, undefined, id), context.subjectId), { status: 404, body: { error: "proposal_not_found" } });
  }
  context = testAuthContext();
  assert.deepEqual(await handlers.read(request(undefined, undefined, "malformed"), context.subjectId), { status: 404, body: { error: "proposal_not_found" } });
  assert.equal((await handlers.read(request(undefined, undefined, id), "wrong-subject")).status, 401);
});
