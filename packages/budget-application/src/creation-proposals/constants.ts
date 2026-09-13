/**
 * Immutable deploy-time version identities (CBD-232 §3.3).
 */

export const PROPOSAL_CONTRACT_VERSION = "cbd-232/0.2";
export const PERIOD_CONTRACT_VERSION = "cbd-26/@cobudget-budget-domain-0.1.0";
export const BINDING_VERSION = "bcp-hmac-sha256/v1";

/** 30 minutes, in milliseconds (§7.2). */
export const EXPIRY_TIME_LIMIT_MS = 30 * 60 * 1000;

/** 24 hours, in milliseconds (§4.1 idempotency retention). */
export const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1000;
