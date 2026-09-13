/**
 * The one file in the repository allowed to import `pg` directly (CBD-246-AC01).
 *
 * `connection.ts` builds a `PoolConfig` from validated, already-loaded
 * configuration and hands it to `createPool` here. Nothing upstream of this
 * file ever sees the driver; nothing downstream of `connection.ts` ever sees
 * a raw `pg` type outside the re-exports below.
 */
import { Pool } from "pg";
import type { PoolClient, PoolConfig, QueryResult } from "pg";

export type { PoolClient, PoolConfig, QueryResult };
export type { Pool };

export function createPool(config: PoolConfig): Pool {
  return new Pool(config);
}
