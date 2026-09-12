/**
 * What to apply, and the SQL that applies it.
 *
 * This module is where CBD-116-AC01 and AC02 actually live, and it is pure on
 * purpose: given the files on disk and the rows in the ledger it produces one
 * script and one verdict, with no database anywhere near it. Everything about
 * idempotence, ordering, and drift is therefore provable by a test rather than
 * by a demonstration someone has to re-run.
 *
 * Three decisions are worth reading before changing anything here.
 *
 * **One transaction for the whole pending set.** Not one per migration. A run
 * that fails on the fourth of six leaves the schema exactly as it was, and the
 * ledger with it, so "applied state lives in the database" (AC02) stays true
 * after a failure and not only after a success. The cost is that a migration
 * needing CREATE INDEX CONCURRENTLY cannot run here; that is a real
 * limitation, recorded in the README rather than hidden.
 *
 * **An advisory lock inside that transaction.** Two deploys racing is not
 * hypothetical -- it is what a retried pipeline does. `pg_advisory_xact_lock`
 * serialises them: the second waits for the first to commit, and cannot
 * interleave with it.
 *
 * Be precise about what that does and does not buy, because an earlier version
 * of this comment overstated it. The plan is computed from a ledger read in an
 * *earlier* psql session (commands.ts), before the lock is taken. So two
 * runners starting together both read the same empty ledger and both build the
 * same script. A commits; B waits, is released, and replays work that is
 * already done.
 *
 * What holds is safety. B's replay fails -- on `already exists`, or on the
 * ledger's `ordinal text PRIMARY KEY` -- inside its own transaction, which
 * rolls back. There is no corruption, no half-applied schema, and no duplicate
 * ledger row; the primary key is doing real work here, not decoration.
 *
 * What does not hold is liveness. B does not quietly find nothing pending; it
 * exits non-zero. In the retried-pipeline case above that is a failed retry,
 * not a safe no-op. Closing it means reading the ledger *inside* the locked
 * transaction, which requires the plan to be built after the lock rather than
 * before it -- a restructure into a single session, not a patch. It is a
 * follow-up to resolve before anything deploys with two concurrent runners.
 *
 * **Out-of-order arrivals are applied, not refused.** Two branches stamp
 * T1 < T2, T2 merges and deploys first, then T1 merges. Refusing T1 would mean
 * re-stamping a file that has already been reviewed, and would make every
 * parallel pair a merge-time conflict -- exactly what AC07's ordinals exist to
 * avoid. So T1 applies late, the ledger records the real order in `apply_seq`,
 * and `status` says it happened. The rule this buys, and it is a real one, is
 * that a migration may not assume the ordinal before it has already run.
 */

import type { MigrationFile } from "./catalog.ts";
import { compareNames } from "./naming.ts";
import type { Policy } from "./policy.ts";

export type AppliedRow = { readonly ordinal: string; readonly checksum: string };

export type Drift = {
  readonly kind: "checksum" | "missing";
  readonly ordinal: string;
  readonly message: string;
};

export type Plan = {
  readonly pending: readonly MigrationFile[];
  readonly alreadyApplied: readonly string[];
  /** Pending migrations whose ordinal precedes one already applied. */
  readonly outOfOrder: readonly string[];
  /** Applied migrations that changed or vanished. Non-empty means refuse. */
  readonly drift: readonly Drift[];
  /** Empty string when nothing is pending, which is the no-op of AC02. */
  readonly script: string;
};

/**
 * Quote a SQL string literal.
 *
 * Every value passed here is a file name, an ordinal, or a hex checksum, all
 * of which the file-name pattern already constrains to characters that cannot
 * end a literal. It is still quoted properly, because the next person to call
 * this will not have checked.
 */
export function quoteLiteral(value: string): string {
  if (value.includes("\0")) throw new Error("null byte in a SQL literal");
  return `'${value.replaceAll("'", "''")}'`;
}

export function planApply(
  files: readonly MigrationFile[],
  applied: readonly AppliedRow[],
  policy: Policy,
): Plan {
  const appliedByOrdinal = new Map(applied.map((row) => [row.ordinal, row.checksum]));
  const known = new Map(files.map((file) => [file.ordinal, file]));
  // Sorted here as well as in the catalog. The order migrations run in is the
  // one thing this function must not inherit from its caller.
  const ordered = [...files].sort(compareNames);

  const drift: Drift[] = [];
  for (const row of applied) {
    const file = known.get(row.ordinal);
    if (!file) {
      drift.push({
        kind: "missing",
        ordinal: row.ordinal,
        message: `${row.ordinal} is recorded as applied but is not in ${policy.migrationsDirectory}. `
          + "An applied migration is history; deleting it makes the ledger describe a schema no checkout "
          + "can reproduce.",
      });
      continue;
    }
    if (file.checksum !== row.checksum) {
      drift.push({
        kind: "checksum",
        ordinal: row.ordinal,
        message: `${file.fileName} changed after it was applied (ledger ${row.checksum.slice(0, 12)}, `
          + `file ${file.checksum.slice(0, 12)}). Migrations are forward-only: edit forward in a new `
          + "migration rather than in an applied one.",
      });
    }
  }

  const pending = ordered.filter((file) => !appliedByOrdinal.has(file.ordinal));
  const alreadyApplied = ordered
    .filter((file) => appliedByOrdinal.has(file.ordinal))
    .map((file) => file.fileName);

  const highestApplied = [...appliedByOrdinal.keys()].sort().at(-1);
  const outOfOrder = highestApplied === undefined
    ? []
    : pending.filter((file) => file.ordinal < highestApplied).map((file) => file.fileName);

  return {
    pending,
    alreadyApplied,
    outOfOrder,
    drift,
    script: drift.length > 0 || pending.length === 0 ? "" : applyScript(pending, policy),
  };
}

export function applyScript(pending: readonly MigrationFile[], policy: Policy): string {
  const parts: string[] = [
    "-- Generated by @cobudget/migrations. Do not edit; edit the migrations.",
    "BEGIN;",
    `SELECT pg_advisory_xact_lock(${policy.advisoryLockKey});`,
    "",
  ];
  for (const file of pending) {
    parts.push(
      `-- ${"-".repeat(70)}`,
      `-- ${file.fileName}`,
      `-- ${"-".repeat(70)}`,
      file.source.trimEnd(),
      ";",
      `INSERT INTO ${policy.ledgerTable} (ordinal, name, checksum) VALUES (`
        + `${quoteLiteral(file.ordinal)}, ${quoteLiteral(file.fileName)}, ${quoteLiteral(file.checksum)});`,
      "",
    );
  }
  parts.push("COMMIT;", "");
  return parts.join("\n");
}

/**
 * Read the ledger, tolerating its absence.
 *
 * The ledger table is created by the first migration rather than by a bootstrap
 * step, so that its definition exists in exactly one place and is subject to
 * the same check as every other table. The cost is that this query has to cope
 * with a database where it does not exist yet, which a plain SELECT cannot:
 * it fails at parse time. Hence the temp table and the dynamic INSERT.
 */
export function readAppliedScript(policy: Policy): string {
  return [
    "CREATE TEMP TABLE cobudget_applied_state (ordinal text, checksum text);",
    "DO $cobudget_migrations$",
    "BEGIN",
    `  IF to_regclass('${policy.ledgerTable}') IS NOT NULL THEN`,
    "    EXECUTE 'INSERT INTO cobudget_applied_state (ordinal, checksum) "
      + `SELECT ordinal, checksum FROM ${policy.ledgerTable}';`,
    "  END IF;",
    "END",
    "$cobudget_migrations$;",
    "SELECT ordinal, checksum FROM cobudget_applied_state ORDER BY ordinal;",
    "",
  ].join("\n");
}

/** Parse psql's unaligned, tuples-only output of the query above. */
export function parseAppliedRows(output: string): readonly AppliedRow[] {
  const rows: AppliedRow[] = [];
  for (const line of output.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const separator = trimmed.indexOf("|");
    if (separator === -1) throw new Error(`unrecognised ledger row from psql: ${trimmed}`);
    rows.push({
      ordinal: trimmed.slice(0, separator).trim(),
      checksum: trimmed.slice(separator + 1).trim(),
    });
  }
  return rows;
}
