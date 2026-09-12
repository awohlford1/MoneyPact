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

export function psqlExecutor(command = "psql"): Executor {
  return {
    describe: `${command} (connection from the standard libpq environment)`,
    run(sql: string): ExecutionResult {
      const result = spawnSync(command, PSQL_ARGUMENTS, {
        input: sql,
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      });
      if (result.error) {
        return {
          status: 127,
          stdout: "",
          stderr: `could not run ${command}: ${result.error.message}\n`
            + "Install the PostgreSQL client, or set the psql command in config/migrations.json.",
        };
      }
      return { status: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
    },
  };
}
