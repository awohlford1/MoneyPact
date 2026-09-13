/**
 * The local database, driven against fake docker and fake psql (CBD-117).
 *
 * What these prove without a container: the pin is read from exactly one
 * line of compose.yaml; a mismatched server refuses and names both
 * versions; the role names are the same in the initdb script, the grants
 * migration, and the code; and db:verify fails on each thing it checks.
 * What they cannot prove -- that the container starts, that the grants are
 * real, that api really is refused CREATE TABLE -- is the live run recorded
 * in the README.
 */

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import type { Io } from "./commands.ts";
import type { ExecutionResult, Executor } from "./executor.ts";
import { dbDestroy, dbSeed, dbStop, dbUp, dbVerify, dispatchLocal, localCommandNames, roles } from "./local.ts";
import type { LocalDeps, Role } from "./local.ts";
import { loadLocalDatabaseConfigFrom, localDatabaseConfigSchema, localDatabaseDefaults } from "./local-config.ts";
import { loadPolicy } from "./policy.ts";
import { composeFile, mismatchMessage, parseServerVersion, readPinnedMajor } from "./version.ts";

const policy = loadPolicy();
const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const initdb = readFileSync(join(packageRoot, "local/initdb/010-roles.psql"), "utf8");
const initdbWrapper = readFileSync(join(packageRoot, "local/initdb/010-roles.sh"), "utf8");
const grantsMigration = readdirSync(join(packageRoot, "migrations"))
  .filter((name) => name.endsWith("__grant_application_roles.sql"))
  .map((name) => readFileSync(join(packageRoot, "migrations", name), "utf8"));

// ---------------------------------------------------------------------------
// AC03: the pin
// ---------------------------------------------------------------------------

test("CBD-117-AC01 (cbd-117-fx-09): the bind-mounted initdb hooks are LF in every checkout", () => {
  // The hooks run inside the Linux container. A CRLF checkout makes the
  // shebang read "bash\r" and the container exits 127 before any role exists.
  for (const [name, text] of [["010-roles.sh", initdbWrapper], ["010-roles.psql", initdb]] as const) {
    assert.ok(!text.includes("\r"), `${name} contains a carriage return; check packages/migrations/.gitattributes`);
  }
  assert.ok(initdbWrapper.startsWith("#!/usr/bin/env bash\n") || initdbWrapper.startsWith("#!/bin/bash\n"), "the wrapper's shebang line must end in a bare LF");
  const attributes = readFileSync(join(packageRoot, ".gitattributes"), "utf8");
  assert.match(attributes, /^local\/initdb\/\*\.sh text eol=lf$/mu);
  assert.match(attributes, /^local\/initdb\/\*\.psql text eol=lf$/mu);
});

test("CBD-117-AC03: compose.yaml pins the PostgreSQL major exactly once, and the code reads that line", () => {
  const compose = readFileSync(composeFile, "utf8");
  const major = readPinnedMajor(compose);
  assert.ok(Number.isSafeInteger(major) && major >= 13, `implausible pin ${major}`);
  assert.equal((compose.match(/image:/gu) ?? []).length, 1, "one service, one image line");
  assert.ok(compose.includes("CBD-108"), "the pin says why it matches the intended host");
  assert.ok(compose.includes("CBD117-PG-MAJOR-001"), "the pin cites the Executive major-version decision");
});

test("CBD-117-AC03 (cbd-117-fx-02): a compose file with no pin, or two, is refused", () => {
  assert.throws(() => readPinnedMajor("services:\n  db:\n    image: postgres\n"), /exactly once/u);
  assert.throws(() => readPinnedMajor("image: postgres:17\nimage: postgres:16\n"), /found 2/u);
  assert.throws(() => readPinnedMajor("image: postgres:9\n"), /implausible/u);
});

test("CBD-117-AC03: a minor, a variant, quotes, or a trailing comment do not change the major", () => {
  assert.equal(readPinnedMajor('    image: "postgres:17.6"\n'), 17);
  assert.equal(readPinnedMajor("    image: postgres:17-alpine # why\n"), 17);
  assert.equal(readPinnedMajor("    image: 'postgres:18'\n"), 18);
});

test("CBD-117-AC03: the server version row parses, and the refusal names both versions", () => {
  assert.deepEqual(parseServerVersion("170011|17.11\n"), { major: 17, version: "17.11" });
  assert.deepEqual(parseServerVersion("160009|16.9 (Debian 16.9-1.pgdg120+1)\n"), {
    major: 16,
    version: "16.9 (Debian 16.9-1.pgdg120+1)",
  });
  assert.throws(() => parseServerVersion(""), /unrecognised server version/u);
  const message = mismatchMessage({ major: 16, version: "16.9" }, 17);
  assert.ok(message.includes("PostgreSQL 16.9") && message.includes("major 16") && message.includes("pins major 17"));
});

// ---------------------------------------------------------------------------
// AC05: the roles are one contract in three files
// ---------------------------------------------------------------------------

test("CBD-117-AC05: the initdb script creates exactly the three roles the code names, with LOGIN and nothing more", () => {
  const created = [...initdb.matchAll(/^CREATE ROLE\s+(\w+)\s+(LOGIN :role_option\s+:'[^']+');$/gmu)]
    .map((match) => [match[1], match[2]?.replaceAll(/\s+/gu, " ")] as const);
  assert.deepEqual(created.map(([name]) => name).sort(), Object.values(roles).sort());
  for (const [name, options] of created) {
    assert.ok(/^LOGIN :role_option :'(?:migration|api|worker)_password'$/u.test(options ?? ""), `${name}: ${options}`);
    assert.ok(!/SUPERUSER|CREATEDB|CREATEROLE|REPLICATION|BYPASSRLS/iu.test(options ?? ""), `${name} is over-privileged`);
  }
  assert.ok(initdb.includes(`ALTER DATABASE :"database_name" OWNER TO ${roles.migration};`));
});

test("CBD-117-AC04: the local credentials are obviously local, loopback only, and never secrets", () => {
  for (const password of [
    localDatabaseDefaults.superuserPassword,
    localDatabaseDefaults.migrationPassword,
    localDatabaseDefaults.apiPassword,
    localDatabaseDefaults.workerPassword,
  ]) {
    assert.ok(password.startsWith("local-only-") && password.length < 24, password);
  }
  const compose = readFileSync(composeFile, "utf8");
  for (const name of Object.keys(localDatabaseConfigSchema)) assert.ok(compose.includes(name), `${name} is not consumed by compose`);
  assert.ok(initdbWrapper.includes("COBUDGET_DB_MIGRATION_PASSWORD"));
  assert.ok(initdbWrapper.includes('--set="role_option=PASS""WORD"'));
  assert.ok(initdb.includes(":'migration_password'"), "role passwords are psql data variables, not SQL constants");
  assert.ok(/127\.0\.0\.1:\$\{COBUDGET_DB_PORT:-5432\}:5432/u.test(compose), "the port is bound to loopback only");
});

test("CBD-117-AC04: the shared loader validates overrides and supplies safe local defaults", () => {
  assert.deepEqual(loadLocalDatabaseConfigFrom({}), localDatabaseDefaults);
  assert.equal(loadLocalDatabaseConfigFrom({ COBUDGET_DB_PORT: "5544" }).port, 5544);
  assert.throws(() => loadLocalDatabaseConfigFrom({ COBUDGET_DB_PORT: "not-a-port" }), /COBUDGET_DB_PORT/u);
});

test("CBD-117-AC05: exactly one migration grants the application roles, and it names the same roles", () => {
  assert.equal(grantsMigration.length, 1);
  const source = grantsMigration[0] ?? "";
  assert.ok(source.includes(`GRANT USAGE ON SCHEMA public TO ${roles.worker}, ${roles.api};`));
  assert.ok(source.includes(`ALTER DEFAULT PRIVILEGES FOR ROLE ${roles.migration} IN SCHEMA public`));
  assert.ok(source.includes(`GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${roles.worker}, ${roles.api};`));
  assert.ok(!/GRANT[^;]*\b(?:CREATE|ALL)\b/u.test(source), "api and worker are never granted CREATE or ALL");
  assert.ok(!/cobudget_schema_migrations[^;]*TO cobudget_(?:api|worker)/u.test(source), "nothing on the ledger");
});

test("CBD-117: the initdb directory is not the migrations directory", () => {
  assert.ok(!policy.migrationsDirectory.includes("initdb"));
  assert.ok(!readdirSync(join(packageRoot, "migrations")).some((name) => name.endsWith("roles.sql") && !name.includes("grant")));
});

// ---------------------------------------------------------------------------
// The db commands against a fake docker and a fake server
// ---------------------------------------------------------------------------

type Fake = {
  composeCalls: string[][];
  composeStatus: number;
  serverVersion: string;
  runningBeforeUp: boolean;
  roleRows: string;
  ledgerExists: boolean;
  ddlOutcome: { status: number; stderr: string };
  defaultAcl: string;
  sent: { role: Role; sql: string }[];
};

function fake(): Fake {
  return {
    composeCalls: [],
    composeStatus: 0,
    serverVersion: "170011|17.11",
    runningBeforeUp: true,
    roleRows: `${roles.api}|t|f\n${roles.migration}|t|t\n${roles.worker}|t|f\n`,
    ledgerExists: true,
    ddlOutcome: { status: 3, stderr: "ERROR:  permission denied for schema public\n" },
    defaultAcl: "2\n",
    sent: [],
  };
}

function harness(state = fake()): { deps: LocalDeps; out: string[]; err: string[]; state: Fake } {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (line) => out.push(line), err: (line) => err.push(line) };
  const executorFor = (role: Role): Executor => ({
    describe: `fake ${role}`,
    run(sql: string): ExecutionResult {
      state.sent.push({ role, sql });
      if (sql.includes("server_version_num")) {
        if (!state.runningBeforeUp && state.composeCalls.length === 0) {
          return { status: 1, stdout: "", stderr: "service db is not running\n" };
        }
        return { status: 0, stdout: `${state.serverVersion}\n`, stderr: "" };
      }
      if (sql.includes("has_schema_privilege")) return { status: 0, stdout: state.roleRows, stderr: "" };
      if (sql.includes("to_regclass")) return { status: 0, stdout: state.ledgerExists ? "t\n" : "f\n", stderr: "" };
      if (sql.includes("pg_default_acl")) return { status: 0, stdout: state.defaultAcl, stderr: "" };
      if (/^(?:CREATE|ALTER) TABLE/u.test(sql)) {
        assert.notEqual(role, "migration", "verify never issues DDL as the migration role");
        return { status: state.ddlOutcome.status, stdout: "", stderr: state.ddlOutcome.stderr };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  });
  const deps: LocalDeps = {
    io,
    pinnedMajor: 17,
    databaseName: "cobudget_dev",
    compose: (args) => {
      state.composeCalls.push([...args]);
      return { status: state.composeStatus, stdout: "", stderr: state.composeStatus === 0 ? "" : "fake docker failure\n" };
    },
    executorFor,
  };
  return { deps, out, err, state };
}

test("CBD-117-AC01: db up starts the container, waits for health, and confirms the pinned major", () => {
  const { deps, out, state } = harness();
  state.runningBeforeUp = false;
  assert.equal(dbUp(deps), 0, out.join("\n"));
  assert.deepEqual(state.composeCalls, [["up", "--detach", "--wait"]]);
  assert.equal(state.sent.length, 2, "one pre-start probe and one post-start probe");
  assert.ok(out.some((line) => line.includes("major 17")), out.join("\n"));
});

test("CBD-117-AC03 (cbd-117-fx-03): db up fails startup when the running server is not the pinned major, naming both", () => {
  const { deps, err, state } = harness();
  state.runningBeforeUp = true;
  state.serverVersion = "160009|16.9";
  assert.equal(dbUp(deps), 1);
  const message = err.join("\n");
  assert.ok(message.includes("PostgreSQL 16.9") && message.includes("pins major 17"), message);
  assert.deepEqual(state.composeCalls, [], "a running mismatched container is refused before compose can recreate it");
});

test("CBD-117-AC01: db up reports a docker failure rather than pretending", () => {
  const { deps, err, state } = harness();
  state.runningBeforeUp = false;
  state.composeStatus = 1;
  assert.equal(dbUp(deps), 1);
  assert.equal(state.sent.length, 1, "only the harmless pre-start probe runs before a compose failure");
  assert.ok(err.join("\n").includes("could not start"), err.join("\n"));
});

test("CBD-117: db stop keeps the volume, db destroy removes it", () => {
  const down = harness();
  assert.equal(dbStop(down.deps), 0);
  assert.deepEqual(down.state.composeCalls, [["stop"]]);
  const destroy = harness();
  assert.equal(dbDestroy(destroy.deps), 0);
  assert.deepEqual(destroy.state.composeCalls, [["down", "--volumes"]]);
});

test("CBD-117-SEED-001: db seed is a stable no-op hook until a customer schema exists", () => {
  const seeded = harness();
  seeded.state.runningBeforeUp = true;
  assert.equal(dbSeed(seeded.deps), 0);
  assert.ok(seeded.out.join("\n").includes("0 rows loaded"));
  assert.equal(seeded.state.sent.length, 1, "seed only verifies the running server today");
});

test("CBD-117-AC05: db verify passes on a correctly provisioned database and probes DDL as api and worker only", () => {
  const { deps, out, state } = harness();
  assert.equal(dbVerify(deps), 0, out.join("\n"));
  const ddl = state.sent.filter((entry) => /^(?:CREATE|ALTER) TABLE/u.test(entry.sql));
  assert.deepEqual(ddl.map((entry) => entry.role), ["api", "api", "worker", "worker"]);
  assert.ok(ddl.some((entry) => entry.sql.startsWith("CREATE TABLE")) && ddl.some((entry) => entry.sql.startsWith("ALTER TABLE")));
});

test("CBD-117-AC05 (cbd-117-fx-04): db verify fails when a role is missing", () => {
  const { deps, err, state } = harness();
  state.roleRows = `${roles.api}|t|f\n${roles.migration}|t|t\n`;
  assert.equal(dbVerify(deps), 1);
  assert.ok(err.join("\n").includes(`role ${roles.worker} does not exist`), err.join("\n"));
});

test("CBD-117-AC05 (cbd-117-fx-05): db verify fails when api holds CREATE on the schema", () => {
  const { deps, err, state } = harness();
  state.roleRows = `${roles.api}|t|t\n${roles.migration}|t|t\n${roles.worker}|t|f\n`;
  assert.equal(dbVerify(deps), 1);
  assert.ok(err.join("\n").includes(`role ${roles.api} has USAGE=t CREATE=t`), err.join("\n"));
});

test("CBD-117-AC05 (cbd-117-fx-06): db verify fails when api is allowed DDL", () => {
  const { deps, err, state } = harness();
  state.ddlOutcome = { status: 0, stderr: "" };
  assert.equal(dbVerify(deps), 1);
  assert.ok(err.join("\n").includes("was allowed to CREATE TABLE"), err.join("\n"));
});

test("CBD-117-AC05 (cbd-117-fx-07): a DDL failure for any reason but permission is not a pass", () => {
  const { deps, err, state } = harness();
  state.ddlOutcome = { status: 2, stderr: "server closed the connection unexpectedly\n" };
  assert.equal(dbVerify(deps), 1);
  assert.ok(err.join("\n").includes("for a reason other than permission"), err.join("\n"));
});

test("CBD-117-AC05 (cbd-117-fx-08): db verify fails before the grants migration has run", () => {
  const { deps, err, state } = harness();
  state.ledgerExists = false;
  assert.equal(dbVerify(deps), 1);
  assert.ok(err.join("\n").includes("db:migrate"), err.join("\n"));
  const withoutDefaults = harness();
  withoutDefaults.state.defaultAcl = "0\n";
  assert.equal(dbVerify(withoutDefaults.deps), 1);
  assert.ok(withoutDefaults.err.join("\n").includes("no default table privileges"), withoutDefaults.err.join("\n"));
});

test("CBD-117: the db command table offers no way to reverse a migration", () => {
  for (const forbidden of policy.forwardOnly.forbiddenCommands) {
    assert.ok(!(localCommandNames as readonly string[]).includes(forbidden), `${forbidden} must not be a db command`);
  }
  const { deps, out, err } = harness();
  assert.equal(dispatchLocal(deps, ["rollback"]), 1);
  assert.ok(err.join("\n").includes('unknown db command "rollback"'));
  assert.ok(out.join("\n").includes("db:reset"), "help points at reset and re-migrate");
});
