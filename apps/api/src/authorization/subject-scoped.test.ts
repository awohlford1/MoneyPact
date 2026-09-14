/**
 * PROTO-ACTIVATION-001 (ACT-02): the p2 subject-scoped cells through the real
 * `FactAssembler` and `AuthorizationBoundary`, not a hand-built PolicyInput.
 *
 * Positive: every section 8.5.1 cell allows for the owning subject when the
 * assembler stamps `environment.environmentId` from its runtime configuration
 * and (for a subject-target cell) copies the row's owner and environment from
 * the datastore. Negative: every P2_NEGATIVE_FIXTURES family still denies. A
 * family the assembler can express (row inequality, inactive subject, wrong
 * shape, wrong adapter, service authority) is driven through the boundary and
 * must deny inertly -- no allow audit, no effect. A family that only a forged
 * input can express (tampered provenance, a forbidden section) is proven two
 * ways: `decide` rejects the forged input, and the assembler is shown never to
 * produce that shape from the same facts. The stale-session family is the
 * commit-time recheck, covered by the explicit stale test below.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decide, SUBJECT_CELLS } from "@cobudget/contracts/authorization";
// The p2 fixture catalog is not re-exported by the package index (packages/contracts/src/authorization is read-only for this packet).
import { P2_NEGATIVE_FIXTURES, subjectFixture } from "../../../../packages/contracts/src/authorization/fixtures/index.ts";
import type { ApiSubjectScopedUserPolicyInput, PolicyInput } from "@cobudget/contracts/authorization";
import { AuthorizationDenied } from "./boundary.js";
import { FactAssembler, FactFailure, absentFactSource } from "./facts.js";
import { Harness } from "./test-support.js";

const BOUNDARY_FAMILIES = new Set(["service_authority", "inactive_subject", "inactive_profile", "wrong_target_shape", "wrong_target_type", "space_bound_shape", "worker_adapter"]);

describe("p2 subject-scoped cells through the real fact assembler", () => {
  for (const cell of SUBJECT_CELLS) {
    it(`allows the owning subject on ${cell.action} and records the allow`, async () => {
      const h = new Harness(subjectFixture(cell.action));
      // The Harness store knows only bootstrap obligations; production's ApiTransactionStore discharges bind_cache_key (RC-05).
      h.store.discharge = async (_transaction, _input, obligation) => obligation.kind === "bind_cache_key";
      const context = await h.boundary.authorize(h.lookup());
      assert.equal(context.decision.outcome, "allow");
      assert.deepEqual(context.decision.cellRef, { kind: "subject", action: cell.action });
      assert.equal(context.input.environment?.environmentId, "env-local-1");
      assert.equal(context.input.provenance["environment.environmentId"], "runtime_configuration");
      assert.equal(context.input.space, undefined); assert.equal(context.input.membership, undefined); assert.equal(context.input.consent, undefined);
      if (context.input.resource) {
        assert.equal(context.input.provenance["resource.owningSubjectId"], "datastore");
        assert.equal(context.input.provenance["resource.environmentId"], "datastore");
        assert.equal(context.input.resource.owningSpaceId, "none");
      }
      const ran: string[] = [];
      const result = await h.boundary.execute(context, async (effect) => { ran.push(effect.input.request.action); return "ok"; });
      assert.equal(result, "ok"); assert.deepEqual(ran, [cell.action]);
      assert.equal(h.state.audits.at(-1)?.outcome, "allow");
    });
  }

  it("denies a subject-scoped operation when no environment is configured (worker mirror, or an api process without one)", async () => {
    const h = new Harness(subjectFixture("profile.read"));
    for (const adapter of ["api", "worker"] as const) {
      const assembler = new FactAssembler(adapter, h.source, () => new Date());
      await assert.rejects(assembler.assemble(h.lookup()), (error: unknown) => error instanceof FactFailure && error.reason === "input_invalid");
    }
    await assert.rejects(new FactAssembler("api", absentFactSource, () => new Date(), 5_000, undefined, { environmentId: "env-local-1" }).assemble(h.lookup()), (error: unknown) => error instanceof FactFailure && error.reason === "not_authenticated");
  });

  it("denies a subject-target row the subject-keyed statement does not return, without an identifier-only lookup", async () => {
    const h = new Harness(subjectFixture("proposal.read"));
    h.corrupt = (source, facts) => { if (source === "datastore") for (const key of Object.keys(facts)) if (key.startsWith("resource.")) delete facts[key]; };
    await assert.rejects(h.boundary.authorize(h.lookup()), AuthorizationDenied);
    assert.equal(h.state.audits.at(-1)?.outcome, "deny");
    assert.equal(h.state.audits.at(-1)?.reasonClass, "input_invalid");
  });

  it("denies a subject-scoped locator that smuggles an acting space or membership", async () => {
    const h = new Harness(subjectFixture("membership.list_own"));
    const lookup = h.lookup();
    for (const extra of [{ actingSpaceId: "space-1" }, { actingMembershipId: "membership-1" }, { resourceType: "proposal" as const, resourceId: "proposal-1" }]) {
      await assert.rejects(h.boundary.authorize({ ...lookup, operation: { ...lookup.operation, ...extra } }), AuthorizationDenied);
      assert.equal(h.state.audits.at(-1)?.outcome, "deny");
    }
  });

  it("denies a stale session version at commit for the mutate cells", async () => {
    for (const action of ["proposal.create", "proposal.regenerate"]) {
      const h = new Harness(subjectFixture(action));
      const context = await h.boundary.authorize(h.lookup());
      (h.input as ApiSubjectScopedUserPolicyInput).subject.sessionVersion = 99;
      await assert.rejects(h.boundary.execute(context, async () => assert.fail("handler must not run")), AuthorizationDenied);
      assert.equal(h.state.audits.at(-1)?.outcome, "deny");
      assert.equal(h.state.audits.at(-1)?.reasonClass, "stale_version");
      assert.deepEqual(h.order.filter((step) => step === "commit"), []);
    }
  });

  for (const fixture of P2_NEGATIVE_FIXTURES) {
    const input = fixture.input as PolicyInput;
    if (BOUNDARY_FAMILIES.has(fixture.family) || (fixture.family === "another_subject" || fixture.family === "wrong_environment") && input.resource !== undefined) {
      it(`${fixture.id}: denies inertly through the boundary (${fixture.reason})`, async () => {
        const h = new Harness(input);
        await assert.rejects(h.boundary.authorize(h.lookup()), AuthorizationDenied);
        const audit = h.state.audits.at(-1);
        assert.equal(audit?.outcome, "deny");
        assert.equal(audit?.cellRef, undefined);
        assert.ok(!h.order.includes("allow-audit") && !h.order.includes("commit"));
        // The expressible families reproduce the fixture's own reason; the assembler refuses the rest before evaluation.
        if (["worker_adapter", "space_bound_shape"].includes(fixture.family)) assert.equal(audit?.reasonClass, "input_invalid");
        else assert.equal(audit?.reasonClass, fixture.reason);
      });
    } else {
      it(`${fixture.id}: the evaluator rejects the forged input and the assembler never produces it (${fixture.reason})`, async () => {
        assert.equal(decide(input).outcome, "deny");
        assert.equal(decide(input).reasonClass, fixture.reason);
        const positive = subjectFixture(fixture.action);
        const h = new Harness(positive);
        const assembled = await new FactAssembler("api", h.source, () => new Date(), 5_000, undefined, { environmentId: "env-local-1" }).assemble(h.lookup());
        assert.equal(assembled.provenance["subject.accountSubjectId"], "session_store");
        assert.equal(assembled.provenance["environment.environmentId"], "runtime_configuration");
        for (const section of ["space", "membership", "consent", "bootstrap", "serviceSource"]) assert.equal((assembled as unknown as Record<string, unknown>)[section], undefined, section);
        assert.equal(decide(assembled).outcome, "allow");
      });
    }
  }
});
