/**
 * CBD-246 wiring for the worker process. No job reaches this yet -- it
 * exists so the worker depends on `@cobudget/data-access` and constructs its
 * connections through the one seam, rather than importing `pg` (already
 * refused by this workspace's own `eslint.config.mjs`) or building its own
 * pool.
 *
 * See `apps/api/src/data-access/index.ts` for the identical rationale:
 * `createWorkerClient` returns a `DataAccessClient` bound to the worker
 * role's pool only (CBD246-SECURITY-001 finding 2), and `buildWorkerDataAccess`
 * resolves the field-encryption provider from an already-loaded
 * `WorkerConfig` through `resolveWorkerFieldEncryptionProvider` (finding 5),
 * enforcing the local-provider NODE_ENV restriction (finding 6) at the point
 * a repository would actually be built against it. `main.ts`'s `bootstrap`
 * already resolves the same provider through the same function before the
 * worker starts or reports readiness (CBD246-SECURITY-002 finding 1); this
 * repeats that resolution here rather than trusting bootstrap's earlier call
 * to have cached a value this module can see. `buildWorkerDataAccess` is the
 * pure seam `index.test.ts` exercises with a config built through
 * `loadWorkerConfigFrom`, so no test needs `process.env` (refused by
 * `apps/worker/eslint.config.mjs`).
 */
import { createWorkerClient } from "@cobudget/data-access";
import type { DataAccessClient } from "@cobudget/data-access";
import type { KeyProvider } from "@cobudget/data-access/encryption";
import { loadWorkerConfig, resolveWorkerFieldEncryptionProvider } from "../config.ts";
import type { WorkerConfig } from "../config.ts";

export interface WorkerDataAccess {
  readonly client: DataAccessClient;
  readonly encryptionProvider: KeyProvider;
}

/** Pure: builds the client and resolves the field-encryption provider from an already-validated config. */
export function buildWorkerDataAccess(config: WorkerConfig): WorkerDataAccess {
  return {
    client: createWorkerClient(),
    encryptionProvider: resolveWorkerFieldEncryptionProvider(config),
  };
}

let dataAccess: WorkerDataAccess | undefined;

/** Lazily build the worker application's data-access client and field-encryption provider. */
export function getWorkerDataAccess(): WorkerDataAccess {
  dataAccess ??= buildWorkerDataAccess(loadWorkerConfig());
  return dataAccess;
}
