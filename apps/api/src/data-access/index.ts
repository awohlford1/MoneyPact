/**
 * CBD-246 wiring for the API process. No route reaches this yet -- it exists
 * so the API depends on `@cobudget/data-access` and constructs its
 * connections through the one seam, rather than importing `pg` (already
 * refused by this workspace's own `eslint.config.mjs`) or building its own
 * pool.
 *
 * `createApiClient` reads the database's environment configuration through
 * `@cobudget/migrations`'s already-registered loader and returns a
 * `DataAccessClient` bound to the api role's pool only -- never the worker's,
 * never migration's (CBD246-SECURITY-001 finding 2). Nothing here reads
 * `process.env` directly (`apps/api/eslint.config.mjs` already refuses that,
 * for this file and for `index.test.ts`); `loadApiConfig` is the one
 * validated read, and `apiConfigSchema` now includes `@cobudget/data-access`'s
 * `fieldEncryptionConfigSchema` (see `../config.ts` and the data-access
 * package README's "Environment wiring" section).
 *
 * `buildApiDataAccess` resolves the field-encryption provider from an
 * already-loaded `ApiConfig` through `resolveApiFieldEncryptionProvider`
 * (CBD246-SECURITY-001 finding 5): a missing or invalid field-encryption
 * variable, or a local-provider selection outside NODE_ENV=development/test
 * (finding 6), throws before `getApiDataAccess()` returns a usable client.
 * `main.ts`'s `runApiBootstrap` already resolves the same provider through
 * the same function before the listener opens or readiness is reported
 * (CBD246-SECURITY-002 finding 1); this repeats that resolution at the point
 * that will actually construct a repository against the resolved provider
 * once a route exists, rather than trusting bootstrap's earlier call to have
 * cached a value this module can see. `buildApiDataAccess` is the pure seam
 * `index.test.ts` exercises with a config built through `loadApiConfigFrom`,
 * so no test needs `process.env`.
 */
import { createApiClient } from "@cobudget/data-access";
import type { DataAccessClient } from "@cobudget/data-access";
import type { KeyProvider } from "@cobudget/data-access/encryption";
import { resolveApiFieldEncryptionProvider, loadApiConfig } from "../config.ts";
import type { ApiConfig } from "../config.ts";

export interface ApiDataAccess {
  readonly client: DataAccessClient;
  readonly encryptionProvider: KeyProvider;
}

/** Pure: builds the client and resolves the field-encryption provider from an already-validated config. */
export function buildApiDataAccess(config: ApiConfig): ApiDataAccess {
  return {
    client: createApiClient(),
    encryptionProvider: resolveApiFieldEncryptionProvider(config),
  };
}

let dataAccess: ApiDataAccess | undefined;

/** Lazily build the api application's data-access client and field-encryption provider. */
export function getApiDataAccess(): ApiDataAccess {
  dataAccess ??= buildApiDataAccess(loadApiConfig());
  return dataAccess;
}
