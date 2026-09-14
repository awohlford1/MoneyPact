export type {
  AccountErrorCode,
  AccountMutation,
  AccountRecord,
  AccountType,
  CurrencyPrecisionReader,
} from "./records.ts";
export {
  ACCOUNT_ERROR_CODES,
  ACCOUNT_TYPES,
  AccountError,
  ISO4217_MINOR_UNITS,
  MANUAL_ORIGIN,
  MAX_ACCOUNT_LABEL_LENGTH,
  MAX_MINOR_UNITS,
  SUPPORTED_MINOR_UNIT_PRECISIONS,
  compareAccountIds,
  iso4217PrecisionReader,
  parseSignedMinorUnits,
  resolveAccountPrecision,
} from "./records.ts";

export type {
  AccountStatements,
  AccountsRepository,
  Clock,
  FinancialAccountRow,
  FinancialAccountUpdate,
  IdGenerator,
} from "./ports.ts";

export type {
  AccountCreateRequest,
  AccountEditRequest,
  AccountListOptions,
  AccountsDependencies,
} from "./application.ts";
export {
  archiveAccount,
  createAccount,
  editAccount,
  listAccounts,
  parseAccountCreateRequest,
  parseAccountEditRequest,
  readAccount,
  restoreAccount,
} from "./application.ts";

export { InMemoryAccountsRepository } from "./in-memory.ts";
export {
  ACCOUNT_IMMUTABLE_SQLSTATE,
  accountFromRow,
  accountToRow,
  dataAccessAccountsRepository,
  translateAccountStatementFailure,
} from "./data-access-adapter.ts";
