import { randomUUID } from "node:crypto";

import type {
  CapacityBucket,
  DurationBucket,
  ErrorClass,
  OperationClass,
  Outcome,
} from "@cobudget/contracts/telemetry";

/**
 * CBD-262-AC02: a trace span's attributes are drawn from the exact closed
 * unions `ReliabilityEvent` defines (`packages/contracts/src/telemetry/
 * reliability-event.ts`) -- no free-text field is reachable here any more
 * than it is on the event type itself. Adding an attribute means widening
 * that type first, the same discipline CBD-17 set for the event type.
 */
export interface ReliabilitySpanAttributes {
  readonly operation: OperationClass;
  readonly outcome?: Outcome;
  readonly errorClass?: ErrorClass;
  readonly durationBucket?: DurationBucket;
  readonly capacityBucket?: CapacityBucket;
}

/**
 * A span carries one correlation id tying its attributes together within a
 * single process's request lifetime.
 *
 * The id is:
 *  - never persisted to any durable store: nothing in this module, `sink.ts`,
 *    or `errors.ts` ever writes it to a log line, a database row, or a
 *    `ReliabilityEvent` -- that type has no field for one (see the union
 *    import above; there is no `correlationId` member to smuggle it through).
 *  - not derivable from any subject identifier: it is drawn fresh from
 *    `node:crypto`'s CSPRNG (`randomUUID`), which takes no input at all, so
 *    there is nothing to reverse and no lookup table that could map an id
 *    back to an account, session, or request. A reversible hash keyed on a
 *    subject id, or a table pairing the two, would both fail this
 *    requirement by construction; this module contains neither.
 */
export interface ReliabilitySpan extends ReliabilitySpanAttributes {
  readonly correlationId: string;
}

export function newCorrelationId(): string {
  return randomUUID();
}

/** Opens a span: attributes plus a fresh, non-persisted, non-derivable correlation id. */
export function openReliabilitySpan(attributes: ReliabilitySpanAttributes): ReliabilitySpan {
  return { ...attributes, correlationId: newCorrelationId() };
}
