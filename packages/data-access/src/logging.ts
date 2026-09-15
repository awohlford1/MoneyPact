/**
 * CBD-246-AC06: the layer's log lines and error messages carry no statement
 * text or bound values.
 *
 * A raw driver error's `.message` can echo the failing SQL or a value it
 * rejected (a `pg` constraint-violation message, for instance, sometimes
 * includes the offending row). `wrapDriverError` is the one seam every
 * statement's failure passes through, and it never forwards that message
 * anywhere -- not to its own `.message`, not to a `cause`, not to a log call.
 * `logging.test.ts` proves this with a canary value planted in a fake
 * driver's error message.
 */

/** A PostgreSQL identifier as the driver reports it in the error's `constraint` field: never a value, never statement text. */
const CONSTRAINT_IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/u;

export class StatementFailedError extends Error {
  readonly table: string;
  readonly operation: string;
  readonly sqlState: string | undefined;
  /**
   * The name of the constraint or trigger-declared constraint that refused
   * the statement, when the driver reported one (CBD-200-AC04 conflict
   * mapping): a schema identifier and nothing else. A name outside the
   * identifier grammar is dropped rather than forwarded.
   */
  readonly constraint: string | undefined;

  constructor(table: string, operation: string, sqlState?: string, constraint?: string) {
    super(`statement on "${table}" failed (${operation}); see the database's own logs for detail`);
    this.name = "StatementFailedError";
    this.table = table;
    this.operation = operation;
    this.sqlState = typeof sqlState === "string" && /^[0-9A-Z]{5}$/u.test(sqlState) ? sqlState : undefined;
    this.constraint = typeof constraint === "string" && CONSTRAINT_IDENTIFIER.test(constraint) ? constraint : undefined;
  }
}

/**
 * Wrap a driver failure into one that is safe to log. The original error is
 * deliberately not attached as `cause` or logged here: a caller further up
 * the stack that logs `error.cause` or `error.message` recursively must not
 * be able to leak statement text through this seam.
 */
export function wrapDriverError(table: string, operation: string, error?: unknown): StatementFailedError {
  const code = error !== null && typeof error === "object" && "code" in error ? error.code : undefined;
  const constraint = error !== null && typeof error === "object" && "constraint" in error ? error.constraint : undefined;
  return new StatementFailedError(table, operation, typeof code === "string" ? code : undefined, typeof constraint === "string" ? constraint : undefined);
}

export function isRetryableSqlState(code: string | undefined): boolean {
  return code === "23505" || code === "40001" || code === "40P01";
}

export type LogFields = {
  readonly level: "debug" | "info" | "warn" | "error";
  readonly table: string;
  readonly operation: string;
  readonly durationMs?: number;
};

/**
 * The only fields the layer ever logs: a level, the table name, the
 * operation label a caller chose, and a duration. No SQL text, no bound
 * parameters, no row data -- there is no field here they could occupy.
 */
export function statementLogLine(fields: LogFields): string {
  const parts = [`level=${fields.level}`, `table=${fields.table}`, `operation=${fields.operation}`];
  if (fields.durationMs !== undefined) parts.push(`durationMs=${fields.durationMs}`);
  return parts.join(" ");
}
