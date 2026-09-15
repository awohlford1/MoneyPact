/**
 * CBD-190 identity amendments proposal §2 (`P6-F01`, `C190-N01`-`N05`) live
 * PostgreSQL proof, run through the real `@cobudget/data-access` client
 * against the migrated schema -- the same opt-in condition and harness shape
 * as `mapping.live.test.ts`. Provision and migrate the scratch database
 * first:
 *
 *   docker exec cobudget-db-1 psql -U postgres -c "CREATE DATABASE cobudget_identity_name_live"
 *   COBUDGET_DB_NAME=cobudget_identity_name_live npm run db:migrate --workspace=@cobudget/migrations
 *   cd apps/api && COBUDGET_DB_NAME=cobudget_identity_name_live npx tsx --test src/identity/first-sign-in-name.live.test.ts
 */
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { test } from "node:test";
import { loadLocalDatabaseConfig } from "@cobudget/migrations/local";
import { composeApiRuntime } from "../sessions/runtime.ts";
import type { CompletionResult, IdentityCeremony } from "./ceremony.ts";
import type { LocalIssuer, LocalScenario } from "./local-issuer.ts";
import { APPLICATION_ORIGIN, localConfig } from "./test-support/harness.ts";

const database = loadLocalDatabaseConfig();
const configured = database.database !== "cobudget_dev";

function success(result: CompletionResult): Extract<CompletionResult, { kind: "success" }> {
  assert.equal(result.kind, "success", JSON.stringify(result));
  return result as Extract<CompletionResult, { kind: "success" }>;
}

void test(
  "CBD-190 identity amendments proposal §2 live PostgreSQL: a first sign-in's name claim sets display_name once; a second sign-in with a different name never overwrites it",
  { skip: !configured, timeout: 60_000 },
  async () => {
    const { createApiConnection, createMigrationConnection } = await import("../../../../packages/data-access/src/connection.ts");
    const { bindClient } = await import("../../../../packages/data-access/src/binding.ts");
    const admin = createMigrationConnection();
    const apiPool = createApiConnection();
    const client = bindClient(apiPool, true);
    const port = randomInt(20_000, 60_000);
    const ceremonyOrigin = `http://127.0.0.1:${port}`;
    const issuerId = `${ceremonyOrigin}/v1/identity/local`;
    const config = localConfig({ COBUDGET_IDENTITY_CEREMONY_ORIGIN: ceremonyOrigin, COBUDGET_IDENTITY_ISSUER: issuerId });
    const events: unknown[] = [];
    const runtime = composeApiRuntime(config, (event) => { events.push(event); }, { client });
    const ceremony: IdentityCeremony = runtime.runtime!.ceremony;
    const issuer: LocalIssuer = runtime.localIssuer!;

    async function signIn(scenario: LocalScenario): Promise<CompletionResult> {
      const begun = await ceremony.begin({ ceremony: "sign_in", postResultDestinationId: "home", origin: APPLICATION_ORIGIN, secFetchSite: "same-origin", sessionCookie: undefined });
      assert.ok(begun.ok);
      const query = Object.fromEntries(new URL(begun.navigateTo).searchParams.entries());
      const hosted = issuer.authorize(query);
      assert.ok(hosted.ok);
      if (!hosted.ok) throw new Error("unreachable");
      const url = issuer.choose(hosted.requestId, scenario);
      assert.ok(url);
      const parsed = new URL(url!);
      return ceremony.complete({ rawQuery: parsed.search.slice(1), method: "GET", observedOrigin: parsed.origin, path: parsed.pathname, receiptTime: new Date() });
    }

    const displayNameOf = async (accountSubjectId: string): Promise<string | null> =>
      (await admin.query("select display_name from financial_profile where account_subject_id = $1", [accountSubjectId])).rows[0]!.display_name;

    try {
      // First use: the OIDC `name` claim (the local issuer's fixture value for `subject-a`) sets
      // display_name in the same transaction that creates the subject (CBD190-PROFILE-ATOMIC-001).
      const first = success(await signIn("subject-a"));
      assert.equal(await displayNameOf(first.accountSubjectId), "Ada A. Local");

      // Second sign-in, same immutable provider `sub`, a materially different valid name claim: the
      // mapping resolves the *existing* binding (§5.2 step 2's `else`), which never calls the
      // display-name write -- proven here against the real database, not the in-memory double.
      const second = success(await signIn("subject-a-second-name"));
      assert.equal(second.accountSubjectId, first.accountSubjectId, "the same subject resolves both times");
      assert.equal(await displayNameOf(second.accountSubjectId), "Ada A. Local", "the second sign-in's different name claim never overwrote the first");
      assert.equal(
        Number((await admin.query("select count(*) as n from financial_profile where account_subject_id = $1", [first.accountSubjectId])).rows[0]!.n),
        1,
        "still exactly one profile row for the subject",
      );

      // AC02/§2.5 sink inspection: the raw claim value never reaches a persisted row or a log sink.
      const rows = await admin.query(
        "select to_jsonb(c) as row from identity_callback c where environment_id = $1 union all select to_jsonb(h) from identity_session_handoff h join identity_binding b on b.identity_binding_id = h.identity_binding_id where b.issuer = $2",
        ["test", issuerId],
      );
      const sink = JSON.stringify({ rows: rows.rows, evidence: runtime.evidence, events });
      assert.ok(!sink.includes("Ada A. Local"), "the name claim never reaches identity_callback, identity_session_handoff, evidence or reliability telemetry");
    } finally {
      await apiPool.end();
      await admin.end();
    }
  },
);
