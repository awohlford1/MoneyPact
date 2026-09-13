/**
 * CBD-232-AC01 (no-write on validation failure), AC02 (server-only
 * computation, rejects client authority), AC04 (immutable versions, issue/
 * expiry, confirmation binding), and the create-path half of AC05/AC08
 * (idempotent replay and conflicts).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canonicalBindingEnvelope } from "./binding.ts";
import { digestOf } from "./canonical-json.ts";
import { createOrRegenerateProposal } from "./application.ts";
import { PROPOSAL_CONTRACT_VERSION } from "./constants.ts";
import { FakeClock, FakeCurrencyContextReader, testAuthContext, testPorts } from "./support.ts";

const VALID_BODY = {
  name: "Groceries",
  timeZone: "America/New_York",
  currencyCode: "USD",
  schedule: { cadence: "weekly", anchor: "monday" },
};

function command(overrides?: { idempotencyKeyHeader?: string; body?: unknown }) {
  return {
    subjectContext: testAuthContext(),
    idempotencyKeyHeader: overrides?.idempotencyKeyHeader ?? "idempotency-key-0001",
    body: overrides?.body ?? VALID_BODY,
  };
}

describe("CBD-232-AC01: no proposal or authoritative write on validation failure", () => {
  it("returns validation_failed and never calls the store", async () => {
    const ports = testPorts();
    let storeCalled = false;
    const originalCreateOrReplay = ports.store.createOrReplay.bind(ports.store);
    ports.store.createOrReplay = async (cmd) => {
      storeCalled = true;
      return originalCreateOrReplay(cmd);
    };

    const outcome = await createOrRegenerateProposal(command({ body: { ...VALID_BODY, name: "" } }), ports);
    assert.equal(outcome.kind, "validation_failed");
    assert.equal(storeCalled, false);
  });
});

describe("CBD-232-AC02: server-only computation and client-authority rejection", () => {
  it("ignores any client-supplied subject/environment/version/binding fields, which are not part of the request type", async () => {
    const ports = testPorts();
    const outcome = await createOrRegenerateProposal(
      command({
        body: {
          ...VALID_BODY,
          subjectId: "attacker",
          accountId: "attacker-account",
          environment: "prod",
          budgetDate: "1999-01-01",
          issuedAt: "1999-01-01T00:00:00Z",
          expiresAt: "1999-01-01T00:00:00Z",
          preview: { fake: true },
          confirmationBinding: "forged",
        },
      }),
      ports,
    );
    // Every one of those keys is outside the declared request shape, so
    // unknown-field detection rejects the request rather than silently
    // ignoring the attempted override (defence in depth for §4.1's "the
    // client never supplies" list).
    assert.equal(outcome.kind, "validation_failed");
    if (outcome.kind === "validation_failed") {
      for (const forbidden of ["subjectId", "accountId", "environment", "budgetDate", "issuedAt", "expiresAt", "preview", "confirmationBinding"]) {
        assert.ok(outcome.fieldErrors.some((e) => e.path === forbidden && e.code === "input.unknown-field"));
      }
    }
  });

  it("computes the preview from the authenticated context's clock, not any client input", async () => {
    const clock = new FakeClock("2026-09-16T12:00:00.000Z"); // a Wednesday
    const ports = testPorts({ clock });
    const outcome = await createOrRegenerateProposal(command(), ports);
    assert.equal(outcome.kind, "created");
    if (outcome.kind === "created") {
      assert.equal(outcome.response.preview.budgetDate, "2026-09-16");
      // Weekly-Monday anchor: the period containing 2026-09-16 starts 2026-09-14.
      assert.equal(outcome.response.preview.periods[0]!.start, "2026-09-14");
    }
  });
});

describe("CBD-232-AC04: immutable versions, issue/expiry, and confirmation binding", () => {
  it("records the governing versions and a 30-minute expiry when it is earlier than local midnight", async () => {
    const clock = new FakeClock("2026-09-16T12:00:00.000Z"); // noon Eastern is well before midnight
    const ports = testPorts({ clock });
    const outcome = await createOrRegenerateProposal(command(), ports);
    assert.equal(outcome.kind, "created");
    if (outcome.kind === "created") {
      assert.equal(outcome.response.governingVersions.proposalContractVersion, PROPOSAL_CONTRACT_VERSION);
      assert.equal(outcome.response.issuedAt, "2026-09-16T12:00:00.000Z");
      assert.equal(outcome.response.expiresAt, "2026-09-16T12:30:00.000Z");
      assert.equal(outcome.response.bindingVersion, "bcp-hmac-sha256/v1");
    }
  });

  it("caps expiry at local midnight when it precedes the 30-minute limit", async () => {
    // 2026-09-16 23:50 America/New_York = 2026-09-17T03:50:00.000Z.
    const clock = new FakeClock("2026-09-17T03:50:00.000Z");
    const ports = testPorts({ clock });
    const outcome = await createOrRegenerateProposal(command(), ports);
    assert.equal(outcome.kind, "created");
    if (outcome.kind === "created") {
      // Local midnight (America/New_York start of 2026-09-17) is 2026-09-17T04:00:00.000Z.
      assert.equal(outcome.response.expiresAt, "2026-09-17T04:00:00.000Z");
    }
  });

  it("produces a binding that verifies against the exact envelope and rejects any alteration", async () => {
    const ports = testPorts();
    const outcome = await createOrRegenerateProposal(command(), ports);
    assert.equal(outcome.kind, "created");
    if (outcome.kind !== "created") return;
    const response = outcome.response;
    const envelope = canonicalBindingEnvelope({
      bindingVersion: response.bindingVersion,
      context: command().subjectContext,
      proposalId: response.proposalId,
      proposalVersion: response.proposalVersion,
      draftRevision: response.draftRevision,
      normalizedInputs: response.normalizedInputs,
      governingVersions: response.governingVersions,
      issuedAt: response.issuedAt,
      expiresAt: response.expiresAt,
      previewDigest: response.previewDigest,
      budgetDate: response.preview.budgetDate,
      predecessorProposalId: response.supersedesProposalId,
    });
    assert.equal(ports.bindingKeyring.verify(envelope, response.confirmationBinding), true);

    const tamperedEnvelope = envelope.replace(response.previewDigest, "tampered-digest-value");
    assert.equal(ports.bindingKeyring.verify(tamperedEnvelope, response.confirmationBinding), false);
    assert.equal(ports.bindingKeyring.verify(envelope, `${response.confirmationBinding}x`), false);
  });

  it("the digest detects an altered preview payload", async () => {
    const ports = testPorts();
    const outcome = await createOrRegenerateProposal(command(), ports);
    assert.equal(outcome.kind, "created");
    if (outcome.kind !== "created") return;
    const response = outcome.response;
    const recomputed = digestOf({
      normalizedInputs: response.normalizedInputs,
      governingVersions: response.governingVersions,
      preview: response.preview,
    });
    assert.equal(recomputed, response.previewDigest);

    const forgedPreview = { ...response.preview, periods: [] };
    const forgedDigest = digestOf({
      normalizedInputs: response.normalizedInputs,
      governingVersions: response.governingVersions,
      preview: forgedPreview,
    });
    assert.notEqual(forgedDigest, response.previewDigest);
  });
});

describe("CBD-232-AC04/AC05: idempotent replay and conflicts on create", () => {
  it("returns 200 with the stored response for an exact retry with the same key and same command", async () => {
    const ports = testPorts();
    const first = await createOrRegenerateProposal(command({ idempotencyKeyHeader: "same-key-0000001" }), ports);
    const second = await createOrRegenerateProposal(command({ idempotencyKeyHeader: "same-key-0000001" }), ports);
    assert.equal(first.kind, "created");
    assert.equal(second.kind, "replayed");
    if (first.kind === "created" && second.kind === "replayed") {
      assert.deepEqual(second.response, first.response);
    }
  });

  it("returns idempotency_key_reused for the same key with a different command", async () => {
    const ports = testPorts();
    await createOrRegenerateProposal(command({ idempotencyKeyHeader: "reused-key-0000001" }), ports);
    const second = await createOrRegenerateProposal(
      command({ idempotencyKeyHeader: "reused-key-0000001", body: { ...VALID_BODY, name: "Different Name" } }),
      ports,
    );
    assert.equal(second.kind, "conflict");
    if (second.kind === "conflict") {
      assert.equal(second.conflict.error, "idempotency_key_reused");
      assert.equal(second.conflict.retryWithNewKey, true);
      assert.equal(second.conflict.regenerateRequired, false);
    }
  });

  it("returns idempotency_replay_unavailable/dependency_changed when the currency catalog version changes", async () => {
    const ports = testPorts();
    const key = "dep-change-key-000001";
    await createOrRegenerateProposal(command({ idempotencyKeyHeader: key }), ports);
    // Simulate a currency-catalog version bump between the original call and the retry.
    const bumpedPorts = {
      ...ports,
      currencyContextReader: new FakeCurrencyContextReader({ currencyCatalogVersion: "currency-catalog/test-2" }),
    };
    const second = await createOrRegenerateProposal(command({ idempotencyKeyHeader: key }), bumpedPorts);
    assert.equal(second.kind, "conflict");
    if (second.kind === "conflict" && second.conflict.error === "idempotency_replay_unavailable") {
      assert.equal(second.conflict.reason, "dependency_changed");
      assert.equal(second.conflict.regenerateRequired, true);
    }
  });

  it("returns idempotency_replay_unavailable/expired for a retry after the proposal expired", async () => {
    const clock = new FakeClock("2026-09-16T12:00:00.000Z");
    const ports = testPorts({ clock });
    const key = "expired-retry-key-0001";
    await createOrRegenerateProposal(command({ idempotencyKeyHeader: key }), ports);
    clock.advanceMs(31 * 60 * 1000); // past the 30-minute cap
    const second = await createOrRegenerateProposal(command({ idempotencyKeyHeader: key }), ports);
    assert.equal(second.kind, "conflict");
    if (second.kind === "conflict" && second.conflict.error === "idempotency_replay_unavailable") {
      assert.equal(second.conflict.reason, "expired");
      assert.equal(second.conflict.regenerateRequired, true);
    }
  });

  it("makes the key eligible for a new operation after the 24-hour retention interval", async () => {
    const clock = new FakeClock("2026-09-16T12:00:00.000Z");
    const ports = testPorts({ clock });
    const key = "retention-key-0000001";
    const first = await createOrRegenerateProposal(command({ idempotencyKeyHeader: key }), ports);
    clock.advanceMs(24 * 60 * 60 * 1000 + 1);
    const second = await createOrRegenerateProposal(command({ idempotencyKeyHeader: key }), ports);
    assert.equal(first.kind, "created");
    assert.equal(second.kind, "created");
    if (first.kind === "created" && second.kind === "created") {
      assert.notEqual(first.response.proposalId, second.response.proposalId);
    }
  });
});
