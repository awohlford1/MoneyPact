/**
 * A small PostgreSQL lexer, sufficient for the migration check and no more.
 *
 * The check has to answer questions like "does this file drop a column" and
 * "is this column a timestamp without time zone". Both are regular-expression
 * questions once literals and comments are out of the way, and both give wrong
 * answers if they are not: a comment saying "we used to DROP COLUMN here"
 * would fail a clean migration, and a string literal containing the word
 * "money" would fail a clean one too. Pattern matching over raw SQL is the
 * mistake this module exists to prevent.
 *
 * `strip` therefore returns code with comments and literal *contents* blanked,
 * at exactly the original offsets and line numbers, plus the comments it
 * removed -- because the contract-step header and the table scope annotation
 * are themselves comments, and the rules need to read them.
 *
 * Double-quoted identifiers keep their text and lose their quotes, because a
 * quoted column name is still a column name.
 */

export type SqlComment = {
  readonly kind: "line" | "block";
  /** Comment body with the introducer and terminator removed, trimmed. */
  readonly text: string;
  /** One-based line number of the comment's first character. */
  readonly line: number;
  /** Zero-based offset of the comment's first character in the source. */
  readonly start: number;
};

export type StrippedSql = {
  /** Same length as the source. Comments and literal contents become spaces. */
  readonly code: string;
  readonly comments: readonly SqlComment[];
};

/** Replace every character with a space, keeping newlines so lines still line up. */
function blank(text: string): string {
  return text.replaceAll(/[^\n]/gu, " ");
}

export function lineOf(source: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < source.length; i += 1) if (source[i] === "\n") line += 1;
  return line;
}

const DOLLAR_TAG = /^\$(?:[A-Za-z_-￿][A-Za-z0-9_-￿]*)?\$/u;

export function strip(source: string): StrippedSql {
  const out: string[] = [];
  const comments: SqlComment[] = [];
  let i = 0;

  const push = (text: string) => out.push(text);

  while (i < source.length) {
    const rest = source.slice(i);

    // Line comment: -- to end of line.
    if (rest.startsWith("--")) {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      const raw = source.slice(i, stop);
      comments.push({ kind: "line", text: raw.slice(2).trim(), line: lineOf(source, i), start: i });
      push(blank(raw));
      i = stop;
      continue;
    }

    // Block comment: /* ... */, nested, as PostgreSQL allows.
    if (rest.startsWith("/*")) {
      let depth = 0;
      let j = i;
      while (j < source.length) {
        if (source.startsWith("/*", j)) {
          depth += 1;
          j += 2;
        } else if (source.startsWith("*/", j)) {
          depth -= 1;
          j += 2;
          if (depth === 0) break;
        } else j += 1;
      }
      const raw = source.slice(i, j);
      const body = raw.replace(/^\/\*/u, "").replace(/\*\/$/u, "");
      comments.push({ kind: "block", text: body.trim(), line: lineOf(source, i), start: i });
      push(blank(raw));
      i = j;
      continue;
    }

    // Dollar-quoted string: $$ ... $$ or $tag$ ... $tag$.
    const dollar = DOLLAR_TAG.exec(rest);
    if (dollar) {
      const tag = dollar[0];
      const close = source.indexOf(tag, i + tag.length);
      const stop = close === -1 ? source.length : close + tag.length;
      push(blank(source.slice(i, stop)));
      i = stop;
      continue;
    }

    // Single-quoted string, with '' doubling, and backslash escapes after E'.
    if (source[i] === "'") {
      const escapeString = i > 0 && (source[i - 1] === "E" || source[i - 1] === "e");
      let j = i + 1;
      while (j < source.length) {
        if (escapeString && source[j] === "\\") {
          j += 2;
          continue;
        }
        if (source[j] === "'") {
          if (source[j + 1] === "'") {
            j += 2;
            continue;
          }
          j += 1;
          break;
        }
        j += 1;
      }
      push(blank(source.slice(i, j)));
      i = j;
      continue;
    }

    // Quoted identifier: keep the name, drop the quotes.
    if (source[i] === '"') {
      let j = i + 1;
      while (j < source.length) {
        if (source[j] === '"') {
          if (source[j + 1] === '"') {
            j += 2;
            continue;
          }
          j += 1;
          break;
        }
        j += 1;
      }
      const raw = source.slice(i, j);
      // Same length, same line breaks: only the quote characters become
      // spaces, so a quoted column name still reads as its name and every
      // later offset still points where it did.
      push(raw.replaceAll('"', " "));
      i = j;
      continue;
    }

    push(source[i] as string);
    i += 1;
  }

  const code = out.join("");
  return { code, comments };
}

/**
 * The comment block immediately above `index`, in source order.
 *
 * "Immediately" means separated from the statement by whitespace only. A
 * scope annotation three statements away is not an annotation of this one, and
 * treating it as one would let a single correct comment vouch for a whole
 * file.
 */
export function precedingComments(
  source: string,
  comments: readonly SqlComment[],
  index: number,
): readonly SqlComment[] {
  const block: SqlComment[] = [];
  let boundary = index;
  for (let k = comments.length - 1; k >= 0; k -= 1) {
    const comment = comments[k];
    if (comment === undefined || comment.start >= boundary) continue;
    const end = comment.start + commentLength(source, comment);
    const between = source.slice(end, boundary);
    if (between.trim() !== "") break;
    block.unshift(comment);
    boundary = comment.start;
  }
  return block;
}

function commentLength(source: string, comment: SqlComment): number {
  if (comment.kind === "line") {
    const end = source.indexOf("\n", comment.start);
    return (end === -1 ? source.length : end) - comment.start;
  }
  const end = source.indexOf("*/", comment.start);
  return (end === -1 ? source.length : end + 2) - comment.start;
}

/**
 * Match the closing parenthesis for the one that opens at `open`.
 * Returns the index of the closing parenthesis, or -1 if unbalanced.
 */
export function matchParen(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === "(") depth += 1;
    else if (code[i] === ")") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Split on commas that are not inside parentheses. */
export function splitTopLevel(text: string): readonly string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const character = text[i];
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (character === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}
