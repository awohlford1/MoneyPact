/**
 * Unicode character classes and helpers shared by every name normalizer that
 * has to reject spoofing and invisible-only input: the display-name write in
 * `packages/data-access/src/financial-profile.ts`, the budget-name
 * normalization in `packages/budget-application/src/creation-proposals/normalize.ts`,
 * and the apps/web mock server (`apps/web/src/api/mock-server.ts`), which
 * emulates the same rejection so a mock-backed journey can exercise it. These
 * were three hand-synchronized copies (REV-NF-5, REV-NF-2); this module is the
 * one definition all three import.
 */

/**
 * SEC-F06-OBS1 / SEC-C190-OBS1: a name must carry no Unicode control (Cc) or
 * format (Cf) character. A bidi override (U+202E) or a zero-width character
 * (U+200B) inside a name can visually reorder or spoof the sentence that
 * renders it. The one exception is U+200D ZERO WIDTH JOINER *inside an emoji
 * sequence* (between two pictographic characters, or after a skin-tone
 * modifier or VS16), which is how family and profession emoji are spelled;
 * a ZWJ anywhere else is rejected like any other Cf -- except that ZWJ and
 * U+200C ZERO WIDTH NON-JOINER are accepted between two letters or marks,
 * where several scripts use them orthographically (REV-NS-2).
 *
 * REV-NS3-2: carries the `g` flag, so it carries `lastIndex` state across
 * calls. Use it only through `String.prototype.replace` (as
 * {@link hasControlOrFormatCharacter} does) or another stateless string
 * method -- never `.test()` or `.exec()`, which would read and advance that
 * state and can silently skip or duplicate a match on the next call.
 */
export const EMOJI_ZERO_WIDTH_JOINER =
  /(?<=(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|️))‍(?=\p{Extended_Pictographic})/gu;

// REV-NS-2: U+200C ZWNJ and U+200D ZWJ are orthographic in Persian, Urdu, Sinhala, Malayalam and Tamil, so either is
// allowed when immediately between two letters or marks. At a string edge, next to a space, doubled, or beside any
// other Cc/Cf character they stay rejected. Both lookarounds read the original string, so a doubled joiner never
// qualifies through its twin.
//
// REV-NS3-2: carries the `g` flag, so it carries `lastIndex` state across calls. Use it only
// through `String.prototype.replace` or another stateless string method -- never `.test()` or
// `.exec()`.
export const ORTHOGRAPHIC_JOINER = /(?<=[\p{L}\p{M}])[‌‍](?=[\p{L}\p{M}])/gu;

export const CONTROL_OR_FORMAT = /[\p{Cc}\p{Cf}]/u;

/** True when `value` contains a Cc or Cf character other than an emoji-sequence ZWJ or a between-letters ZWJ/ZWNJ. */
export function hasControlOrFormatCharacter(value: string): boolean {
  return CONTROL_OR_FORMAT.test(value.replace(EMOJI_ZERO_WIDTH_JOINER, "").replace(ORTHOGRAPHIC_JOINER, ""));
}

/**
 * REV-NS3-2: carries the `g` flag, so it carries `lastIndex` state across calls. Use it only
 * through `String.prototype.replace` (as {@link collapseWhitespace} does) or another stateless
 * string method -- never `.test()` or `.exec()`.
 */
export const WHITESPACE_RUN = /\p{White_Space}+/gu;

/**
 * REV-NS3-2: carries the `g` flag, so it carries `lastIndex` state across calls. Use it only
 * through `String.prototype.replace` (as {@link collapseWhitespace} does) or another stateless
 * string method -- never `.test()` or `.exec()`.
 */
export const LEADING_TRAILING_WHITESPACE = /^\p{White_Space}+|\p{White_Space}+$/gu;

/**
 * SEC-NS-R1: NFC, then every `\p{White_Space}` run (NBSP, U+3000, the thin
 * spaces, line separators) collapsed to one U+0020, then trimmed. Idempotent.
 */
export function collapseWhitespace(value: string): string {
  return value.normalize("NFC").replace(WHITESPACE_RUN, " ").replace(LEADING_TRAILING_WHITESPACE, "");
}

/**
 * SEC-NS-R1 / SEC-NF-R3: everything that renders as nothing. Whitespace,
 * combining marks (Mn/Mc/Me), format characters, the variation selectors
 * (U+FE00..FE0F, U+E0100..E01EF), the Hangul fillers (U+3164, U+FFA0,
 * U+115F, U+1160), U+2800 BRAILLE PATTERN BLANK, private-use characters
 * (Co), unassigned code points (Cn), surrogates (Cs), U+1D159 MUSICAL SYMBOL
 * NULL NOTEHEAD, U+FFFC OBJECT REPLACEMENT CHARACTER and U+FFFD REPLACEMENT
 * CHARACTER. A name with nothing left once these are removed has no visible
 * grapheme and is refused.
 *
 * REV-NS3-1: `\p{Cn}` (unassigned) is not a fixed set -- it is whatever the
 * runtime's ICU build has not yet assigned a category to, so its membership
 * tracks the host's Unicode version. Measured against Node 24.15 (ICU 78,
 * Unicode 17): a name made entirely of code points newly encoded in a later
 * Unicode version could be treated as visible on one host and as
 * unassigned-and-invisible (`no_visible_grapheme`) on another until every
 * host's ICU catches up.
 *
 * REV-NS3-2: carries the `g` flag, so it carries `lastIndex` state across
 * calls. Use it only through `String.prototype.replace` (as
 * {@link hasNoVisibleGrapheme} does) or another stateless string method --
 * never `.test()` or `.exec()`.
 */
export const INVISIBLE =
  /[\p{White_Space}\p{M}\p{Cf}\p{Co}\p{Cn}\p{Cs}︀-️\u{E0100}-\u{E01EF}ㅤﾠᅟᅠ⠀\u{1D159}￼�]/gu;

/** True when `value` has no character left once every {@link INVISIBLE} character is removed. */
export function hasNoVisibleGrapheme(value: string): boolean {
  return value.replace(INVISIBLE, "").length === 0;
}
