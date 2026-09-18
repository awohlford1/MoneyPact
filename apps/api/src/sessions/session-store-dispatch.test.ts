/**
 * REV-IDLE-1 (Critical, PR #408 review): a non-live, apps/api-level test through the *real* wiring --
 * `buildSessionFactSourceAdapter` (this package's `index.ts`, exactly as `runtime.ts` composes it),
 * `createApiFactSource` (this package's `fact-source.ts`, the wrapper that dropped the discriminator), and
 * `FactAssembler` (`apps/api/src/authorization/facts.ts`, the real caller) -- proving the regression the
 * reviewer caught could not recur silently: `apps/api/src/sessions/fact-source.ts`'s `session_store` branch
 * previously forwarded only `{ credential }` to `@cobudget/sessions`'s adapter, dropping
 * `lookup.identityOnly` entirely, so every non-transactional resolution (including the gate's) silently took
 * the read-only "none" branch and never slid at all. A unit test inside `packages/sessions` alone cannot
 * catch this class of bug, because that package never sees the apps/api wrapper that actually drops the field.
 *
 * The fake database records every statement it executes (`db.statements`), so "did the gate's resolution
 * attempt an `account_session` update at all" is observable without reaching into `buildSessionFactSourceAdapter`'s
 * internally-constructed store.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { consumeAndIssue, createSessionStore, resolveSessionConfig } from "@cobudget/sessions";
import type { SessionIssueCommandV1 } from "@cobudget/sessions";
import { FactAssembler } from "../authorization/facts.ts";
import { createApiFactSource } from "./fact-source.ts";
import { buildSessionFactSourceAdapter } from "./index.ts";
import { createFakeIdentityClient, FakeIdentityDatabase } from "../identity/test-support/fake-client.ts";

const ENVIRONMENT = "test";

function sessionConfig() {
  return resolveSessionConfig({
    COBUDGET_SESSION_PEPPER: Buffer.alloc(32, 9).toString("base64"),
    COBUDGET_SESSION_IDLE_TIMEOUT_SECONDS: "900",
    COBUDGET_SESSION_ABSOLUTE_LIFETIME_SECONDS: "3600",
    COBUDGET_SESSION_FRESH_ASSURANCE_WINDOW_SECONDS: "300",
    COBUDGET_SESSION_REVOCATION_PROPAGATION_TARGET_SECONDS: "60",
    COBUDGET_SESSION_PROVIDER_MAX_FUTURE_SKEW_SECONDS: "30",
    COBUDGET_SESSION_REJECTION_TIMING_FLOOR_MS: "1",
    COBUDGET_SESSION_REJECTION_TIMING_JITTER_MS: "1",
    COBUDGET_SESSION_REJECTION_TIMING_SAMPLE_COUNT: "10",
    COBUDGET_SESSION_REJECTION_TIMING_TIMEOUT_BUCKET_MS: "1",
    COBUDGET_SESSION_REJECTION_TIMING_MAX_DIFFERENTIAL_MS: "50",
  });
}

function baseCommand(overrides: Partial<SessionIssueCommandV1> = {}): SessionIssueCommandV1 {
  return {
    contractVersion: 1, sessionHandoffId: randomUUID(), accountSubjectId: randomUUID(), environmentId: ENVIRONMENT,
    identityBindingId: randomUUID(), rotationCause: "authentication", previousSessionId: undefined,
    boundCurrentSessionRef: undefined, preparedRevocationEpoch: undefined, freshAssurance: undefined,
    deliverUntil: new Date(Date.now() + 60_000), ...overrides,
  };
}

const envelopeKeyProvider = { currentVersion: "test-v1", sealingKey: () => Buffer.alloc(32, 11), keyFor: (v: string) => (v === "test-v1" ? Buffer.alloc(32, 11) : undefined) };

async function fixture() {
  const db = new FakeIdentityDatabase();
  const client = createFakeIdentityClient(db);
  const config = sessionConfig();
  const seedStore = createSessionStore(client);
  const command = baseCommand();
  const delivery = await consumeAndIssue(command, seedStore, config, envelopeKeyProvider, new Date());
  // The real composition (`runtime.ts`'s `composeLocalRuntime`): `buildSessionFactSourceAdapter` (index.ts)
  // wrapped by `createApiFactSource` (fact-source.ts, the file with the REV-IDLE-1 regression).
  const sessions = buildSessionFactSourceAdapter(config, ENVIRONMENT, client);
  const apiSource = createApiFactSource({ sessions, client });
  const assembler = new FactAssembler("api", apiSource, () => new Date(), 5_000, undefined, { environmentId: ENVIRONMENT });
  return { db, client, config, command, delivery, apiSource, assembler };
}

void test("REV-IDLE-1: the real gate call (FactAssembler#resolveSession, through the api wrapper) actually attempts the best-effort slide -- proving identityOnly survives the wrapper", async () => {
  const { db, command, delivery, assembler } = await fixture();
  const before = db.statements.length;
  const actor = await assembler.resolveSession(delivery.cookieValue);
  assert.equal(actor, command.accountSubjectId);
  const updatesAfterGate = db.statements.slice(before).filter((s) => s.table === "account_session" && s.operation === "update");
  assert.equal(updatesAfterGate.length, 1, `the gate resolution, called through the real apps/api wrapper, must attempt exactly one account_session update -- REV-IDLE-1's regression made this silently zero: ${JSON.stringify(db.statements.slice(before))}`);
});

void test("REV-IDLE-1: the precheck-shaped call (identityOnly absent, a real action, no transaction) through the same real wrapper never writes", async () => {
  const { db, delivery, apiSource } = await fixture();
  const before = db.statements.length;
  const facts = await apiSource.read("session_store", { credential: delivery.cookieValue, operation: { action: "budget.create", purpose: "user_delegated", mode: "user_delegated", fieldSet: "default" } });
  assert.ok(facts, "the precheck-shaped read still resolves the identity");
  assert.equal((facts as Record<string, unknown>)["subject.sessionRef"], delivery.sessionRef);
  const updates = db.statements.slice(before).filter((s) => s.table === "account_session" && s.operation === "update");
  assert.equal(updates.length, 0, "IDLE-D04: the precheck never writes a slide");
});

void test("REV-IDLE-1: the scoped/transaction-bound path (through the real wrapper) still waits, writes exactly once and fences, unaffected by the gate/precheck fix", async () => {
  const { db, client, config, delivery } = await fixture();
  const sessionsScoped = buildSessionFactSourceAdapter(config, ENVIRONMENT, client, true);
  const apiSourceScoped = createApiFactSource({ sessions: sessionsScoped, client });
  const before = db.statements.length;
  const facts = await apiSourceScoped.read(
    "session_store",
    { credential: delivery.cookieValue, operation: { action: "budget.create", purpose: "user_delegated", mode: "user_delegated", fieldSet: "default" } },
    client,
  );
  assert.ok(facts, "the transactional read resolves and fences");
  const sessionUpdates = db.statements.slice(before).filter((s) => s.table === "account_session" && s.operation === "update");
  const authorityUpdates = db.statements.slice(before).filter((s) => s.table === "account_subject_authority" && s.operation === "update");
  assert.equal(sessionUpdates.length, 1, "the in-transaction slide always writes exactly once (waits, never skips)");
  assert.ok(authorityUpdates.length >= 1, "the in-transaction path fences the revocation epoch (A2, unchanged)");
});
