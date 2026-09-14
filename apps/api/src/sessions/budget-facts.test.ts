/**
 * PROTO-ACTIVATION-001 A6 (review R06, SEC-ACT-F01): the interim owner-only consent derivation of
 * docs/cbd-236-consent-facts-proposal.md section 9 (`CF-236-008`). Each condition a to e failing on
 * its own yields no consent fact, and through the real FactAssembler + released policy such an
 * ordinary input denies `input_invalid`; only the self-created sole Primary Owner under the local
 * runtime is admitted, with the labelled interim values. The migration literals the interim relies on
 * are pinned: widening `role`/`status` fails here before it can recreate R06.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { decide } from "@cobudget/contracts/authorization";
import type { DataAccessClient } from "@cobudget/data-access";
import { FactAssembler, FactFailure } from "../authorization/facts.js";
import { budgetFactReader, INTERIM_CONSENT_ID_PREFIX, INTERIM_CONSENT_SOURCE, INTERIM_DISCLOSURE_VERSION, INTERIM_MEMBERSHIP_ROLE, INTERIM_MEMBERSHIP_STATUS, interimOwnerSelfConsent } from "./budget-facts.ts";
import { createApiFactSource } from "./fact-source.ts";

const SPACE = "11111111-1111-4111-8111-111111111111";
const MEMBERSHIP = "22222222-2222-4222-8222-222222222222";
const SUBJECT = "33333333-3333-4333-8333-333333333333";
const owner = () => ({ membership_id: MEMBERSHIP, role: "primary_owner", status: "active", account_subject_id: SUBJECT, created_by_subject_id: SUBJECT, authorization_version: 1 });
const base = () => ({ primaryOwnerMembershipId: MEMBERSHIP, membership: owner(), actingSubjectId: SUBJECT, localRuntime: true });

describe("interimOwnerSelfConsent (section 9 conditions a to e)", () => {
  it("emits the labelled interim values only when every condition holds", () => {
    assert.deepEqual(interimOwnerSelfConsent(base()), {
      "consent.consentId": `${INTERIM_CONSENT_ID_PREFIX}${MEMBERSHIP}`, "consent.disclosureVersion": INTERIM_DISCLOSURE_VERSION, "consent.state": "current", "consent.source": INTERIM_CONSENT_SOURCE,
    });
    assert.equal(INTERIM_DISCLOSURE_VERSION, 1, "a labelled constant, never the membership's authorization_version");
  });
  for (const [label, input] of [
    ["a: no membership row for the acting subject", { ...base(), membership: undefined }],
    ["a: a membership row of another subject", { ...base(), membership: { ...owner(), account_subject_id: "44444444-4444-4444-8444-444444444444", created_by_subject_id: "44444444-4444-4444-8444-444444444444" } }],
    ["b: role co_owner", { ...base(), membership: { ...owner(), role: "co_owner" } }],
    ["b: role collaborator", { ...base(), membership: { ...owner(), role: "collaborator" } }],
    ["b: role viewer", { ...base(), membership: { ...owner(), role: "viewer" } }],
    ["b: role accountability_partner", { ...base(), membership: { ...owner(), role: "accountability_partner" } }],
    ["b: status pending", { ...base(), membership: { ...owner(), status: "pending" } }],
    ["b: status revoked", { ...base(), membership: { ...owner(), status: "revoked" } }],
    ["c: not the space's primary_owner_membership_id", { ...base(), primaryOwnerMembershipId: "55555555-5555-4555-8555-555555555555" }],
    ["d: not self-created", { ...base(), membership: { ...owner(), created_by_subject_id: "66666666-6666-4666-8666-666666666666" } }],
    ["e: not the local runtime", { ...base(), localRuntime: false }],
  ] as const) it(`emits no consent fact when ${label}`, () => {
    assert.equal(interimOwnerSelfConsent(input), undefined);
  });

  it("pins the CBD-231 membership migration literals the interim's safety rests on", () => {
    const migration = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../../../packages/migrations/migrations/20260913T090100Z__create_budget_space_membership.sql"), "utf8");
    assert.match(migration, new RegExp(`CHECK \\(role = '${INTERIM_MEMBERSHIP_ROLE}'\\)`), "widening the role constraint ends the interim's owner-only guarantee");
    assert.match(migration, new RegExp(`CHECK \\(status = '${INTERIM_MEMBERSHIP_STATUS}'\\)`), "widening the status constraint ends the interim's active-only guarantee");
  });
});

describe("through the real fact assembler and the released policy", () => {
  function assembler(membership: Record<string, unknown> | undefined, localRuntime = true) {
    const client = {
      tenantSelect: async (query: { table: string; budgetSpaceId: string; conditions?: { column: string; value: unknown }[] }) => {
        assert.equal(query.budgetSpaceId, SPACE);
        if (query.table === "budget_space") return { rows: [{ budget_space_id: SPACE, lifecycle: "live", lifecycle_version: 1, primary_owner_membership_id: MEMBERSHIP }] };
        if (query.table === "budget_space_membership") {
          // The reader must ask for the acting subject's own row: (space, membership id, account subject).
          assert.deepEqual(query.conditions?.map((c) => c.column), ["membership_id", "account_subject_id"]);
          return { rows: membership && query.conditions?.[1]?.value === membership.account_subject_id ? [membership] : [] };
        }
        return { rows: [] };
      },
    } as unknown as DataAccessClient;
    const sessions = { read: async () => ({ "subject.accountSubjectId": SUBJECT, "subject.sessionRef": "session-ref-1", "subject.sessionVersion": 1 }) };
    const source = createApiFactSource({ sessions, client: {
      ...client,
      // subject and profile rows for the identity leaves
      platformSelect: async (query: { table: string }) => ({ rows: query.table === "account_subject" ? [{ account_subject_id: SUBJECT, lifecycle_state: "active", lifecycle_version: 1 }] : [] }),
      profileSelect: async () => ({ rows: [{ profile_id: "77777777-7777-4777-8777-777777777777", account_subject_id: SUBJECT, profile_state: "active", version: 1 }] }),
    } as unknown as DataAccessClient, extend: budgetFactReader("development", localRuntime) });
    return new FactAssembler("api", source, () => new Date(), 5_000, undefined, { environmentId: "development" });
  }
  const lookup = { credential: "opaque", operation: { action: "1.view_space", purpose: "user_delegated" as const, mode: "user_delegated" as const, fieldSet: "default" as const, resourceType: "space" as const, resourceId: SPACE, actingSpaceId: SPACE, actingMembershipId: MEMBERSHIP } };

  it("the self-created sole Primary Owner under the local runtime assembles with the interim consent and is allowed", async () => {
    const input = await assembler(owner()).assemble(lookup);
    assert.equal(input.consent?.consentId, `${INTERIM_CONSENT_ID_PREFIX}${MEMBERSHIP}`);
    assert.equal(input.consent?.disclosureVersion, INTERIM_DISCLOSURE_VERSION);
    assert.equal(input.consent?.state, "current");
    assert.equal((input as unknown as { consent: Record<string, unknown> }).consent.source, undefined, "the label is not a policy leaf");
    assert.equal(decide(input).outcome, "allow");
  });

  for (const [label, membership, localRuntime] of [
    ["a non-owner active membership (co_owner)", { ...owner(), role: "co_owner" }, true],
    ["a viewer", { ...owner(), role: "viewer" }, true],
    ["a membership that is not the space's primary owner", { ...owner(), membership_id: "55555555-5555-4555-8555-555555555555" }, true],
    ["a membership created by someone else", { ...owner(), created_by_subject_id: "66666666-6666-4666-8666-666666666666" }, true],
    ["the owner outside the local runtime", owner(), false],
  ] as const) it(`${label} gets no consent fact and the ordinary cell denies input_invalid`, async () => {
    const a = assembler(membership, localRuntime);
    const operation = membership.membership_id === MEMBERSHIP ? lookup : { ...lookup, operation: { ...lookup.operation, actingMembershipId: membership.membership_id } };
    await assert.rejects(a.assemble(operation), (error: unknown) => error instanceof FactFailure && error.reason === "input_invalid");
  });
});
