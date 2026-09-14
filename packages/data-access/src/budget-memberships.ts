import type { Pool, QueryResult } from "./driver.ts";
import { wrapDriverError } from "./logging.ts";

/** Closed subject-scoped read for discovering one's tenant memberships.
 * No arbitrary table, projection, predicate or SQL enters this seam. */
export async function readOwnBudgetMemberships(pool: Pick<Pool, "query">, subject: string): Promise<QueryResult> {
  if (typeof subject !== "string" || !subject.trim()) throw new Error("missing membership subject");
  try {
    return await pool.query("SELECT budget_space_id, membership_id FROM budget_space_membership WHERE account_subject_id = $1 AND status = 'active' ORDER BY budget_space_id, membership_id", [subject]);
  } catch (error) { throw wrapDriverError("budget_space_membership", "select", error); }
}
