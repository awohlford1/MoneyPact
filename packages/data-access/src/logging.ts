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

export class StatementFailedError extends Error {
  readonly table: string;
  readonly operation: string;

  constructor(table: string, operation: string) {
    super(`statement on "${table}" failed (${operation}); see the database's own logs for detail`);
    this.name = "StatementFailedError";
    this.table = table;
    this.operation = operation;
  }
}

/**
 * Wrap a driver failure into one that is safe to log. The original error is
 * deliberately not attached as `cause` or logged here: a caller further up
 * the stack that logs `error.cause` or `error.message` recursively must not
 * be able to leak statement text through this seam.
 */
export function wrapDriverError(table: string, operation: string): StatementFailedError {
  return new StatementFailedError(table, operation);
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
