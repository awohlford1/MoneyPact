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
import { NEUTRAL_DISPLAY_LABEL } from "@cobudget/budget-domain/shared";
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
 * a ZWJ anywhere else is rejected like any other Cf -- except that ZWJ and
 * U+200C ZERO WIDTH NON-JOINER are accepted between two letters or marks,
 * where several scripts use them orthographically (REV-NS-2).
 *
 * The same test is duplicated, deliberately, in
 * `packages/budget-application/src/creation-proposals/normalize.ts`
 * (`normalizeName`): that package consumes `@cobudget/budget-domain/schedule`
 * only, so it cannot import this one. Change both together.
 */
const EMOJI_ZERO_WIDTH_JOINER = /(?<=(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\uFE0F))\u200D(?=\p{Extended_Pictographic})/gu;
// REV-NS-2: U+200C ZWNJ and U+200D ZWJ are orthographic in Persian, Urdu, Sinhala, Malayalam and Tamil, so either is
// allowed when immediately between two letters or marks. At a string edge, next to a space, doubled, or beside any
// other Cc/Cf character they stay rejected. Both lookarounds read the original string, so a doubled joiner never
// qualifies through its twin.
const ORTHOGRAPHIC_JOINER = /(?<=[\p{L}\p{M}])[\u200C\u200D](?=[\p{L}\p{M}])/gu;
const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;

/** True when `value` contains a Cc or Cf character other than an emoji-sequence ZWJ or a between-letters ZWJ/ZWNJ. */
export function hasControlOrFormatCharacter(value: string): boolean {
  return CONTROL_OR_FORMAT.test(value.replace(EMOJI_ZERO_WIDTH_JOINER, "").replace(ORTHOGRAPHIC_JOINER, ""));
}

/** The longest display name the `M1` CHECK admits. */
export const MAX_DISPLAY_NAME_LENGTH = 80;

const WHITESPACE_RUN = /\p{White_Space}+/gu;
const LEADING_TRAILING_WHITESPACE = /^\p{White_Space}+|\p{White_Space}+$/gu;
/**
 * SEC-NS-R1: everything that renders as nothing. Whitespace, combining marks
 * (Mn/Mc/Me), format characters, the variation selectors (U+FE00..FE0F,
 * U+E0100..E01EF), the Hangul fillers (U+3164, U+FFA0, U+115F, U+1160) and
 * U+2800 BRAILLE PATTERN BLANK. A name with nothing left once these are removed
 * has no visible grapheme and is refused. Duplicated, deliberately, in
 * `packages/budget-application/src/creation-proposals/normalize.ts`; change both together.
 */
const INVISIBLE = /[\p{White_Space}\p{M}\p{Cf}\uFE00-\uFE0F\u{E0100}-\u{E01EF}\u3164\uFFA0\u115F\u1160\u2800]/gu;

/**
 * SEC-NS-R1: NFC, then every `\p{White_Space}` run (NBSP, U+3000, the thin
 * spaces, line separators) collapsed to one U+0020, then trimmed. Applied by
 * every display-name writer before its checks, so `"Alex\u00A0W."` is stored
 * as `"Alex W."` and an NBSP-only name is empty. Idempotent.
 */
export function normalizeDisplayName(value: string): string {
  return value.normalize("NFC").replace(WHITESPACE_RUN, " ").replace(LEADING_TRAILING_WHITESPACE, "");
}

/** Why a normalized display name is refused; every reason answers with the same `display_name_invalid` envelope. */
export type DisplayNameRejection = "length" | "control_or_format" | "no_visible_grapheme" | "neutral_label";

/** SEC-NS-R2: NFKC, whitespace-collapsed, case-folded (`toUpperCase().toLowerCase()`, the closest JS has to full folding). */
function foldedForLabelComparison(value: string): string {
  return value.normalize("NFKC").replace(WHITESPACE_RUN, " ").replace(LEADING_TRAILING_WHITESPACE, "").toUpperCase().toLowerCase();
}
const FOLDED_NEUTRAL_LABEL = foldedForLabelComparison(NEUTRAL_DISPLAY_LABEL);

/**
 * The one display-name rule set, checked in this order on a name
 * `normalizeDisplayName` has already produced: the 1..80-code-point bound
 * (`M1`), no Cc/Cf (SEC-F06-OBS1 / SEC-C190-OBS1), at least one visible
 * grapheme (SEC-NS-R1), and not the neutral label "A MoneyPact member" in any
 * casing or compatibility spelling (SEC-NS-R2). `undefined` means accepted.
 * `PUT /v1/identity/me/display-name` maps every reason to `400
 * display_name_invalid`; the first-sign-in claim (`token.ts` `boundedName`)
 * maps every reason to an absent claim, never a sign-in failure.
 */
export function displayNameRejection(normalized: string): DisplayNameRejection | undefined {
  const length = [...normalized].length;
  if (length < 1 || length > MAX_DISPLAY_NAME_LENGTH) return "length";
  if (hasControlOrFormatCharacter(normalized)) return "control_or_format";
  if (normalized.replace(INVISIBLE, "").length === 0) return "no_visible_grapheme";
  if (foldedForLabelComparison(normalized) === FOLDED_NEUTRAL_LABEL) return "neutral_label";
  return undefined;
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

/**
 * Set (or clear) `display_name` and advance `version`, but only while the row
 * still carries `expectedVersion`. Returns the new version, or null when the
 * compare-and-set found nothing.
 */
export async function writeDisplayName(
  client: ProfileStatementClient, accountSubjectId: string, displayName: string | null, expectedVersion: number,
): Promise<number | null> {
  if (displayName !== null) {
    const normalized = normalizeDisplayName(displayName);
    switch (displayNameRejection(normalized)) {
      case "length": throw new RangeError(`display_name must be 1 to ${MAX_DISPLAY_NAME_LENGTH} code points, or null`);
      case "control_or_format": throw new RangeError("display_name must not contain control or format characters");
      case "no_visible_grapheme": throw new RangeError("display_name must contain a visible character");
      case "neutral_label": throw new RangeError("display_name must not be the neutral member label");
      case undefined: break;
    }
    displayName = normalized;
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
