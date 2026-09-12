/**
 * The commands, driven end to end against a fake server.
 *
 * The fake is deliberately dumb: it records the ledger inserts the generated
 * script contains and replays them as the applied state on the next read. That
 * is enough to exercise the only behaviours that can go wrong without a real
 * PostgreSQL -- apply from empty, apply again, refuse on a failed check,
 * refuse on drift, refuse a reset against the wrong database -- through the
 * same code path the real executor takes.
 *
 * What it cannot prove is that the SQL is valid PostgreSQL. That needs a
 * server, and is recorded in the README as the part of AC01 that a live
 * database has to confirm.
 */

import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { apply, check, commandNames, create, reset, status, usage } from "./commands.ts";
import type { Deps, Io } from "./commands.ts";
import type { ExecutionResult, Executor } from "./executor.ts";
import { loadPolicy } from "./policy.ts";

const policy = loadPolicy();
const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const realMigrations = join(packageRoot, "migrations");

type Fake = Executor & {
  readonly applied: Map<string, string>;
  readonly scripts: string[];
  databaseName: string;
  failNextApply: boolean;
};

function fakeDatabase(): Fake {
  const applied = new Map<string, string>();
  const scripts: string[] = [];
  const fake: Fake = {
    describe: "fake",
    applied,
    scripts,
    databaseName: "cobudget_dev",
    failNextApply: false,
    run(sql: string): ExecutionResult {
      scripts.push(sql);
      if (sql.startsWith("SELECT current_database()")) {
        return { status: 0, stdout: `${fake.databaseName}\n`, stderr: "" };
      }
      if (sql.includes("cobudget_applied_state")) {
        const rows = [...applied].sort().map(([ordinal, checksum]) => `${ordinal}|${checksum}`);
        return { status: 0, stdout: rows.length === 0 ? "" : `${rows.join("\n")}\n`, stderr: "" };
      }
      if (sql.includes("DROP SCHEMA public CASCADE")) {
        applied.clear();
        return { status: 0, stdout: "", stderr: "" };
      }
      if (fake.failNextApply) {
        fake.failNextApply = false;
        return { status: 3, stdout: "", stderr: "ERROR:  relation already exists\n" };
      }
      const pattern = new RegExp(
        `INSERT INTO ${policy.ledgerTable} \\(ordinal, name, checksum\\) VALUES \\('([^']+)', '[^']+', '([^']+)'\\);`,
        "gu",
      );
      for (const match of sql.matchAll(pattern)) applied.set(match[1] ?? "", match[2] ?? "");
      return { status: 0, stdout: "", stderr: "" };
    },
  };
  return fake;
}

type Harness = { deps: Deps; executor: Fake; out: string[]; err: string[]; directory: string };

function harness(source = realMigrations, now = new Date(Date.UTC(2027, 0, 15, 9, 30, 0))): Harness {
  const directory = mkdtempSync(join(tmpdir(), "cbd-116-cmd-"));
  cpSync(source, directory, { recursive: true });
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (line) => out.push(line), err: (line) => err.push(line) };
  const executor = fakeDatabase();
  return {
    directory,
    executor,
    out,
    err,
    deps: { policy, executor, io, now: () => now, directory, packageRoot },
  };
}

test("CBD-116-AC01: applying from an empty database applies every migration", () => {
  const { deps, executor, out } = harness();
  assert.equal(apply(deps), 0, out.join("\n"));
  const names = readdirSync(realMigrations).filter((name) => name.endsWith(".sql"));
  assert.equal(executor.applied.size, names.length);
  assert.ok(out.some((line) => line === `applied ${names.length} migration(s)`), out.join("\n"));
});

test("CBD-116-AC02: applying twice is a no-op, not an error", () => {
  const { deps, executor, out } = harness();
  assert.equal(apply(deps), 0);
  const after = executor.scripts.length;
  out.length = 0;
  assert.equal(apply(deps), 0, "a second apply must succeed");
  assert.ok(out.some((line) => line.startsWith("nothing to apply")), out.join("\n"));
  assert.equal(executor.scripts.length, after + 1, "only the applied-state read is sent the second time");
});

test("CBD-116-AC02: applied state comes from the database, not from the tree", () => {
  const { deps, executor } = harness();
  apply(deps);
  // A second checkout of the same commit, pointed at the same database.
  const second = harness();
  second.executor.applied.clear();
  for (const [ordinal, checksum] of executor.applied) second.executor.applied.set(ordinal, checksum);
  assert.equal(apply(second.deps), 0);
  assert.ok(second.out.some((line) => line.startsWith("nothing to apply")), second.out.join("\n"));
});

test("a failed apply reports the rollback and records nothing", () => {
  const { deps, executor, err } = harness();
  executor.failNextApply = true;
  assert.equal(apply(deps), 1);
  assert.equal(executor.applied.size, 0);
  assert.ok(err.join("\n").includes("rolled back"), err.join("\n"));
});

test("an applied migration that is later edited stops the next apply", () => {
  const { deps, executor, directory, err } = harness();
  assert.equal(apply(deps), 0);
  const before = executor.applied.size;
  const name = readdirSync(directory).find((entry) => entry.endsWith(".sql"));
  assert.ok(name !== undefined);
  writeFileSync(join(directory, name), "-- scope: platform\nCREATE TABLE tampered (id uuid);\n");
  assert.equal(apply(deps), 1);
  assert.ok(err.join("\n").includes("changed after it was applied"), err.join("\n"));
  assert.equal(executor.applied.size, before, "nothing new was applied");
});

test("a migration that fails the check is never sent to the database", () => {
  const { deps, executor, directory, err } = harness();
  writeFileSync(join(directory, "20270101T000000Z__bad.sql"), "CREATE TABLE unscoped (id uuid);\n");
  assert.equal(apply(deps), 1);
  assert.deepEqual(executor.scripts, [], "not one statement reached the server");
  assert.ok(err.join("\n").includes("refusing to apply"), err.join("\n"));
});

test("status lists applied and pending without changing anything", () => {
  const { deps, executor, out } = harness();
  assert.equal(status(deps), 0);
  assert.ok(out.some((line) => line.trim().startsWith("pending")), out.join("\n"));
  assert.equal(executor.applied.size, 0);
  apply(deps);
  out.length = 0;
  assert.equal(status(deps), 0);
  assert.ok(out.some((line) => line.trim().startsWith("applied")), out.join("\n"));
});

test("check passes on the shipped migrations and touches no database", () => {
  const { deps, executor, out } = harness();
  assert.equal(check(deps), 0, out.join("\n"));
  assert.deepEqual(executor.scripts, []);
});

test("create stamps a file the pattern accepts, and never overwrites one", () => {
  const { deps, directory, out } = harness();
  assert.equal(create(deps, "Add budget space table"), 0);
  const created = readdirSync(directory).filter((name) => name.includes("add_budget_space_table"));
  assert.deepEqual(created, ["20270115T093000Z__add_budget_space_table.sql"]);
  // Same clock, second call: the ordinal advances rather than the file being
  // overwritten, so two commands in one script cannot collide (AC07).
  assert.equal(create(deps, "Add budget space table"), 0);
  assert.equal(readdirSync(directory).filter((name) => name.includes("add_budget_space_table")).length, 2);
  assert.ok(out.some((line) => line.includes("20270115T093001Z")), out.join("\n"));
});

test("create refuses a description that produces no slug", () => {
  const { deps, err } = harness();
  assert.equal(create(deps, "  ***  "), 1);
  assert.ok(err.join("\n").includes("needs a description"));
});

test("CBD-116-AC03: reset is refused without the confirmation flag", () => {
  const { deps, executor, err } = harness();
  assert.equal(reset(deps, []), 1);
  assert.deepEqual(executor.scripts, []);
  assert.ok(err.join("\n").includes(policy.reset.confirmFlag));
});

test("CBD-116-AC03: reset is refused against a database that is not a local one", () => {
  const { deps, executor, err } = harness();
  executor.databaseName = "cobudget_production";
  assert.equal(reset(deps, [policy.reset.confirmFlag]), 1);
  assert.ok(!executor.scripts.some((sql) => sql.includes("DROP SCHEMA")), "nothing was dropped");
  assert.ok(err.join("\n").includes("refusing to reset"), err.join("\n"));
});

test("CBD-116-AC03: reset and re-migrate is the recovery path, and it works", () => {
  const { deps, executor, out } = harness();
  assert.equal(apply(deps), 0);
  const applied = executor.applied.size;
  assert.equal(reset(deps, [policy.reset.confirmFlag]), 0, out.join("\n"));
  assert.equal(executor.applied.size, applied, "every migration was applied again from empty");
  assert.ok(executor.scripts.some((sql) => sql.includes("DROP SCHEMA public CASCADE")));
});

test("CBD-116-AC03: no command reverses a migration", () => {
  // The criterion is that no down-migration path exists, which is a statement
  // about the command table rather than about this release's intentions.
  for (const forbidden of policy.forwardOnly.forbiddenCommands) {
    assert.ok(!commandNames.includes(forbidden as (typeof commandNames)[number]),
      `${forbidden} must not be a command`);
  }
  assert.deepEqual([...commandNames].sort(), ["apply", "check", "create", "reset", "status"]);
  const help = usage(policy);
  assert.ok(help.includes("There is no revert command"));
  for (const forbidden of policy.forwardOnly.forbiddenCommands) {
    assert.ok(!new RegExp(`^\\s+${forbidden}\\s`, "mu").test(help), `${forbidden} is offered in the help`);
  }
});
