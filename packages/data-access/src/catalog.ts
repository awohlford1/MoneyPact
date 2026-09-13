/**
 * The closed table catalog (CBD-246-AC02, Security finding 1, Review
 * finding on AC02/AC03).
 *
 * The statement builders in `tenant.ts` never accept a caller-chosen table
 * name at face value: every table they touch is looked up here first, and a
 * table this catalog does not know about -- or knows about under the wrong
 * scope -- is refused before any SQL is built. This is what makes "the
 * predicate is composed by the layer" mean something: a caller cannot reach
 * a tenant-scoped table through the platform escape hatch, or vice versa,
 * merely by naming it in a request object.
 *
 * `PRODUCTION_TABLE_CATALOG` is hand-kept in step with
 * `config/migrations.json`'s `scope` annotation on every `CREATE TABLE`
 * this repository has actually applied. `catalog.test.ts` parses every file
 * under `packages/migrations/migrations` for that annotation and asserts
 * this catalog agrees with it exactly -- an added, removed, or reclassified
 * table that this file is not updated to match fails `npm run check`
 * rather than silently drifting. The budget-space rows below are the
 * CBD-231 lifecycle schema; every builder function still takes an
 * optional `catalog` parameter so a caller with its own scratch table --
 * `scripts/verify-live.ts`, and this package's own tests -- can exercise
 * the real enforcement path without this file naming a table that does not
 * exist.
 */
export type TableScope = "budget-space" | "financial-profile" | "identity" | "platform";

export interface TableCatalog {
  readonly [table: string]: TableScope;
}

export const TENANT_SCOPE: TableScope = "budget-space";

export const PROFILE_SCOPE: TableScope = "financial-profile";

/** Scopes `platformSelect`/`platformInsert`/`platformUpdate`/`platformDelete` may reach. `financial-profile` is deliberately excluded because it has a dedicated subject-scoped seam. */
const PLATFORM_SCOPES: readonly TableScope[] = ["identity", "platform"];

export const PRODUCTION_TABLE_CATALOG: TableCatalog = {
  cobudget_schema_migrations: "platform",
  budget_space: "budget-space",
  budget_space_membership: "budget-space",
  budget_space_schedule_version: "budget-space",
  budget_space_period: "budget-space",
  budget_creation_operation: "budget-space",
  budget_creation_idempotency: "budget-space",
  budget_creation_audit: "budget-space",
  budget_creation_success: "budget-space",
  // CBD-190/CBD-212 (CBD190-SCHEMA-001), 20260913T100000Z.
  account_subject: "identity",
  identity_binding: "identity",
  identity_callback: "identity",
  identity_session_handoff: "identity",
  financial_profile: "financial-profile",
};

export function isTenantTable(catalog: TableCatalog, table: string): boolean {
  return catalog[table] === TENANT_SCOPE;
}

export function isProfileTable(catalog: TableCatalog, table: string): boolean {
  return catalog[table] === PROFILE_SCOPE;
}

export function isPlatformTable(catalog: TableCatalog, table: string): boolean {
  const scope = catalog[table];
  return scope !== undefined && PLATFORM_SCOPES.includes(scope);
}
