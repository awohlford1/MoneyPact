/**
 * The `AE-73-25`/`AE-73-30` row builders and the disclosure-currency check,
 * as a leaf both the commands and the commit use.
 *
 * It is separate from `application.ts` for the reason `disclosure.ts` is
 * separate in the creation-confirmation module: `commit.ts` needs both, and
 * `application.ts` calls `commit.ts`, so putting them in `application.ts`
 * would make the module graph cyclic.
 */
import type { ConsentDisclosure } from "../creation-confirmation/disclosure.ts";
import {
  PrimaryTransferError, assertTransferAuditPayload,
} from "./records.ts";
import type { TransferAuditEvent, TransferEventSubtype } from "./records.ts";
import type { Clock, IdGenerator } from "./ports.ts";

/** The lifecycle event code of every transfer workflow outcome (CBD-73 SS14). */
export const TRANSFER_EVENT_CODE = "AE-73-25";
/** The mandatory-notice enqueue child. */
export const NOTICE_EVENT_CODE = "AE-73-30";

export interface TransferAuditInput {
  readonly budgetSpaceId: string;
  readonly eventCode: string;
  readonly eventSubtype?: TransferEventSubtype | null;
  readonly actorSubjectId?: string | null;
  readonly actingMembershipId?: string | null;
  readonly targetType: "primary_transfer" | "membership" | "consent" | "budget_space" | "notice" | "invitation";
  readonly targetId?: string | null;
  readonly result: "allow" | "deny" | "system";
  readonly reasonClass?: string | null;
  readonly policyVersion?: string | null;
  readonly policyDigest?: string | null;
  readonly correlationId: string;
  readonly audience: "customer" | "restricted";
  readonly payload?: Readonly<Record<string, unknown>>;
  /** Pre-allocated identifier, for the one event other rows have to reference before it is written. */
  readonly eventId?: string;
}

/** Build one allowlisted row. The payload allowlist is checked here, before the row exists. */
export function transferAuditEvent(
  deps: { readonly ids: IdGenerator; readonly clock: Clock }, input: TransferAuditInput,
): TransferAuditEvent {
  return {
    eventId: input.eventId ?? deps.ids.uuid(),
    budgetSpaceId: input.budgetSpaceId,
    eventCode: input.eventCode,
    eventSubtype: input.eventSubtype ?? null,
    occurredAt: deps.clock.now(),
    actorSubjectId: input.actorSubjectId ?? null,
    actingMembershipId: input.actingMembershipId ?? null,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    result: input.result,
    reasonClass: input.reasonClass ?? null,
    policyVersion: input.policyVersion ?? null,
    policyDigest: input.policyDigest ?? null,
    correlationId: input.correlationId,
    audience: input.audience,
    payload: assertTransferAuditPayload(input.payload ?? {}),
  };
}

/**
 * The registry's current entry for a kind, refused unless it is still the
 * version and digest the workflow captured at proposal (design SS10.3 step 2).
 *
 * A registry that moved under a live workflow means the two parties consented
 * to a text nobody would now be shown, so the commit denies `stale_disclosure`
 * having written nothing, and a new proposal is required.
 */
export function assertCurrentTransferDisclosure(
  deps: { readonly disclosures: { current: (kind: string) => ConsentDisclosure } },
  captured: { readonly kind: string; readonly version: number; readonly digest: string },
): ConsentDisclosure {
  let current: ConsentDisclosure;
  try {
    current = deps.disclosures.current(captured.kind);
  } catch {
    throw new PrimaryTransferError("stale_disclosure", "disclosure.kind");
  }
  if (current.version !== captured.version || current.digest !== captured.digest) {
    throw new PrimaryTransferError("stale_disclosure", "disclosure.version");
  }
  return current;
}
