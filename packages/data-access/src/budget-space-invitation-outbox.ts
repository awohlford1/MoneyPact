/**
 * Identity-scoped statements for `budget_space_invitation_outbox` (design
 * proposal SS5.3): the simulated local delivery custody record.
 *
 * The table is classified `identity`, not `budget-space`, because the payload
 * is a person's contact address and the bearer sent to it rather than data
 * about the space -- so these statements go through the platform seam. The
 * three payload columns are `bytea` and hold the envelope-encrypted values
 * only; this module never sees a plaintext. `packages/budget-application/src/
 * persistence/outbox-store.ts` is the one place that encrypts and decrypts
 * them, and it is what the simulated adapter talks to.
 *
 * `tombstoneInvitationOutbox` clears all three payload columns in the same
 * statement that sets the tombstone, because the PK-2 CHECK admits only the
 * two whole states: a half-cleared row would leave a bearer readable past its
 * deadline.
 */
import { instantText, nullableInstantText, textValue } from "./budget-category.ts";
import type { QueryResult } from "./driver.ts";
import type { PlatformInsertQuery, PlatformSelectQuery, PlatformUpdateQuery } from "./tenant.ts";

export const BUDGET_SPACE_INVITATION_OUTBOX_TABLE = "budget_space_invitation_outbox";

/** The subset of a data-access client these statements need. */
export interface PlatformStatementClient {
  readonly platformSelect: (query: PlatformSelectQuery) => Promise<QueryResult>;
  readonly platformInsert: (query: PlatformInsertQuery) => Promise<QueryResult>;
  readonly platformUpdate: (query: PlatformUpdateQuery) => Promise<QueryResult>;
}

/** The row without its payload: what a caller other than the delivery adapter may see. */
export interface BudgetSpaceInvitationOutboxRow {
  readonly outbox_id: string;
  readonly invitation_id: string;
  readonly channel_type: string;
  readonly fidelity_label: string;
  readonly delivery_state: string;
  readonly rendered_at: string | null;
  readonly custody_deadline: string;
  readonly tombstoned_at: string | null;
  readonly tombstone_reason_class: string | null;
}

/** The row with its three ciphertexts, for the delivery adapter's decrypting store alone. */
export interface BudgetSpaceInvitationOutboxPayloadRow extends BudgetSpaceInvitationOutboxRow {
  readonly destination_ciphertext: Uint8Array | null;
  readonly bearer_ciphertext: Uint8Array | null;
  readonly challenge_ciphertext: Uint8Array | null;
}

const PROJECTION_COLUMNS: readonly string[] = [
  "outbox_id", "invitation_id", "channel_type", "fidelity_label", "delivery_state",
  "rendered_at", "custody_deadline", "tombstoned_at", "tombstone_reason_class",
];

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : textValue(value);
}

function toRow(value: unknown): BudgetSpaceInvitationOutboxRow {
  const row = value as Record<string, unknown>;
  return {
    outbox_id: textValue(row.outbox_id),
    invitation_id: textValue(row.invitation_id),
    channel_type: textValue(row.channel_type),
    fidelity_label: textValue(row.fidelity_label),
    delivery_state: textValue(row.delivery_state),
    rendered_at: nullableInstantText(row.rendered_at),
    custody_deadline: instantText(row.custody_deadline),
    tombstoned_at: nullableInstantText(row.tombstoned_at),
    tombstone_reason_class: nullableText(row.tombstone_reason_class),
  };
}

function bytes(value: unknown): Uint8Array | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Uint8Array) return value;
  throw new TypeError("expected bytea");
}

function toPayloadRow(value: unknown): BudgetSpaceInvitationOutboxPayloadRow {
  const row = value as Record<string, unknown>;
  return {
    ...toRow(row),
    destination_ciphertext: bytes(row.destination_ciphertext),
    bearer_ciphertext: bytes(row.bearer_ciphertext),
    challenge_ciphertext: bytes(row.challenge_ciphertext),
  };
}

export interface InvitationOutboxInsert {
  readonly outbox_id: string;
  readonly invitation_id: string;
  readonly channel_type: string;
  readonly destination_ciphertext: Uint8Array;
  readonly bearer_ciphertext: Uint8Array;
  readonly challenge_ciphertext: Uint8Array;
  readonly custody_deadline: string;
}

export async function insertInvitationOutbox(client: PlatformStatementClient, row: InvitationOutboxInsert): Promise<void> {
  await client.platformInsert({
    table: BUDGET_SPACE_INVITATION_OUTBOX_TABLE,
    values: {
      outbox_id: row.outbox_id,
      invitation_id: row.invitation_id,
      channel_type: row.channel_type,
      fidelity_label: "simulated",
      destination_ciphertext: Buffer.from(row.destination_ciphertext),
      bearer_ciphertext: Buffer.from(row.bearer_ciphertext),
      challenge_ciphertext: Buffer.from(row.challenge_ciphertext),
      delivery_state: "pending",
      custody_deadline: row.custody_deadline,
    },
  });
}

/** The payload-free projection. Every caller but the decrypting store uses this one. */
export async function readInvitationOutbox(
  client: PlatformStatementClient, invitationId: string,
): Promise<BudgetSpaceInvitationOutboxRow | null> {
  const result = await client.platformSelect({
    table: BUDGET_SPACE_INVITATION_OUTBOX_TABLE, columns: PROJECTION_COLUMNS,
    conditions: [{ column: "invitation_id", value: invitationId }],
  });
  const row = result.rows[0];
  return row === undefined ? null : toRow(row);
}

/** The privileged read. Only `persistence/outbox-store.ts` calls it, and only to decrypt. */
export async function readInvitationOutboxPayload(
  client: PlatformStatementClient, invitationId: string,
): Promise<BudgetSpaceInvitationOutboxPayloadRow | null> {
  const result = await client.platformSelect({
    table: BUDGET_SPACE_INVITATION_OUTBOX_TABLE,
    conditions: [{ column: "invitation_id", value: invitationId }, { column: "delivery_state", operator: "<>", value: "tombstoned" }],
  });
  const row = result.rows[0];
  return row === undefined ? null : toPayloadRow(row);
}

/** Every row still holding custody, for the developer-only surface and the custody sweep. */
export async function listLiveInvitationOutbox(client: PlatformStatementClient): Promise<readonly BudgetSpaceInvitationOutboxPayloadRow[]> {
  const result = await client.platformSelect({
    table: BUDGET_SPACE_INVITATION_OUTBOX_TABLE,
    conditions: [{ column: "delivery_state", operator: "<>", value: "tombstoned" }],
  });
  return result.rows.map(toPayloadRow);
}

export async function markInvitationOutboxRendered(client: PlatformStatementClient, invitationId: string, at: string): Promise<number> {
  const result = await client.platformUpdate({
    table: BUDGET_SPACE_INVITATION_OUTBOX_TABLE,
    set: { delivery_state: "rendered", rendered_at: at },
    conditions: [{ column: "invitation_id", value: invitationId }, { column: "delivery_state", value: "pending" }],
  });
  return result.rowCount ?? 0;
}

/** The tombstone and the erasure in one statement; the CHECK admits nothing in between. */
export async function tombstoneInvitationOutbox(
  client: PlatformStatementClient, invitationId: string, reasonClass: string, at: string,
): Promise<number> {
  const result = await client.platformUpdate({
    table: BUDGET_SPACE_INVITATION_OUTBOX_TABLE,
    set: {
      delivery_state: "tombstoned", tombstoned_at: at, tombstone_reason_class: reasonClass,
      destination_ciphertext: null, bearer_ciphertext: null, challenge_ciphertext: null,
    },
    conditions: [{ column: "invitation_id", value: invitationId }, { column: "delivery_state", operator: "<>", value: "tombstoned" }],
  });
  return result.rowCount ?? 0;
}
