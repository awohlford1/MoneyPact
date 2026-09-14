/**
 * CBD-190-AC03 live PostgreSQL proof (CT-190-001/002/003, CBD190-PROFILE-
 * ATOMIC-001) plus AC02 row and log inspection, run through the real
 * `@cobudget/data-access` client against the migrated schema.
 *
 * Exactly the opt-in condition of `packages/data-access/src/
 * transaction.live.test.ts`: it runs only when COBUDGET_DB_NAME names a
 * scratch database other than `cobudget_dev`, never starts Docker and
 * never resets anything. Provision and migrate the scratch database first:
 *
 *   docker exec cobudget-db-1 psql -U postgres -c "CREATE DATABASE cobudget_identity_live"
 *   COBUDGET_DB_NAME=cobudget_identity_live npm run db:migrate --workspace=@cobudget/migrations
 *   cd apps/api && COBUDGET_DB_NAME=cobudget_identity_live npx tsx --test src/identity/mapping.live.test.ts
 *
 * Each run uses a fresh loopback ceremony origin, so its synthetic provider
 * subjects are new to the database and "first use" is real; rows are
 * correlated to the run's issuer and challenge ids, never counted globally.
 */
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { test } from "node:test";
import { loadLocalDatabaseConfig } from "@cobudget/migrations/local";
import { SESSION_COOKIE_NAME } from "@cobudget/sessions";
import { composeApiRuntime } from "../sessions/runtime.ts";
import type { CompletionResult, IdentityCeremony } from "./ceremony.ts";
import type { LocalIssuer, LocalScenario } from "./local-issuer.ts";
import { APPLICATION_ORIGIN, cookieValueFrom, localConfig } from "./test-support/harness.ts";

const database = loadLocalDatabaseConfig();
const configured = database.database !== "cobudget_dev";

function success(result: CompletionResult): Extract<CompletionResult, { kind: "success" }> {
  assert.equal(result.kind, "success", JSON.stringify(result));
  return result as Extract<CompletionResult, { kind: "success" }>;
}

void test("CBD-190-AC03 live PostgreSQL: concurrent callbacks converge on one subject and one active profile; retry, duplicate, existing-subject, disabled-subject and deferred-invariant paths", { skip: !configured, timeout: 120_000 }, async () => {
  const { createApiConnection, createMigrationConnection } = await import("../../../../packages/data-access/src/connection.ts");
  const { bindClient } = await import("../../../../packages/data-access/src/binding.ts");
  const admin = createMigrationConnection();
  const apiPool = createApiConnection();
  const client = bindClient(apiPool, true);
  const port = randomInt(20_000, 60_000);
  const ceremonyOrigin = `http://127.0.0.1:${port}`;
  const issuerId = `${ceremonyOrigin}/v1/identity/local`;
  const config = localConfig({ COBUDGET_IDENTITY_CEREMONY_ORIGIN: ceremonyOrigin, COBUDGET_IDENTITY_ISSUER: issuerId, COBUDGET_IDENTITY_MAPPING_MAX_ATTEMPTS: "6" });
  let waiting = 0;
  let release: () => void = () => undefined;
  const barrier = new Promise<void>((resolve) => { release = resolve; });
  let armed = true;
  const retries: [number, string | undefined][] = [];
  const events: unknown[] = [];
  const runtime = composeApiRuntime(config, (event) => { events.push(event); }, {
    client,
    mappingHooks: {
      beforeResolve: async (attempt) => { if (armed && attempt === 1) { waiting += 1; if (waiting === 2) release(); await barrier; } },
      onRetry: (attempt, sqlState) => { retries.push([attempt, sqlState]); },
    },
  });
  const ceremony: IdentityCeremony = runtime.runtime!.ceremony;
  const issuer: LocalIssuer = runtime.localIssuer!;
  const secrets: string[] = [];
  const originalExchange = issuer.exchange.bind(issuer);
  issuer.exchange = async (input) => {
    const result = await originalExchange(input);
    secrets.push(input.code); secrets.push(input.codeVerifier);
    if (result.ok) { const issued = result.tokens; secrets.push(issued.id_token); secrets.push(issued.access_token); secrets.push(issued.refresh_token ?? ""); }
    return result;
  };

  async function callbackFor(scenario: LocalScenario, ceremonyName = "sign_in", sessionCookie?: string) {
    const begun = await ceremony.begin({ ceremony: ceremonyName, postResultDestinationId: "home", origin: APPLICATION_ORIGIN, secFetchSite: "same-origin", sessionCookie });
    assert.ok(begun.ok);
    const query = Object.fromEntries(new URL(begun.navigateTo).searchParams.entries());
    secrets.push(query.state!, query.nonce!);
    const hosted = issuer.authorize(query);
    assert.ok(hosted.ok);
    const url = issuer.choose(hosted.requestId, scenario);
    assert.ok(url);
    return { url, challengeId: begun.challengeId };
  }
  const deliver = (url: string): Promise<CompletionResult> => {
    const parsed = new URL(url);
    return ceremony.complete({ rawQuery: parsed.search.slice(1), method: "GET", observedOrigin: parsed.origin, path: parsed.pathname, receiptTime: new Date() });
  };
  const count = async (sql: string, params: unknown[]): Promise<number> => Number((await admin.query(sql, params)).rows[0]!.n);
  const subjectsForIssuer = (): Promise<number> => count("select count(distinct account_subject_id) as n from identity_binding where issuer = $1", [issuerId]);
  const bindingsForIssuer = (): Promise<number> => count("select count(*) as n from identity_binding where issuer = $1", [issuerId]);
  const profilesForIssuer = (state: string): Promise<number> => count("select count(*) as n from financial_profile p join identity_binding b on b.account_subject_id = p.account_subject_id where b.issuer = $1 and p.profile_state = $2", [issuerId, state]);
  const sessionsForIssuer = (): Promise<number> => count("select count(*) as n from account_session s join identity_binding b on b.identity_binding_id = s.identity_binding_id where b.issuer = $1", [issuerId]);

  try {
    // CT-190-003 synchronized concurrent callbacks for one provider identity: both mapping transactions are inside COMMIT-pending state before either is released.
    assert.equal(await subjectsForIssuer(), 0, "fresh issuer: zero subjects before the run");
    const one = await callbackFor("subject-a");
    const two = await callbackFor("subject-a");
    const settled = await Promise.allSettled([deliver(one.url), deliver(two.url)]);
    armed = false;
    const results = settled.map((entry) => { assert.equal(entry.status, "fulfilled", JSON.stringify(entry)); return success((entry as PromiseFulfilledResult<CompletionResult>).value); });
    assert.equal(results[0]!.accountSubjectId, results[1]!.accountSubjectId, "both callbacks resolve the same subject");
    assert.ok(retries.length >= 1, `the losing transaction restarted from step 1 (retries: ${JSON.stringify(retries)})`);
    assert.ok(retries.every(([, sqlState]) => ["23505", "40001", "40P01"].includes(sqlState ?? "")), JSON.stringify(retries));
    assert.equal(await subjectsForIssuer(), 1);
    assert.equal(await bindingsForIssuer(), 1);
    assert.equal(await profilesForIssuer("active"), 1);
    assert.equal(await sessionsForIssuer(), 2, "one session per challenge");
    for (const { challengeId } of [one, two]) {
      const callback = (await admin.query("select processing_state, commit_at, session_handoff_id from identity_callback where challenge_id = $1", [challengeId])).rows[0]!;
      assert.equal(callback.processing_state, "handoff_ready");
      assert.ok(callback.commit_at, "finalized");
      const handoff = (await admin.query("select state, issued_session_reference, attempt_count from identity_session_handoff where challenge_id = $1", [challengeId])).rows[0]!;
      assert.equal(handoff.state, "consumed");
      assert.ok(handoff.issued_session_reference);
      assert.equal(Number(handoff.attempt_count), 1);
    }

    // CT-190-003 duplicate delivery of one already-committed challenge: the stored destination, no new session.
    const duplicate = success(await deliver(one.url));
    assert.equal(duplicate.firstDelivery, false);
    assert.deepEqual(duplicate.setCookie, []);
    assert.equal(await sessionsForIssuer(), 2);

    // CT-190-002 existing immutable subject.
    const again = success(await deliver((await callbackFor("subject-a")).url));
    assert.equal(again.accountSubjectId, results[0]!.accountSubjectId);
    assert.equal(await subjectsForIssuer(), 1);
    assert.equal(await sessionsForIssuer(), 3);
    const cookie = cookieValueFrom(again.setCookie, SESSION_COOKIE_NAME)!;
    const view = await ceremony.view(cookie);
    assert.equal(view?.accountSubjectId, again.accountSubjectId);

    // Distinct provider subject -> distinct account subject, still one active profile each.
    const other = success(await deliver((await callbackFor("subject-b")).url));
    assert.notEqual(other.accountSubjectId, again.accountSubjectId);
    assert.equal(await subjectsForIssuer(), 2);
    assert.equal(await profilesForIssuer("active"), 2);

    // CT-190-005 disabled subject: same binding, account_unavailable, no hand-off, no session, no remapping.
    await admin.query("update account_subject set lifecycle_state = 'disabled' where account_subject_id = $1", [other.accountSubjectId]);
    const disabled = await deliver((await callbackFor("subject-b")).url);
    assert.equal(disabled.kind, "outcome");
    assert.equal(disabled.kind === "outcome" && disabled.outcome, "account_unavailable");
    assert.equal(await count("select count(*) as n from identity_callback where terminal_outcome = 'account_unavailable' and account_subject_id = $1", [other.accountSubjectId]), 1);
    assert.equal(await subjectsForIssuer(), 2);
    assert.equal(await sessionsForIssuer(), 4);

    // CBD190-PROFILE-ATOMIC-001 at the database: a subject inserted without its profile is refused at COMMIT by the deferred trigger, inside the same seam the mapping uses.
    await assert.rejects(
      client.transaction({ isolation: "serializable" }, async (scoped) => { await scoped.platformInsert({ table: "account_subject", values: { lifecycle_state: "active" } }); }),
      (error: unknown) => (error as { sqlState?: string }).sqlState === "23514",
    );

    // AC02 sink inspection: no code, verifier, state, nonce or provider token in any identity/session row, evidence record or reliability event.
    const rows = await admin.query("select to_jsonb(c) as row from identity_callback c where environment_id = $1 union all select to_jsonb(h) from identity_session_handoff h join identity_binding b on b.identity_binding_id = h.identity_binding_id where b.issuer = $2 union all select to_jsonb(b) from identity_binding b where b.issuer = $2 union all select to_jsonb(s) from account_session s join identity_binding b on b.identity_binding_id = s.identity_binding_id where b.issuer = $2", ["test", issuerId]);
    const sinks = JSON.stringify({ rows: rows.rows, evidence: runtime.evidence, events, audit: runtime.audit?.snapshot() });
    for (const secret of secrets.filter((value) => value.length > 0)) assert.ok(!sinks.includes(secret), "credential material must be absent from every persisted row and log sink");
    assert.ok(!sinks.includes("eyJ"));
    assert.equal(issuer.familyCounts().issued, issuer.familyCounts().revoked, "every issued provider token family was revoked at the issuer");
  } finally {
    release();
    await apiPool.end();
    await admin.end();
  }
});
