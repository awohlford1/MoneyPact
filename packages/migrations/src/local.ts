/**
 * The local development database (CBD-117).
 *
 * Everything that is true only of the container lives here: the compose
 * file, the service and database names, the three roles, and the commands
 * that start, stop, destroy, and verify it. The migration commands themselves
 * do not know they are talking to a container; they are handed an executor
 * that runs psql inside it, and behave exactly as they do against a hosted
 * server (CBD-19: a migration runs identically locally and hosted).
 *
 * Why psql runs inside the container rather than on the host: a fresh clone
 * must reach a migrated database with no manual installation (AC01), and the
 * PostgreSQL client is an installation. Inside the container psql is already
 * there, and it connects over the Unix socket as the role it is asked for,
 * with no password crossing the host at all.
 *
 * Why no environment variable is read here: the environment contract's guard
 * (scripts/check-environment.mjs) forbids reading the environment anywhere
 * but the shared loaders, and this package has none. Everything the local
 * database needs is a constant in the compose file or below; the only knob,
 * the host port, is interpolated by compose itself.
 */

import { spawnSync } from "node:child_process";

import type { ExecutionResult, Executor } from "./executor.ts";
import { psqlExecutor } from "./executor.ts";
import type { Io } from "./commands.ts";
import { composeFile, mismatchMessage, parseServerVersion, serverVersionScript } from "./version.ts";

export const composeService = "db";
export const localDatabaseName = "cobudget_dev";

/**
 * DP-105-003's three roles, by the names the initdb script creates and the
 * grants migration references. The names are a contract with hosted
 * provisioning (CBD-119): the grants migration names them, so the hosted
 * roles must be called the same thing.
 */
const ROLE_PREFIX = "cobudget_";
export const roles = {
  migration: `${ROLE_PREFIX}migration`,
  api: `${ROLE_PREFIX}api`,
  worker: `${ROLE_PREFIX}worker`,
} as const;

export type Role = keyof typeof roles;

const NOT_RUNNING_HINT =
  "The local database is not running or Docker is not reachable. "
  + "Start it with: npm run db:up --workspace=@cobudget/migrations";

/** `docker compose -f <compose.yaml> <args...>`. */
export function composeArguments(args: readonly string[]): readonly string[] {
  return ["compose", "-f", composeFile, ...args];
}

/** An executor that runs psql inside the container as the given role. */
export function localExecutor(role: Role, database = localDatabaseName): Executor {
  const prefix = composeArguments(["exec", "-T", composeService, "psql", "-U", roles[role], "-d", database]);
  const inner = psqlExecutor("docker", prefix, NOT_RUNNING_HINT);
  return {
    describe: `psql inside the ${composeService} container as ${roles[role]}`,
    run(sql, label) {
      const result = inner.run(sql, label);
      // docker's own failures (daemon down, service not running) arrive as a
      // non-zero exit with the reason on stderr; the hint says what to do.
      if (result.status !== 0 && /not running|docker api|docker daemon|no such service|Cannot connect/iu.test(result.stderr)) {
        return { ...result, stderr: `${result.stderr.trim()}\n${NOT_RUNNING_HINT}\n` };
      }
      return result;
    },
  };
}

/** Run `docker compose ...` with output streamed to the terminal. */
export function runCompose(args: readonly string[]): ExecutionResult {
  const result = spawnSync("docker", composeArguments(args), { stdio: "inherit" });
  if (result.error) {
    return { status: 127, stdout: "", stderr: `could not run docker: ${result.error.message}\n${NOT_RUNNING_HINT}\n` };
  }
  return { status: result.status ?? 1, stdout: "", stderr: "" };
}

export type LocalDeps = {
  readonly io: Io;
  readonly pinnedMajor: number;
  readonly compose: (args: readonly string[]) => ExecutionResult;
  readonly executorFor: (role: Role) => Executor;
};

export const OK = 0;
export const FAILED = 1;

function fail(deps: LocalDeps, message: string): number {
  deps.io.err(message);
  return FAILED;
}

/**
 * Start the database and confirm it is the pinned major (AC01, AC03).
 *
 * `--wait` blocks until the healthcheck passes, and the healthcheck is over
 * TCP so it cannot pass while the initdb scripts are still running against
 * the socket-only bootstrap server. On a first start the roles therefore
 * exist by the time this returns.
 */
export function dbUp(deps: LocalDeps): number {
  const started = deps.compose(["up", "--detach", "--wait"]);
  if (started.status !== 0) {
    return fail(deps, `could not start the local database (docker compose exited ${started.status}). `
      + `${started.stderr.trim()}`.trim());
  }
  const version = verifyVersion(deps);
  if (version !== undefined) return fail(deps, version);
  deps.io.out(`local database is up: PostgreSQL major ${deps.pinnedMajor} as pinned in compose.yaml, `
    + `database ${localDatabaseName}, loopback only`);
  deps.io.out("next: npm run db:migrate --workspace=@cobudget/migrations");
  return OK;
}

/** Stop the container. The volume, and with it every row, survives. */
export function dbStop(deps: LocalDeps): number {
  const stopped = deps.compose(["stop"]);
  if (stopped.status !== 0) return fail(deps, `could not stop the local database: ${stopped.stderr.trim()}`);
  deps.io.out("local database stopped; its data is kept. db:up starts it again, db:destroy deletes it.");
  return OK;
}

/** Remove the container and its volume. The next db:up initialises from nothing. */
export function dbDestroy(deps: LocalDeps): number {
  const removed = deps.compose(["down", "--volumes"]);
  if (removed.status !== 0) return fail(deps, `could not destroy the local database: ${removed.stderr.trim()}`);
  deps.io.out("local database destroyed, volume included; the next db:up creates it from scratch");
  return OK;
}

/** Undefined when the server's major matches the pin; otherwise the refusal. */
function verifyVersion(deps: LocalDeps): string | undefined {
  const result = deps.executorFor("migration").run(serverVersionScript, "server version");
  if (result.status !== 0) return `could not read the server version: ${result.stderr.trim()}`;
  try {
    const server = parseServerVersion(result.stdout);
    return server.major === deps.pinnedMajor ? undefined : mismatchMessage(server, deps.pinnedMajor);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** Pipe-separated rows from psql, trimmed, blank lines dropped. */
function rowsOf(stdout: string): readonly (readonly string[])[] {
  return stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => line.split("|").map((cell) => cell.trim()));
}

const DDL_PROBES: readonly { readonly what: string; readonly sql: string }[] = [
  { what: "CREATE TABLE", sql: "CREATE TABLE cobudget_role_probe (id integer);\n" },
  {
    what: "ALTER TABLE",
    sql: "ALTER TABLE cobudget_schema_migrations ADD COLUMN cobudget_role_probe integer;\n",
  },
];

/**
 * Prove the local database is the one the criteria describe (AC03, AC05).
 *
 * 1. The server's major is the pinned one.
 * 2. The three roles exist, api and worker can use the application schema
 *    but not create in it, and the migration role can do both.
 * 3. The ledger exists, so the grants migration has run.
 * 4. api and worker are refused CREATE TABLE and ALTER TABLE outright. Each
 *    probe is a statement that would have changed the schema had it been
 *    allowed, so a pass here is a permission denial and nothing else.
 * 5. The migration role's default privileges for future tables exist, which
 *    is what gives api and worker data-manipulation rights on every table a
 *    later migration creates.
 *
 * This is the local half of CBD-19-AC07; the test tier that runs against it
 * is CBD-246's.
 */
export function dbVerify(deps: LocalDeps): number {
  const version = verifyVersion(deps);
  if (version !== undefined) return fail(deps, version);
  const migration = deps.executorFor("migration");

  const roleRows = migration.run(
    "SELECT rolname, has_schema_privilege(rolname, 'public', 'USAGE'), "
      + "has_schema_privilege(rolname, 'public', 'CREATE') FROM pg_roles "
      + `WHERE rolname IN ('${roles.api}', '${roles.worker}', '${roles.migration}') ORDER BY rolname;\n`,
    "roles",
  );
  if (roleRows.status !== 0) return fail(deps, `could not list roles: ${roleRows.stderr.trim()}`);
  const seen = new Map(rowsOf(roleRows.stdout).map((row) => [row[0] ?? "", { usage: row[1], create: row[2] }]));
  const expected: readonly [string, string, string][] = [
    [roles.api, "t", "f"],
    [roles.worker, "t", "f"],
    [roles.migration, "t", "t"],
  ];
  for (const [name, usage, create] of expected) {
    const row = seen.get(name);
    if (!row) return fail(deps, `role ${name} does not exist; the initdb script did not run. db:destroy then db:up.`);
    if (row.usage !== usage || row.create !== create) {
      return fail(deps, `role ${name} has USAGE=${row.usage} CREATE=${row.create} on schema public; `
        + `expected USAGE=${usage} CREATE=${create}. Has the grants migration been applied?`);
    }
  }

  const ledger = migration.run("SELECT to_regclass('cobudget_schema_migrations') IS NOT NULL;\n", "ledger");
  if (ledger.status !== 0 || rowsOf(ledger.stdout)[0]?.[0] !== "t") {
    return fail(deps, "the ledger table does not exist yet: run npm run db:migrate --workspace=@cobudget/migrations first");
  }

  for (const role of ["api", "worker"] as const) {
    const executor = deps.executorFor(role);
    for (const probe of DDL_PROBES) {
      const result = executor.run(probe.sql, `${probe.what} as ${roles[role]}`);
      if (result.status === 0) {
        return fail(deps, `${roles[role]} was allowed to ${probe.what}; it must hold no schema-change right (DP-105-003)`);
      }
      if (!/permission denied|must be owner/iu.test(result.stderr)) {
        return fail(deps, `${roles[role]} ${probe.what} failed for a reason other than permission: ${result.stderr.trim()}`);
      }
    }
  }

  const defaults = migration.run(
    "SELECT count(*) FROM pg_default_acl d JOIN pg_roles r ON r.oid = d.defaclrole "
      + `WHERE r.rolname = '${roles.migration}' AND d.defaclobjtype = 'r';\n`,
    "default privileges",
  );
  if (defaults.status !== 0 || rowsOf(defaults.stdout)[0]?.[0] === "0") {
    return fail(deps, `no default table privileges are attached to ${roles.migration}; `
      + "tables a future migration creates would be unreadable by the application. Has the grants migration been applied?");
  }

  deps.io.out(`local database verified: PostgreSQL major ${deps.pinnedMajor} as pinned; `
    + `${roles.api} and ${roles.worker} hold USAGE but not CREATE on public and are refused `
    + `CREATE TABLE and ALTER TABLE; ${roles.migration} owns the schema; default privileges for future tables are set.`);
  return OK;
}

export const localCommandNames = ["up", "stop", "destroy", "verify"] as const;

export function localUsage(): string {
  return [
    "@cobudget/migrations db -- the local development database (CBD-117)",
    "",
    "  npm run db:up --workspace=@cobudget/migrations        start it and confirm the pinned major",
    "  npm run db:migrate --workspace=@cobudget/migrations   apply every migration inside the container",
    "  npm run db:status --workspace=@cobudget/migrations    applied and pending",
    "  npm run db:reset --workspace=@cobudget/migrations     drop everything and re-migrate",
    "  npm run db:verify --workspace=@cobudget/migrations    version, roles, and grants",
    "  npm run db:stop --workspace=@cobudget/migrations      stop; data kept",
    "  npm run db:destroy --workspace=@cobudget/migrations   remove container and volume",
    "",
    `The server is postgres:<major> from compose.yaml; the database is ${localDatabaseName}; `
      + `psql runs inside the container as ${roles.migration}.`,
  ].join("\n");
}

export function dispatchLocal(deps: LocalDeps, argv: readonly string[]): number {
  const [command] = argv;
  switch (command) {
    case "up":
      return dbUp(deps);
    case "stop":
      return dbStop(deps);
    case "destroy":
      return dbDestroy(deps);
    case "verify":
      return dbVerify(deps);
    default:
      if (command !== undefined) deps.io.err(`unknown db command "${command}"`);
      deps.io.out(localUsage());
      return FAILED;
  }
}
