/**
 * The display-identity read and its versioned write (`DI-91-065`; design
 * proposal SS9; `SEC-PK2-F08`).
 *
 * Two statements, both subject-scoped through the dedicated profile seam in
 * `profile.ts`, so `account_subject_id = $1` is composed by the layer and the
 * caller never supplies that predicate.
 *
 * **The read returns `display_name` and nothing else about the person.** Not
 * a contact, not a provider account, not another space. `DI-91-065` is the
 * whole surface other members of a shared space see, and the columns this
 * projection names are the whole of it: the profile's identity, its lifecycle
 * state, the display name, and the version.
 *
 * **The write advances `version`.** `budget_space_invitation_confirmation
 * .displayed_identity_version` is documented as `financial_profile.version`,
 * and the receipt proves which display identity the owner decided against
 * only if a change to `display_name` moves that version.
 * `PROTO-INVITATIONS-PK2-SEC-001` `SEC-PK2-F08` carried this into PK-5 as an
 * acceptance criterion because nothing in the migrations does it; this
 * function is where it is done. It is a compare-and-set on the version the
 * caller read, so two concurrent writers cannot both believe they set the
 * name, and it returns the new version or null when the row had moved on.
 */
import { integerValue, textValue } from "./budget-category.ts";
import type { QueryResult } from "./driver.ts";
import type { ProfileSelectQuery, ProfileUpdateQuery } from "./profile.ts";

export const FINANCIAL_PROFILE_TABLE = "financial_profile";

/**
 * SEC-F06-OBS1 / SEC-C190-OBS1: a name must carry no Unicode control (Cc) or
 * format (Cf) character. A bidi override (U+202E) or a zero-width character
 * (U+200B) inside a display name can visually reorder or spoof the sentence
 * that renders it. The one exception is U+200D ZERO WIDTH JOINER *inside an
 * emoji sequence* (between two pictographic characters, or after a skin-tone
 * modifier or VS16), which is how family and profession emoji are spelled;
 * a ZWJ anywhere else is rejected like any other Cf.
 *
 * The same test is duplicated, deliberately, in
 * `packages/budget-application/src/creation-proposals/normalize.ts`
 * (`normalizeName`): that package consumes `@cobudget/budget-domain/schedule`
 * only, so it cannot import this one. Change both together.
 */
const EMOJI_ZERO_WIDTH_JOINER = /(?<=(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|️))‍(?=\p{Extended_Pictographic})/gu;
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;

/** True when `value` contains a Cc or Cf character other than an emoji-sequence ZWJ. */
export function hasControlOrFormatCharacter(value: string): boolean {
  return CONTROL_OR_FORMAT.test(value.replace(EMOJI_ZERO_WIDTH_JOINER, ""));
}

/** The subset of a data-access client these statements need. */
export interface ProfileStatementClient {
  readonly profileSelect: (query: ProfileSelectQuery) => Promise<QueryResult>;
  readonly profileUpdate: (query: ProfileUpdateQuery) => Promise<QueryResult>;
}

/** The whole display identity of one subject. Deliberately four columns and no more. */
export interface FinancialProfileDisplayRow {
  readonly profile_id: string;
  readonly account_subject_id: string;
  readonly profile_state: string;
  readonly display_name: string | null;
  readonly version: number;
}

const DISPLAY_COLUMNS: readonly string[] = ["profile_id", "profile_state", "display_name", "version"];

function toRow(accountSubjectId: string, value: unknown): FinancialProfileDisplayRow {
  const row = value as Record<string, unknown>;
  return {
    profile_id: textValue(row.profile_id),
    account_subject_id: accountSubjectId,
    profile_state: textValue(row.profile_state),
    display_name: row.display_name === null || row.display_name === undefined ? null : textValue(row.display_name),
    version: integerValue(row.version),
  };
}

export async function readDisplayIdentity(
  client: ProfileStatementClient, accountSubjectId: string,
): Promise<FinancialProfileDisplayRow | null> {
  const result = await client.profileSelect({
    table: FINANCIAL_PROFILE_TABLE, accountSubjectId, columns: DISPLAY_COLUMNS,
  });
  const row = result.rows[0];
  return row === undefined ? null : toRow(accountSubjectId, row);
}

/** The longest display name the `M1` CHECK admits. */
export const MAX_DISPLAY_NAME_LENGTH = 80;

/**
 * Set (or clear) `display_name` and advance `version`, but only while the row
 * still carries `expectedVersion`. Returns the new version, or null when the
 * compare-and-set found nothing.
 */
export async function writeDisplayName(
  client: ProfileStatementClient, accountSubjectId: string, displayName: string | null, expectedVersion: number,
): Promise<number | null> {
  if (displayName !== null) {
    const trimmed = displayName.trim();
    if (trimmed.length === 0 || [...trimmed].length > MAX_DISPLAY_NAME_LENGTH) {
      throw new RangeError(`display_name must be 1 to ${MAX_DISPLAY_NAME_LENGTH} code points, or null`);
    }
    if (hasControlOrFormatCharacter(trimmed)) {
      throw new RangeError("display_name must not contain control or format characters");
    }
    displayName = trimmed;
  }
  const result = await client.profileUpdate({
    table: FINANCIAL_PROFILE_TABLE, accountSubjectId,
    set: {
      display_name: displayName,
      // SEC-PK2-F08: the version advances with the name, spelled this way round
      // deliberately (PK2FIX-F04).
      version: 1 + expectedVersion,
      updated_at: new Date().toISOString(),
    },
    conditions: [{ column: "version", value: expectedVersion }],
  });
  return (result.rowCount ?? 0) > 0 ? 1 + expectedVersion : null;
}

export function financialProfileDisplayStatements(client: ProfileStatementClient) {
  return {
    readDisplayIdentity: (accountSubjectId: string) => readDisplayIdentity(client, accountSubjectId),
    writeDisplayName: (accountSubjectId: string, displayName: string | null, expectedVersion: number) =>
      writeDisplayName(client, accountSubjectId, displayName, expectedVersion),
  };
}
