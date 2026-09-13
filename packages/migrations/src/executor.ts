/**
 * Talking to PostgreSQL through psql.
 *
 * Why psql and not a driver: the connection is never read, parsed, or held by
 * this tool. psql resolves it with libpq's own rules -- PGHOST, PGPORT,
 * PGDATABASE, PGUSER, PGPASSWORD, PGSERVICE, PGSSLMODE, ~/.pgpass -- so the
 * password never passes through our process, never reaches a log line, never
 * appears in a command line visible to `ps`, and never has to be registered as
 * a variable this repository reads. The operator points psql at a database the
 * way they already point psql at a database.
 *
 * The cost is an external dependency on the PostgreSQL client, which is the
 * one piece of the tool that cannot be exercised without a server. Everything
 * that decides *what* to run is in plan.ts and is pure; this file only carries
 * bytes.
 */

import { spawnSync } from "node:child_process";

export type ExecutionResult = {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
};

export type Executor = {
  /** Run a SQL script and return its result. Never throws for SQL failure. */
  readonly run: (sql: string, label: string) => ExecutionResult;
  readonly describe: string;
};

/**
 * `ON_ERROR_STOP=1` is the flag that makes a script abort on the first error
 * instead of continuing and committing whatever happened to work. Without it,
 * a migration that half-failed would still reach COMMIT.
 *
 * `--no-psqlrc` keeps a developer's personal psqlrc -- a search_path, an
 * autocommit setting, a timing flag -- from changing what a migration does.
 */
const PSQL_ARGUMENTS = [
  "--no-psqlrc",
  "--quiet",
  "--tuples-only",
  "--no-align",
  "--field-separator=|",
  "--variable=ON_ERROR_STOP=1",
];

/**
 * `command` is the program to run and `prefix` the arguments that come before
 * psql's own. For the hosted path that is `psql` and nothing; for the local
 * database it is `docker compose ... exec -T db psql -U <role> -d <db>`, so
 * the same executor carries bytes into a container without the PostgreSQL
 * client being installed on the host (CBD-117-AC01). `hint` is appended to a
 * launch failure so the message says what to do, not only what went wrong.
 */
export function psqlExecutor(
  command = "psql",
  prefix: readonly string[] = [],
  hint = "Install the PostgreSQL client, or use the local database commands, which run psql inside the container.",
): Executor {
  const describe = prefix.length === 0
    ? `${command} (connection from the standard libpq environment)`
    : `${command} ${prefix.join(" ")}`;
  return {
    describe,
    run(sql: string): ExecutionResult {
      const result = spawnSync(command, [...prefix, ...PSQL_ARGUMENTS], {
        input: sql,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
      if (result.error) {
        return {
          status: 127,
          stdout: "",
          stderr: `could not run ${command}: ${result.error.message}\n${hint}\n`,
        };
      }
      return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
    },
  };
}
