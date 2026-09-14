/**
 * Manual account commands (CBD-196 / CBD-31).
 *
 * Four operations and one query: create, edit, archive, restore, list.
 * Request bodies arrive as `unknown` and are parsed here into canonical
 * errors, so the HTTP adapter that follows in PROTO-INCREMENT-B-001 carries
 * no validation of its own.
 *
 * Two rules shape everything below.
 *
 * Atomicity (AC02): parsing completes before any write is attempted, so a
 * request with a bad field never reaches persistence and there is nothing to
 * undo. The surrounding transaction is the caller's; a command that throws
 * has written nothing, and a caller that does not roll back is the one at
 * fault, not this module.
 *
 * Identity and lifecycle (AC03, AC04): `accountId` is assigned once, never
 * reassigned, and never carried by a request that edits. Editing changes only
 * the fields named in the request and advances `version`, so every accepted
 * write reports a previous and a resulting version. Archiving and restoring
 * change `archivedAt` -- lifecycle availability -- and nothing else: the
 * balance, the currency, the owner and every transaction that references the
 * account are untouched and stay readable through `readAccount`/`listAccounts`,
 * which never filter by archive state.
 */
import type { AccountsRepository, Clock, IdGenerator } from "./ports.ts";
import {
  ACCOUNT_TYPES,
  AccountError,
  MANUAL_ORIGIN,
  MAX_ACCOUNT_LABEL_LENGTH,
  compareAccountIds,
  iso4217PrecisionReader,
  parseSignedMinorUnits,
  resolveAccountPrecision,
} from "./records.ts";
import type { AccountMutation, AccountRecord, AccountType, CurrencyPrecisionReader } from "./records.ts";

export interface AccountsDependencies {
  readonly repository: AccountsRepository;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly currencies?: CurrencyPrecisionReader;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value);
}

function parseLabel(value: unknown, path: string): string {
  if (typeof value !== "string") throw new AccountError("label_invalid", path);
  const label = value.trim();
  if (label.length === 0 || [...label].length > MAX_ACCOUNT_LABEL_LENGTH) throw new AccountError("label_invalid", path);
  return label;
}

function parseAccountType(value: unknown, path: string): AccountType {
  if (typeof value !== "string" || !(ACCOUNT_TYPES as readonly string[]).includes(value)) throw new AccountError("account_type_unsupported", path);
  return value as AccountType;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export interface AccountCreateRequest {
  readonly accountType: AccountType;
  readonly label: string;
  readonly currencyCode: string;
  readonly minorUnitPrecision: number;
  readonly openingBalanceMinorUnits: number;
  readonly ownerSubjectId: string;
}

/** Parse `{ accountType, label, currencyCode, openingBalanceMinorUnits, ownerSubjectId? }`; every failure names its path. */
export function parseAccountCreateRequest(body: unknown, actingSubjectId: string, currencies: CurrencyPrecisionReader = iso4217PrecisionReader): AccountCreateRequest {
  if (!isRecord(body)) throw new AccountError("invalid_request", "body");
  const accountType = parseAccountType(body.accountType, "accountType");
  const label = parseLabel(body.label, "label");
  const minorUnitPrecision = resolveAccountPrecision(currencies, body.currencyCode, "currencyCode");
  const openingBalanceMinorUnits = parseSignedMinorUnits(body.openingBalanceMinorUnits ?? 0, "openingBalanceMinorUnits");
  const ownerSubjectId = body.ownerSubjectId ?? actingSubjectId;
  if (!isUuid(ownerSubjectId)) throw new AccountError("owner_invalid", "ownerSubjectId");
  return { accountType, label, currencyCode: body.currencyCode as string, minorUnitPrecision, openingBalanceMinorUnits, ownerSubjectId };
}

/**
 * Persist exactly one canonical account (AC01). Nothing else is created: this
 * module's repository port has no way to write a budget, a period, a
 * schedule, a transaction or an assignment, which is why the claim is
 * structural rather than merely tested.
 */
export async function createAccount(deps: AccountsDependencies, budgetSpaceId: string, actingSubjectId: string, request: AccountCreateRequest): Promise<AccountMutation> {
  const now = deps.clock.now();
  await assertLabelFree(deps, budgetSpaceId, request.label, null);
  const account: AccountRecord = {
    accountId: deps.ids.uuid(),
    budgetSpaceId,
    origin: MANUAL_ORIGIN,
    accountType: request.accountType,
    label: request.label,
    currencyCode: request.currencyCode,
    minorUnitPrecision: request.minorUnitPrecision,
    openingBalanceMinorUnits: request.openingBalanceMinorUnits,
    ownerSubjectId: request.ownerSubjectId,
    createdBySubjectId: actingSubjectId,
    archivedAt: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
  await deps.repository.insertAccount(account);
  return { previousVersion: null, account };
}

async function assertLabelFree(deps: AccountsDependencies, budgetSpaceId: string, label: string, accountId: string | null): Promise<void> {
  const lowered = label.toLowerCase();
  for (const existing of await deps.repository.listAccounts(budgetSpaceId)) {
    if (existing.archivedAt !== null) continue;
    if (existing.accountId === accountId) continue;
    if (existing.label.toLowerCase() === lowered) throw new AccountError("label_taken", "label");
  }
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

export interface AccountEditRequest {
  readonly accountType?: AccountType;
  readonly label?: string;
  readonly openingBalanceMinorUnits?: number;
  readonly ownerSubjectId?: string;
}

/**
 * Parse an edit. Only the permitted fields are readable from the body at all;
 * `accountId`, `currencyCode`, `origin` and `version` are not among them, so
 * an attempt to move identity or denomination is refused as
 * `invalid_request` rather than quietly ignored.
 */
export function parseAccountEditRequest(body: unknown): AccountEditRequest {
  if (!isRecord(body)) throw new AccountError("invalid_request", "body");
  const permitted = new Set(["accountType", "label", "openingBalanceMinorUnits", "ownerSubjectId"]);
  for (const key of Object.keys(body)) {
    if (!permitted.has(key)) throw new AccountError("invalid_request", key);
  }
  const request: {
    accountType?: AccountType;
    label?: string;
    openingBalanceMinorUnits?: number;
    ownerSubjectId?: string;
  } = {};
  if (body.accountType !== undefined) request.accountType = parseAccountType(body.accountType, "accountType");
  if (body.label !== undefined) request.label = parseLabel(body.label, "label");
  if (body.openingBalanceMinorUnits !== undefined) request.openingBalanceMinorUnits = parseSignedMinorUnits(body.openingBalanceMinorUnits, "openingBalanceMinorUnits");
  if (body.ownerSubjectId !== undefined) {
    if (!isUuid(body.ownerSubjectId)) throw new AccountError("owner_invalid", "ownerSubjectId");
    request.ownerSubjectId = body.ownerSubjectId;
  }
  if (Object.keys(request).length === 0) throw new AccountError("invalid_request", "body");
  return request;
}

async function loadAccount(deps: AccountsDependencies, budgetSpaceId: string, accountId: string): Promise<AccountRecord> {
  if (!isUuid(accountId)) throw new AccountError("invalid_request", "accountId");
  const account = await deps.repository.readAccount(budgetSpaceId, accountId);
  if (account === null) throw new AccountError("account_not_found", "accountId");
  return account;
}

/** The fields a command may change. Identity, denomination and creation provenance are absent by construction. */
type AccountChanges = {
  accountType?: AccountType;
  label?: string;
  openingBalanceMinorUnits?: number;
  ownerSubjectId?: string;
  archivedAt?: string | null;
};

async function commit(deps: AccountsDependencies, current: AccountRecord, changes: AccountChanges): Promise<AccountMutation> {
  const account: AccountRecord = { ...current, ...changes, version: current.version + 1, updatedAt: deps.clock.now() };
  if (!await deps.repository.updateAccount(account, current.version)) throw new AccountError("version_conflict", "version");
  return { previousVersion: current.version, account };
}

/** Change only the requested fields; identity, currency, origin and creation provenance are untouched (AC03). */
export async function editAccount(deps: AccountsDependencies, budgetSpaceId: string, accountId: string, request: AccountEditRequest): Promise<AccountMutation> {
  const current = await loadAccount(deps, budgetSpaceId, accountId);
  if (current.archivedAt !== null) throw new AccountError("account_archived", "accountId");
  if (request.label !== undefined) await assertLabelFree(deps, budgetSpaceId, request.label, accountId);
  const changes: AccountChanges = {};
  if (request.accountType !== undefined) changes.accountType = request.accountType;
  if (request.label !== undefined) changes.label = request.label;
  if (request.openingBalanceMinorUnits !== undefined) changes.openingBalanceMinorUnits = request.openingBalanceMinorUnits;
  if (request.ownerSubjectId !== undefined) changes.ownerSubjectId = request.ownerSubjectId;
  return commit(deps, current, changes);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/** Archive: lifecycle availability only. Balances, transactions and provenance stay exactly as they are (AC04). */
export async function archiveAccount(deps: AccountsDependencies, budgetSpaceId: string, accountId: string): Promise<AccountMutation> {
  const current = await loadAccount(deps, budgetSpaceId, accountId);
  if (current.archivedAt !== null) throw new AccountError("account_archived", "accountId");
  return commit(deps, current, { archivedAt: deps.clock.now() });
}

/** Restore: the exact inverse, and equally narrow. */
export async function restoreAccount(deps: AccountsDependencies, budgetSpaceId: string, accountId: string): Promise<AccountMutation> {
  const current = await loadAccount(deps, budgetSpaceId, accountId);
  if (current.archivedAt === null) throw new AccountError("account_not_archived", "accountId");
  await assertLabelFree(deps, budgetSpaceId, current.label, accountId);
  return commit(deps, current, { archivedAt: null });
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface AccountListOptions {
  /** Default false: an archived account stays queryable through the history path (AC04). */
  readonly liveOnly?: boolean;
}

export async function listAccounts(deps: AccountsDependencies, budgetSpaceId: string, options: AccountListOptions = {}): Promise<readonly AccountRecord[]> {
  const accounts = await deps.repository.listAccounts(budgetSpaceId);
  return accounts
    .filter((account) => (options.liveOnly === true ? account.archivedAt === null : true))
    .sort((a, b) => a.label.toLowerCase() < b.label.toLowerCase() ? -1 : a.label.toLowerCase() > b.label.toLowerCase() ? 1 : compareAccountIds(a.accountId, b.accountId));
}

export function readAccount(deps: AccountsDependencies, budgetSpaceId: string, accountId: string): Promise<AccountRecord> {
  return loadAccount(deps, budgetSpaceId, accountId);
}
