/**
 * The migration check.
 *
 * Every rule here is a criterion from CBD-116 made mechanical, and every rule
 * carries the criterion it serves so a failure explains itself to someone who
 * has not read the ticket. The policy the rules read is config/migrations.json.
 *
 * All of these are pure: text in, findings out. The only reason that matters
 * is that every rule can then be proved against a fixture, which is what
 * CBD-116 asks for -- a negative fixture per rule, failing.
 */

import { lineOf, matchParen, precedingComments, splitTopLevel, strip } from "../sql.ts";
import type { SqlComment } from "../sql.ts";
import { isValidOrdinal } from "../naming.ts";
import type { Policy } from "../policy.ts";

export type Finding = {
  /** Stable rule id, so a suppression discussion can name one thing. */
  readonly rule: string;
  /** The CBD-116 criterion this rule exists to satisfy. */
  readonly criterion: string;
  readonly file: string;
  readonly line: number | undefined;
  readonly message: string;
};

export type MigrationSource = {
  readonly fileName: string;
  readonly source: string;
  readonly bytes: Buffer;
};

function finding(
  rule: string,
  criterion: string,
  file: string,
  line: number | undefined,
  message: string,
): Finding {
  return { rule, criterion, file, line, message };
}

// ---------------------------------------------------------------------------
// Bytes (CBD-116-AC02: the ledger stores a checksum, so the bytes must be
// comparable across machines)
// ---------------------------------------------------------------------------

export function encodingFindings(file: MigrationSource, policy: Policy): readonly Finding[] {
  const out: Finding[] = [];
  const rule = "encoding";
  const criterion = "CBD-116-AC02";
  const { bytes, source, fileName } = file;

  if (policy.encoding.forbidByteOrderMark && bytes.length >= 3
      && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    out.push(finding(rule, criterion, fileName, 1,
      "starts with a UTF-8 byte order mark; psql sends it to the server as part of the first statement"));
  }
  if (policy.encoding.requireUtf8 && !Buffer.from(source, "utf8").equals(bytes)) {
    out.push(finding(rule, criterion, fileName, undefined,
      "is not valid UTF-8; the checksum recorded in the ledger would differ from the bytes on another machine"));
  }
  // Mixed, not merely present. Git translates line endings per checkout, so a
  // file that is uniformly CRLF on Windows and uniformly LF on Linux is the
  // same reviewed file and the checksum normalises it away. A file containing
  // both is a defect on every platform: the text that runs is not the text the
  // diff showed.
  if (policy.encoding.forbidMixedLineEndings) {
    const crlf = (source.match(/\r\n/gu) ?? []).length;
    const lf = (source.match(/(?<!\r)\n/gu) ?? []).length;
    const strayCr = /\r(?!\n)/u.exec(source);
    if (crlf > 0 && lf > 0) {
      out.push(finding(rule, criterion, fileName, undefined,
        `mixes line endings (${crlf} CRLF, ${lf} LF)`));
    }
    if (strayCr) {
      out.push(finding(rule, criterion, fileName, lineOf(source, strayCr.index),
        "contains a carriage return that is not part of a CRLF pair"));
    }
  }
  if (policy.encoding.requireTrailingNewline && source !== "" && !source.endsWith("\n")) {
    out.push(finding(rule, criterion, fileName, lineOf(source, source.length - 1),
      "does not end with a newline"));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Forward-only (CBD-116-AC03, TD-103-028)
// ---------------------------------------------------------------------------

/**
 * Down-migration file names, over every entry in the directory.
 *
 * Separate from the per-file rule because a file called
 * `...__thing.down.sql` does not match the file-name pattern and so is never
 * parsed into a migration. Reported only as an unrecognised name it would read
 * as a typo; the point is that the name is a down migration, which no typo
 * would fix.
 */
export function reversionFileFindings(names: readonly string[], policy: Policy): readonly Finding[] {
  const out: Finding[] = [];
  for (const name of names) {
    for (const suffix of policy.forwardOnly.forbiddenFileSuffixes) {
      if (name.toLowerCase().endsWith(suffix)) {
        out.push(finding("forward-only", "CBD-116-AC03", name, undefined,
          `is named ${suffix}. ${policy.forwardOnly.why} Local recovery is `
          + `${policy.forwardOnly.recovery}, not a down migration.`));
      }
    }
  }
  return out;
}

export function forwardOnlyFindings(file: MigrationSource, policy: Policy): readonly Finding[] {
  const out: Finding[] = [];
  const rule = "forward-only";
  const criterion = "CBD-116-AC03";

  // Directives live in comments, which is exactly where other tools put them,
  // so this rule reads the comments rather than the stripped code.
  const { comments } = strip(file.source);
  for (const comment of comments) {
    for (const directive of policy.forwardOnly.forbiddenDirectives) {
      if (comment.text.toLowerCase().includes(directive.toLowerCase())) {
        out.push(finding(rule, criterion, file.fileName, comment.line,
          `carries the reversion directive "${directive}". ${policy.forwardOnly.why}`));
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Statements the runner cannot allow (CBD-116-AC01, CBD-116-AC02)
// ---------------------------------------------------------------------------

/**
 * The runner applies the whole pending set inside one transaction holding one
 * advisory lock. That is what makes a half-finished run leave nothing behind,
 * and what stops two concurrent runners from interleaving. (It does not make
 * the second one a no-op -- see plan.ts for what the lock does and does not
 * buy.) A migration that commits, rolls back, or runs a psql meta-command
 * silently removes that guarantee for every migration after it in the same
 * run, so it is rejected rather than trusted.
 *
 * Neither rule is anchored to the start of a line, and that is the point of
 * both. `CREATE TABLE t (...); COMMIT;` ends the transaction; psql dispatches
 * an unquoted backslash wherever it appears, which is what makes `SELECT 1 \g`
 * work and what lets a mid-line `\c` reconnect out from under the whole run.
 * Anchored versions of these rules caught the tidy spelling and nothing else.
 *
 * Matching over stripped code is what makes the unanchored form safe: a
 * backslash or a `COMMIT` inside a literal, a comment or a dollar-quoted body
 * is already blanked. `END` inside a plpgsql function is invisible for the
 * same reason, and is not in the pattern anyway.
 */
export function statementFindings(file: MigrationSource, policy: Policy): readonly Finding[] {
  const { code } = strip(file.source);
  const out: Finding[] = [];
  for (const rule of policy.statements.forbidden) {
    const pattern = new RegExp(rule.pattern, "gimu");
    for (const match of code.matchAll(pattern)) {
      out.push(finding(rule.id, "CBD-116-AC01", file.fileName, lineOf(code, match.index),
        `uses ${match[0].trim()}. ${rule.why}${rule.instead ? ` Use ${rule.instead}.` : ""}`));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Contract-step header (CBD-116-AC04)
// ---------------------------------------------------------------------------

/** `-- key: value` line comments at the top of the file, before any SQL. */
export function readHeader(source: string): ReadonlyMap<string, { value: string; line: number }> {
  const { code, comments } = strip(source);
  const firstStatement = code.search(/\S/u);
  const header = new Map<string, { value: string; line: number }>();
  for (const comment of comments) {
    if (firstStatement !== -1 && comment.start > firstStatement) break;
    const match = /^([a-z][a-z0-9-]*)\s*:\s*(.*)$/u.exec(comment.text);
    if (!match) continue;
    const key = match[1];
    const value = match[2];
    if (key === undefined || value === undefined || header.has(key)) continue;
    header.set(key, { value: value.trim(), line: comment.line });
  }
  return header;
}

export function destructiveMatches(
  source: string,
  policy: Policy,
): readonly { id: string; describes: string; line: number }[] {
  const { code } = strip(source);
  const hits: { id: string; describes: string; line: number }[] = [];
  for (const rule of policy.contractStep.destructivePatterns) {
    const pattern = new RegExp(rule.pattern, "giu");
    for (const match of code.matchAll(pattern)) {
      hits.push({ id: rule.id, describes: rule.describes ?? rule.id, line: lineOf(code, match.index) });
    }
  }
  return hits.sort((left, right) => left.line - right.line);
}

export function contractStepFindings(
  file: MigrationSource,
  policy: Policy,
  knownMigrations: readonly string[],
): readonly Finding[] {
  const rule = "contract-step";
  const criterion = "CBD-116-AC04";
  const hits = destructiveMatches(file.source, policy);
  if (hits.length === 0) return [];

  const out: Finding[] = [];
  const header = readHeader(file.source);
  const what = [...new Set(hits.map((hit) => hit.describes))].join(" and ");
  const line = hits[0]?.line;

  for (const key of policy.contractStep.requiredHeaderKeys) {
    if (!header.has(key)) {
      out.push(finding(rule, criterion, file.fileName, line,
        `${what} but carries no "-- ${key}:" header. ${policy.contractStep.why}`));
    }
  }
  if (out.length > 0) return out;

  const step = header.get("contract-step");
  if (step && step.value !== policy.contractStep.contractStepValue) {
    out.push(finding(rule, criterion, file.fileName, step.line,
      `declares contract-step: ${step.value}; the only value that admits a removal is `
      + `${policy.contractStep.contractStepValue}`));
  }

  const expand = header.get("completes-expand");
  if (expand) {
    const named = expand.value.replace(/\.sql$/u, "");
    const base = file.fileName.replace(/\.sql$/u, "");
    const known = new Set(knownMigrations.map((name) => name.replace(/\.sql$/u, "")));
    if (named === base) {
      out.push(finding(rule, criterion, file.fileName, expand.line,
        "names itself as the expand migration it completes; a contract step completes an earlier migration"));
    } else if (!known.has(named)) {
      out.push(finding(rule, criterion, file.fileName, expand.line,
        `names expand migration "${expand.value}", which is not a migration in this directory. `
        + "A contract step that cannot name its expand step is not evidenced as the second half of one."));
    } else if (named >= base) {
      out.push(finding(rule, criterion, file.fileName, expand.line,
        `names expand migration "${expand.value}", which does not precede this one`));
    }
  }

  const version = header.get("last-reader-removed-in");
  if (version && !new RegExp(policy.contractStep.deployedVersionPattern, "u").test(version.value)) {
    out.push(finding(rule, criterion, file.fileName, version.line,
      `records last-reader-removed-in: "${version.value}", which is not a deployed version `
      + `matching ${policy.contractStep.deployedVersionPattern}. TD-103-027 identifies a deployment by an `
      + "immutable version, and the point of the header is that the removal can be checked against one."));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Column-level schema rules (CBD-116-AC05)
// ---------------------------------------------------------------------------

const CREATE_TABLE =
  /\bCREATE\s+(?:GLOBAL\s+|LOCAL\s+)?(?:TEMP(?:ORARY)?\s+|UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_$.]*)\s*\(/giu;

const ADD_COLUMN =
  /\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_$]*)\s+([^,;]+)/giu;

/** Words that end a type and begin a column constraint. */
const CONSTRAINT_START = new Set([
  "NOT", "NULL", "DEFAULT", "PRIMARY", "UNIQUE", "REFERENCES", "CHECK",
  "GENERATED", "COLLATE", "CONSTRAINT", "DEFERRABLE", "STORAGE", "COMPRESSION",
]);

/** Words that begin a table constraint rather than a column. */
const TABLE_CONSTRAINT = new Set([
  "CONSTRAINT", "PRIMARY", "UNIQUE", "FOREIGN", "CHECK", "EXCLUDE", "LIKE",
]);

export type ColumnDefinition = { readonly name: string; readonly type: string; readonly raw: string };
export type TableDefinition = {
  readonly name: string;
  readonly columns: readonly ColumnDefinition[];
  readonly start: number;
  readonly line: number;
};

export function normalizeType(text: string): string {
  return text
    .replaceAll(/\([^)]*\)/gu, "")
    .replaceAll(/\[\s*\]/gu, "")
    .trim()
    .toLowerCase()
    .replaceAll(/\s+/gu, " ");
}

export function parseColumn(definition: string): ColumnDefinition | undefined {
  const tokens = definition.trim().split(/\s+/u).filter((token) => token !== "");
  const first = tokens[0];
  if (first === undefined) return undefined;
  if (TABLE_CONSTRAINT.has(first.toUpperCase())) return undefined;
  const typeTokens: string[] = [];
  for (const token of tokens.slice(1)) {
    if (CONSTRAINT_START.has(token.toUpperCase())) break;
    typeTokens.push(token);
  }
  return { name: first.toLowerCase(), type: normalizeType(typeTokens.join(" ")), raw: definition.trim() };
}

export function parseTables(source: string): readonly TableDefinition[] {
  const { code } = strip(source);
  const tables: TableDefinition[] = [];
  for (const match of code.matchAll(CREATE_TABLE)) {
    const open = match.index + match[0].length - 1;
    const close = matchParen(code, open);
    if (close === -1) continue;
    const body = code.slice(open + 1, close);
    const columns = splitTopLevel(body)
      .map(parseColumn)
      .filter((column): column is ColumnDefinition => column !== undefined);
    tables.push({
      name: (match[1] ?? "").toLowerCase(),
      columns,
      start: match.index,
      line: lineOf(code, match.index),
    });
  }
  return tables;
}

export function addedColumns(source: string): readonly (ColumnDefinition & { line: number })[] {
  const { code } = strip(source);
  const out: (ColumnDefinition & { line: number })[] = [];
  for (const match of code.matchAll(ADD_COLUMN)) {
    const column = parseColumn(`${match[1] ?? ""} ${match[2] ?? ""}`);
    if (column) out.push({ ...column, line: lineOf(code, match.index) });
  }
  return out;
}

export function forbiddenTypeFindings(file: MigrationSource, policy: Policy): readonly Finding[] {
  const { code } = strip(file.source);
  const out: Finding[] = [];
  for (const rule of policy.schema.forbiddenTypes) {
    const pattern = new RegExp(rule.pattern, "giu");
    for (const match of code.matchAll(pattern)) {
      out.push(finding("forbidden-type", "CBD-116-AC05", file.fileName, lineOf(code, match.index),
        `uses ${match[0].trim()}. ${rule.why}${rule.instead ? ` Use ${rule.instead}.` : ""}`));
    }
  }
  return out;
}

function isMonetary(name: string, policy: Policy): boolean {
  return policy.schema.monetary.columnNamePatterns.some((source) => new RegExp(source, "u").test(name));
}

export function monetaryFindings(file: MigrationSource, policy: Policy): readonly Finding[] {
  const out: Finding[] = [];
  const allowed = new Set(policy.schema.monetary.allowedTypes.map((type) => type.toLowerCase()));
  const currency = new RegExp(policy.schema.monetary.currencyColumnPattern, "u");
  const criterion = "CBD-116-AC05";

  const report = (fileName: string, line: number, column: ColumnDefinition) => {
    if (!isMonetary(column.name, policy)) return;
    if (allowed.has(column.type)) return;
    out.push(finding("monetary-type", criterion, fileName, line,
      `column ${column.name} holds money but is typed ${column.type || "(none)"}. `
      + `${policy.schema.monetary.why} Allowed: ${[...allowed].join(", ")}.`));
  };

  for (const table of parseTables(file.source)) {
    for (const column of table.columns) report(file.fileName, table.line, column);
    const monetary = table.columns.filter((column) => isMonetary(column.name, policy));
    if (monetary.length > 0 && !table.columns.some((column) => currency.test(column.name))) {
      out.push(finding("monetary-currency", criterion, file.fileName, table.line,
        `table ${table.name} stores ${monetary.map((column) => column.name).join(", ")} with no currency code `
        + `column matching ${policy.schema.monetary.currencyColumnPattern}. ${policy.schema.monetary.why}`));
    }
  }
  for (const column of addedColumns(file.source)) report(file.fileName, column.line, column);
  return out;
}

// ---------------------------------------------------------------------------
// Budget-space scoping (CBD-116-AC05)
// ---------------------------------------------------------------------------

function scopeOf(
  source: string,
  comments: readonly SqlComment[],
  table: TableDefinition,
  policy: Policy,
): { value: string; line: number } | undefined {
  const annotationWord = policy.schema.scopeAnnotation.keyword;
  const pattern = new RegExp(`^${annotationWord}\\s*:\\s*(\\S+)$`, "iu");
  for (const comment of precedingComments(source, comments, table.start)) {
    const match = pattern.exec(comment.text);
    const value = match?.[1];
    if (value !== undefined) return { value: value.toLowerCase(), line: comment.line };
  }
  return undefined;
}

export function scopeFindings(file: MigrationSource, policy: Policy): readonly Finding[] {
  const out: Finding[] = [];
  const criterion = "CBD-116-AC05";
  const annotation = policy.schema.scopeAnnotation;
  const { comments } = strip(file.source);
  const budgetSpaceColumn = new RegExp(annotation.budgetSpaceColumnPattern, "u");

  for (const table of parseTables(file.source)) {
    const scope = scopeOf(file.source, comments, table, policy);
    if (!scope) {
      out.push(finding("table-scope", criterion, file.fileName, table.line,
        `table ${table.name} has no "-- ${annotation.keyword}: <${annotation.allowedValues.join("|")}>" `
        + `annotation immediately above it. ${annotation.why}`));
      continue;
    }
    if (!annotation.allowedValues.includes(scope.value)) {
      out.push(finding("table-scope", criterion, file.fileName, scope.line,
        `table ${table.name} declares ${annotation.keyword}: ${scope.value}, which is not one of `
        + annotation.allowedValues.join(", ")));
      continue;
    }
    if (scope.value === annotation.budgetSpaceValue
        && !table.columns.some((column) => budgetSpaceColumn.test(column.name))) {
      out.push(finding("budget-space-column", criterion, file.fileName, table.line,
        `table ${table.name} is scoped to a budget space but declares no column matching `
        + `${annotation.budgetSpaceColumnPattern}. Server-side authorization has nothing to filter on, `
        + "and docs/architecture.md requires every access to be authorized server-side."));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Names and ordering (CBD-116-AC07)
// ---------------------------------------------------------------------------

export function namingFindings(
  entries: readonly { readonly fileName: string; readonly ordinal: string }[],
  unparsed: readonly string[],
  policy: Policy,
): readonly Finding[] {
  const out: Finding[] = [];
  const rule = "file-name";
  const criterion = "CBD-116-AC07";

  for (const fileName of unparsed) {
    out.push(finding(rule, criterion, fileName, undefined,
      `does not match ${policy.fileName.pattern} `
      + `(${policy.fileName.ordinalFormat}__slug.sql). ${policy.fileName.why}`));
  }

  const seen = new Map<string, string[]>();
  for (const entry of entries) {
    if (!isValidOrdinal(entry.ordinal)) {
      out.push(finding(rule, criterion, entry.fileName, undefined,
        `has ordinal ${entry.ordinal}, which is not a real UTC instant`));
    }
    seen.set(entry.ordinal, [...(seen.get(entry.ordinal) ?? []), entry.fileName]);
  }
  for (const [ordinal, names] of seen) {
    if (names.length < 2) continue;
    out.push(finding("duplicate-ordinal", criterion, names.join(", "), undefined,
      `share ordinal ${ordinal}. Two migrations authored in parallel landed on the same second; their `
      + "relative order would depend on the slug rather than on intent. Re-stamp one of them."));
  }
  return out;
}

// ---------------------------------------------------------------------------
// Typed SQL layer, not an ORM that owns the schema (CBD-116-AC06)
// ---------------------------------------------------------------------------

export function typedSqlLayerFindings(
  manifest: { readonly [key: string]: unknown },
  fileNames: readonly string[],
  policy: Policy,
): readonly Finding[] {
  const out: Finding[] = [];
  const criterion = "CBD-116-AC06";
  const forbidden = new Set(policy.typedSqlLayer.forbiddenSchemaOwners);

  for (const field of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
    const declared = manifest[field];
    if (typeof declared !== "object" || declared === null) continue;
    for (const name of Object.keys(declared as Record<string, unknown>)) {
      if (forbidden.has(name)) {
        out.push(finding("schema-owner", criterion, "packages/migrations/package.json", undefined,
          `declares ${name} in ${field}. ${policy.typedSqlLayer.why}`));
      }
    }
  }
  for (const fileName of fileNames) {
    if (!fileName.endsWith(policy.typedSqlLayer.migrationFileExtension)) {
      out.push(finding("schema-owner", criterion, fileName, undefined,
        `is not a ${policy.typedSqlLayer.migrationFileExtension} file. The schema is owned by SQL; a migration `
        + "expressed as code is a model that generates a schema, which is the thing the architecture declined."));
    }
  }
  return out;
}
