/**
 * Tenant-scoped statements for `budget_space_invitation` (CBD-73 `DR-73-01`,
 * PK-2 migration `20260915T100001Z`), plus the two closed cross-space reads
 * the pre-authentication ceremony surfaces need.
 *
 * Every statement goes through the closed tenant API in `tenant.ts`, so
 * `budget_space_id = $1` is composed by the layer and never by a caller, and
 * every row read back is normalised to the plain JSON-safe shape the
 * application's persistence port expects.
 *
 * Two things are deliberate and are worth reading before the code.
 *
 * **`destination_ciphertext` is never selected.** `toRow` does not carry it
 * and `listInvitations`/`readInvitation` name their columns explicitly rather
 * than using `*`, so the envelope-encrypted address cannot reach the
 * application layer by accident. The one write that sets it takes it as a
 * separate argument.
 *
 * **The optimistic version is written, not computed in SQL.** The PK-2
 * trigger requires `state_version` to increase on every state change. The
 * tenant `set` map holds literal values, not expressions, so
 * {@link updateBudgetSpaceInvitation} takes the version it read and writes
 * `expectedStateVersion + 1` while predicating on `state_version =
 * expectedStateVersion`. A concurrent writer that got there first leaves this
 * update matching no row, which the application reads as a lost race rather
 * than as success.
 *
 * `locateInvitationCeremony` and `listLiveInvitationCodes` are the two closed
 * statements that answer "which budget space does this opaque value belong
 * to". They exist because `POST /v1/invitations/resolve` and every
 * ceremony-addressed route are pre-authentication surfaces that hold no
 * budget-space identifier, and the tables they read are budget-space scoped.
 * Each is a fixed statement with no caller-supplied predicate beyond one
 * bound parameter, in the shape of `readOwnBudgetMemberships` in
 * `budget-memberships.ts`, and each answers location only: no state, no
 * expiry, no role, and never the address or a raw value.
 */
import { instantText, integerValue, nullableInstantText, textValue } from "./budget-category.ts";
import type { TenantStatementClient } from "./budget-category.ts";
import type { Pool } from "./driver.ts";
import { wrapDriverError } from "./logging.ts";

export const BUDGET_SPACE_INVITATION_TABLE = "budget_space_invitation";
export const BUDGET_SPACE_TABLE = "budget_space";

/** Every column of the record except `destination_ciphertext`; see this file's header. */
export const BUDGET_SPACE_INVITATION_COLUMNS: readonly string[] = [
  "invitation_id", "budget_space_id", "kind", "created_by_membership_id", "created_by_subject_id",
  "required_permission", "creating_authorization_version", "channel_type", "destination_token",
  "destination_masked", "proposed_role", "resource_scope", "disclosure_kind", "disclosure_version",
  "disclosure_digest", "policy_version", "policy_digest", "invitation_version", "state", "state_version",
  "issued_at", "expires_at", "projection_inactive_at", "projection_state", "private_terminal_cause",
  "predecessor_invitation_id", "successor_invitation_id", "candidate_subject_id", "accepted_membership_id",
  // The receipt's key column is last for the reason PK2FIX-F04 gives.
  "commit_request_digest", "committed_response", "commit_idempotency_key",
];

export interface BudgetSpaceInvitationRow {
  readonly invitation_id: string;
  readonly budget_space_id: string;
  readonly kind: string;
  readonly created_by_membership_id: string;
  readonly created_by_subject_id: string;
  readonly required_permission: string;
  readonly creating_authorization_version: number;
  readonly channel_type: string;
  readonly destination_token: string;
  readonly destination_masked: string;
  readonly proposed_role: string;
  readonly resource_scope: string;
  readonly disclosure_kind: string;
  readonly disclosure_version: number;
  readonly disclosure_digest: string;
  readonly policy_version: string;
  readonly policy_digest: string;
  readonly invitation_version: number;
  readonly state: string;
  readonly state_version: number;
  readonly issued_at: string;
  readonly expires_at: string;
  readonly projection_inactive_at: string;
  readonly projection_state: string;
  readonly private_terminal_cause: string | null;
  readonly predecessor_invitation_id: string | null;
  readonly successor_invitation_id: string | null;
  readonly candidate_subject_id: string | null;
  readonly accepted_membership_id: string | null;
  readonly commit_idempotency_key: string | null;
  readonly commit_request_digest: string | null;
  readonly committed_response: unknown | null;
}

function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : textValue(value);
}

export function toBudgetSpaceInvitationRow(value: unknown): BudgetSpaceInvitationRow {
  const row = value as Record<string, unknown>;
  return {
    invitation_id: textValue(row.invitation_id),
    budget_space_id: textValue(row.budget_space_id),
    kind: textValue(row.kind),
    created_by_membership_id: textValue(row.created_by_membership_id),
    created_by_subject_id: textValue(row.created_by_subject_id),
    required_permission: textValue(row.required_permission),
    creating_authorization_version: integerValue(row.creating_authorization_version),
    channel_type: textValue(row.channel_type),
    destination_token: textValue(row.destination_token),
    destination_masked: textValue(row.destination_masked),
    proposed_role: textValue(row.proposed_role),
    resource_scope: textValue(row.resource_scope),
    disclosure_kind: textValue(row.disclosure_kind),
    disclosure_version: integerValue(row.disclosure_version),
    disclosure_digest: textValue(row.disclosure_digest),
    policy_version: textValue(row.policy_version),
    policy_digest: textValue(row.policy_digest),
    invitation_version: integerValue(row.invitation_version),
    state: textValue(row.state),
    state_version: integerValue(row.state_version),
    issued_at: instantText(row.issued_at),
    expires_at: instantText(row.expires_at),
    projection_inactive_at: instantText(row.projection_inactive_at),
    projection_state: textValue(row.projection_state),
    private_terminal_cause: nullableText(row.private_terminal_cause),
    predecessor_invitation_id: nullableText(row.predecessor_invitation_id),
    successor_invitation_id: nullableText(row.successor_invitation_id),
    candidate_subject_id: nullableText(row.candidate_subject_id),
    accepted_membership_id: nullableText(row.accepted_membership_id),
    commit_idempotency_key: nullableText(row.commit_idempotency_key),
    commit_request_digest: nullableText(row.commit_request_digest),
    committed_response: row.committed_response ?? null,
  };
}

export async function readBudgetSpaceInvitation(
  client: TenantStatementClient, budgetSpaceId: string, invitationId: string,
): Promise<BudgetSpaceInvitationRow | null> {
  const result = await client.tenantSelect({
    table: BUDGET_SPACE_INVITATION_TABLE, budgetSpaceId,
    columns: BUDGET_SPACE_INVITATION_COLUMNS,
    conditions: [{ column: "invitation_id", value: invitationId }],
  });
  const row = result.rows[0];
  return row === undefined ? null : toBudgetSpaceInvitationRow(row);
}

export async function listBudgetSpaceInvitations(
  client: TenantStatementClient, budgetSpaceId: string,
): Promise<readonly BudgetSpaceInvitationRow[]> {
  const result = await client.tenantSelect({
    table: BUDGET_SPACE_INVITATION_TABLE, budgetSpaceId, columns: BUDGET_SPACE_INVITATION_COLUMNS,
  });
  return result.rows.map(toBudgetSpaceInvitationRow);
}

/** The one write that sets `destination_ciphertext`. The ciphertext is an argument, never part of the row type. */
export async function insertBudgetSpaceInvitation(
  client: TenantStatementClient, row: BudgetSpaceInvitationRow, destinationCiphertext: Uint8Array,
): Promise<void> {
  const { budget_space_id, ...values } = row;
  await client.tenantInsert({
    table: BUDGET_SPACE_INVITATION_TABLE, budgetSpaceId: budget_space_id,
    values: {
      ...values,
      committed_response: values.committed_response === null ? null : JSON.stringify(values.committed_response),
      destination_ciphertext: Buffer.from(destinationCiphertext),
    },
  });
}

/**
 * Applies `set` while the record still carries `expectedStateVersion`,
 * advancing the version whenever `state` is among the columns written.
 * Returns rows changed: 0 is a lost optimistic race.
 */
export async function updateBudgetSpaceInvitation(
  client: TenantStatementClient, budgetSpaceId: string, invitationId: string,
  expectedStateVersion: number, set: Readonly<Record<string, unknown>>,
): Promise<number> {
  const advances = Object.prototype.hasOwnProperty.call(set, "state");
  const values: Record<string, unknown> = { ...set, updated_at: new Date().toISOString() };
  if (advances) values.state_version = 1 + expectedStateVersion;
  if (Object.prototype.hasOwnProperty.call(values, "committed_response") && values.committed_response !== null) {
    values.committed_response = JSON.stringify(values.committed_response);
  }
  const result = await client.tenantUpdate({
    table: BUDGET_SPACE_INVITATION_TABLE, budgetSpaceId, set: values,
    conditions: [
      { column: "invitation_id", value: invitationId },
      { column: "state_version", value: expectedStateVersion },
    ],
  });
  return result.rowCount ?? 0;
}

/**
 * The one read that returns `destination_ciphertext`. It exists for the two
 * callers the design names -- the delivery adapter and the masked-projection
 * reader -- and returns the envelope only; decryption is
 * `persistence/outbox-store.ts`'s and nothing else's.
 */
export async function readInvitationDestinationCiphertext(
  client: TenantStatementClient, budgetSpaceId: string, invitationId: string,
): Promise<Uint8Array | null> {
  const result = await client.tenantSelect({
    table: BUDGET_SPACE_INVITATION_TABLE, budgetSpaceId, columns: ["destination_ciphertext"],
    conditions: [{ column: "invitation_id", value: invitationId }],
  });
  const row = result.rows[0] as Record<string, unknown> | undefined;
  const value = row?.destination_ciphertext;
  if (value === undefined || value === null) return null;
  if (value instanceof Uint8Array) return value;
  throw new TypeError("expected bytea");
}

export interface BudgetSpaceFactsRow {
  readonly budget_space_id: string;
  readonly lifecycle: string;
}

export async function readBudgetSpaceFacts(client: TenantStatementClient, budgetSpaceId: string): Promise<BudgetSpaceFactsRow | null> {
  const result = await client.tenantSelect({
    table: BUDGET_SPACE_TABLE, budgetSpaceId, columns: ["budget_space_id", "lifecycle"],
  });
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return row === undefined ? null : { budget_space_id: textValue(row.budget_space_id), lifecycle: textValue(row.lifecycle) };
}

// ---------------------------------------------------------------------------
// The two closed cross-space locator statements.
// ---------------------------------------------------------------------------

export interface LiveCodeBindingRow {
  readonly budgetSpaceId: string;
  readonly invitationId: string;
  readonly invitationVersion: number;
  readonly destinationToken: string;
  readonly verifierDigest: string;
}

/**
 * Every real invitation's code row, with the binding material the verifier is
 * computed from. Never a raw value, never an address, never a state.
 *
 * `R-02`: the predicates this once carried (`disposition = 'active'`,
 * `expires_at > now()`, `state = 'pending'`) made a consumed, invalidated or
 * timestamp-expired code unlocatable, so `TR-73-14`'s restricted classes
 * `terminal_record` and `expired_record` and the resolve-time `TR-73-07`
 * materialization were unreachable in live composition even though the
 * in-memory locator exercised them. The port answers location only and the
 * transaction re-reads and re-checks every fact it acts on, so widening it
 * costs a longer scan and nothing else. The scan runs to completion in the
 * caller either way, so timing still does not depend on match position.
 */
export async function listLiveInvitationCodes(pool: Pick<Pool, "query">): Promise<readonly LiveCodeBindingRow[]> {
  try {
    const result = await pool.query(
      "SELECT c.budget_space_id, c.invitation_id, i.invitation_version, i.destination_token, c.verifier_digest "
        + "FROM budget_space_invitation_code c "
        + "JOIN budget_space_invitation i ON i.invitation_id = c.invitation_id "
        + "WHERE i.kind = 'real'",
      [],
    );
    return result.rows.map((value) => {
      const row = value as Record<string, unknown>;
      return {
        budgetSpaceId: textValue(row.budget_space_id),
        invitationId: textValue(row.invitation_id),
        invitationVersion: integerValue(row.invitation_version),
        destinationToken: textValue(row.destination_token),
        verifierDigest: textValue(row.verifier_digest),
      };
    });
  } catch (error) {
    throw wrapDriverError("budget_space_invitation_code", "select", error);
  }
}

/** Which record one ceremony id belongs to. Location only: no state, no expiry, no attachment. */
export async function locateInvitationCeremony(
  pool: Pick<Pool, "query">, ceremonyId: string,
): Promise<{ readonly budget_space_id: string; readonly invitation_id: string } | null> {
  if (typeof ceremonyId !== "string" || ceremonyId.trim().length === 0) return null;
  try {
    const result = await pool.query(
      "SELECT budget_space_id, invitation_id FROM budget_space_invitation_ceremony WHERE ceremony_id = $1",
      [ceremonyId],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row === undefined ? null : { budget_space_id: textValue(row.budget_space_id), invitation_id: textValue(row.invitation_id) };
  } catch (error) {
    throw wrapDriverError("budget_space_invitation_ceremony", "select", error);
  }
}

/** The statement subset the application's invitation adapter is composed from for this table. */
export function budgetSpaceInvitationStatements(client: TenantStatementClient) {
  return {
    readInvitation: (budgetSpaceId: string, invitationId: string) => readBudgetSpaceInvitation(client, budgetSpaceId, invitationId),
    listInvitations: (budgetSpaceId: string) => listBudgetSpaceInvitations(client, budgetSpaceId),
    insertInvitation: (row: BudgetSpaceInvitationRow, destinationCiphertext: Uint8Array) => insertBudgetSpaceInvitation(client, row, destinationCiphertext),
    updateInvitation: (budgetSpaceId: string, invitationId: string, expectedStateVersion: number, set: Readonly<Record<string, unknown>>) =>
      updateBudgetSpaceInvitation(client, budgetSpaceId, invitationId, expectedStateVersion, set),
    readBudgetSpace: (budgetSpaceId: string) => readBudgetSpaceFacts(client, budgetSpaceId),
  };
}

export { nullableInstantText };
