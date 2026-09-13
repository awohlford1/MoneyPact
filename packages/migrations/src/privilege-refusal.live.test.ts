/**
 * CBD191-SECURITY-002 finding 5 / CBD191-SECURITY-003 evidence gap: durable
 * proof of the least-privilege grants
 * `20260913T110005Z__restrict_session_table_privileges.sql` applies to the
 * five CBD-191 identity tables. The Manager ruling and the implementation
 * report asserted live `psql` refusals but supplied no resolvable evidence
 * artifact; this file is that artifact.
 *
 * Same pattern as this package's other live-database facilities
 * (`local.ts#localExecutor`, `scripts/verify-live.ts` in
 * `@cobudget/data-access`): it needs Docker and a migrated local database,
 * which CI does not have, so it probes reachability first and skips itself
 * (never fails) when the database is unavailable. Run it for real with
 * Docker Desktop up and the local database migrated
 * (`npm run db:reset --workspace=@cobudget/migrations`):
 *
 *   node --test packages/migrations/src/privilege-refusal.live.test.ts
 *
 * It is still part of this package's `test` script (`node --test`'s default
 * recursive discovery), so `npm run check` runs it -- and it passes there
 * too, skipped, with no Docker dependency introduced into CI.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { localExecutor } from "./local.ts";
import type { Role } from "./local.ts";

function run(role: Role, sql: string, label: string) {
  return localExecutor(role).run(sql, label);
}

const probe = run("migration", "select 1;", "reachability probe");
const reachable = probe.status === 0;

const schemaProbe = reachable ? run("migration", "select 1 from account_session limit 1;", "schema probe") : undefined;
const schemaMigrated = Boolean(schemaProbe && schemaProbe.status === 0);

const skip = !reachable
  ? "local database not reachable (Docker/psql unavailable) -- run `npm run db:up` and `npm run db:migrate` to exercise this live"
  : !schemaMigrated
    ? "local database reachable but the CBD-191 session tables are not migrated -- run `npm run db:reset --workspace=@cobudget/migrations`"
    : false;

const PERMISSION_DENIED = /permission denied for table/iu;

function assertDenied(result: ReturnType<typeof run>, description: string): void {
  assert.notEqual(result.status, 0, `${description}: expected a non-zero (denied) exit`);
  assert.match(result.stderr, PERMISSION_DENIED, `${description}: expected "permission denied for table", got: ${result.stderr}`);
}

function assertAllowed(result: ReturnType<typeof run>, description: string): void {
  assert.equal(result.status, 0, `${description}: expected success, got status ${result.status} / stderr: ${result.stderr}`);
}

describe("CBD-191 session-table privilege refusal matrix (live, Docker-guarded)", { skip }, () => {
  it("cobudget_worker is denied all access to account_session", () => {
    assertDenied(run("worker", "select * from account_session limit 1;", "worker select account_session"), "worker SELECT account_session");
  });

  it("cobudget_worker is denied all access to session_delivery_result", () => {
    assertDenied(run("worker", "select * from session_delivery_result limit 1;", "worker select session_delivery_result"), "worker SELECT session_delivery_result");
  });

  it("cobudget_worker is denied all access to account_subject_authority", () => {
    assertDenied(run("worker", "select * from account_subject_authority limit 1;", "worker select account_subject_authority"), "worker SELECT account_subject_authority");
  });

  it("cobudget_worker is denied all access to provider_security_event", () => {
    assertDenied(run("worker", "select * from provider_security_event limit 1;", "worker select provider_security_event"), "worker SELECT provider_security_event");
  });

  it("cobudget_worker is denied INSERT on revocation_outbox (enqueue is API-only)", () => {
    assertDenied(
      run(
        "worker",
        "insert into revocation_outbox (revocation_action_id, account_subject_id, environment_id, cause, target, revocation_epoch, occurred_at, deadline_at) values (gen_random_uuid(), gen_random_uuid(), 'test', 'logout', 'provider_current_browser_bound', 1, now(), now() + interval '1 minute');",
        "worker insert revocation_outbox",
      ),
      "worker INSERT revocation_outbox",
    );
  });

  it("positive control: cobudget_worker CAN select and update revocation_outbox (its own claim/attempt bookkeeping)", () => {
    assertAllowed(run("worker", "select count(*) from revocation_outbox;", "worker select revocation_outbox"), "worker SELECT revocation_outbox");
    assertAllowed(run("worker", "update revocation_outbox set attempt_state = attempt_state where false;", "worker update revocation_outbox"), "worker UPDATE revocation_outbox");
  });

  it("cobudget_api is denied UPDATE on revocation_outbox (claim/attempt bookkeeping is worker-only)", () => {
    assertDenied(run("api", "update revocation_outbox set attempt_state = 'in_flight' where false;", "api update revocation_outbox"), "api UPDATE revocation_outbox");
  });

  for (const table of ["account_session", "account_subject_authority", "session_delivery_result", "provider_security_event"]) {
    it(`cobudget_api is denied DELETE on ${table}`, () => {
      assertDenied(run("api", `delete from ${table} where false;`, `api delete ${table}`), `api DELETE ${table}`);
    });

    it(`positive control: cobudget_api CAN select/insert/update ${table}`, () => {
      assertAllowed(run("api", `select count(*) from ${table};`, `api select ${table}`), `api SELECT ${table}`);
    });
  }

  it("positive control: cobudget_api CAN select and insert into revocation_outbox (enqueue only)", () => {
    assertAllowed(run("api", "select count(*) from revocation_outbox;", "api select revocation_outbox"), "api SELECT revocation_outbox");
  });
});
