/**
 * Migration file names, and the ordering they produce.
 *
 * CBD-116-AC07 asks for two things that pull against each other: a
 * deterministic order, and two authors on two branches who cannot collide. A
 * sequential counter gives the first and fails the second -- every branch
 * picks 0007 and the conflict surfaces at merge, or worse, does not. A random
 * identifier gives the second and fails the first.
 *
 * A UTC instant to the second gives both, with one honest gap: two authors can
 * still land on the same second. That is not resolved silently. `check`
 * rejects a duplicate ordinal outright, so the collision becomes a failing
 * build rather than a pair of migrations whose relative order depends on which
 * filesystem listed them.
 *
 * The third part of "cannot collide" is that order must not carry meaning
 * beyond itself: a migration that has not been applied yet is applied when it
 * arrives, even if a later ordinal already ran. See plan.ts.
 */

export type MigrationName = {
  /** `20260912T163355Z` -- sorts correctly as text, which is the whole point. */
  readonly ordinal: string;
  /** `create_schema_migrations` */
  readonly slug: string;
  readonly fileName: string;
};

const ORDINAL = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/u;

/** True when the ordinal names a real UTC instant, not merely 14 digits. */
export function isValidOrdinal(ordinal: string): boolean {
  const parts = ORDINAL.exec(ordinal);
  if (!parts) return false;
  const [year, month, day, hour, minute, second] = parts.slice(1).map(Number) as [
    number, number, number, number, number, number,
  ];
  const instant = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return (
    instant.getUTCFullYear() === year
    && instant.getUTCMonth() === month - 1
    && instant.getUTCDate() === day
    && instant.getUTCHours() === hour
    && instant.getUTCMinutes() === minute
    && instant.getUTCSeconds() === second
  );
}

export function formatOrdinal(instant: Date): string {
  return `${instant.toISOString().slice(0, 19).replaceAll("-", "").replaceAll(":", "")}Z`;
}

export function parseName(fileName: string, pattern: string): MigrationName | undefined {
  const parts = new RegExp(pattern, "u").exec(fileName);
  const ordinal = parts?.[1];
  const slug = parts?.[2];
  if (ordinal === undefined || slug === undefined) return undefined;
  return { ordinal, slug, fileName };
}

export function buildFileName(instant: Date, slug: string): string {
  return `${formatOrdinal(instant)}__${slug}.sql`;
}

/** A slug the file-name pattern accepts: lowercase words joined by underscores. */
export function toSlug(description: string): string {
  return description
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "_")
    .replaceAll(/^_+|_+$/gu, "");
}

/**
 * Lexicographic by file name.
 *
 * By ordinal would be enough while ordinals are unique, and they are only
 * unique because `check` insists. Sorting by the whole name means that if the
 * check is ever bypassed the order is still total and still the same on every
 * machine, rather than dependent on sort stability.
 */
export function compareNames(left: MigrationName, right: MigrationName): number {
  return left.fileName < right.fileName ? -1 : left.fileName > right.fileName ? 1 : 0;
}
