/**
 * CBD-190 §7 deterministic safe outcomes: the closed public vocabulary the
 * browser may ever observe, and the closed map from a provider-declared
 * `error` code to one of them. Provider error descriptions never reach this
 * map (§4.2); only the bare code selects an outcome.
 *
 * The vocabulary is the same closed set the merged `identity_callback`
 * schema (20260913T100000Z) accepts in `terminal_outcome`, so every value
 * here can be persisted as the callback's terminal state. That schema has no
 * success value: a committed success is represented by the callback row
 * remaining `handoff_ready` with `commit_at` set and its hand-off `consumed`
 * (see `store.ts`), which the final report records as a schema-half gap.
 */
export const PUBLIC_OUTCOMES = Object.freeze([
  "verification_pending",
  "cancelled",
  "not_completed",
  "temporarily_unavailable",
  "invalid_or_expired",
  "account_unavailable",
  "callback_failure",
  "still_processing",
] as const);

export type PublicOutcome = (typeof PUBLIC_OUTCOMES)[number];

export function isPublicOutcome(value: unknown): value is PublicOutcome {
  return typeof value === "string" && (PUBLIC_OUTCOMES as readonly string[]).includes(value);
}

/**
 * Closed provider-error map. Cognito's hosted UI reports a subject who leaves
 * the ceremony without completing it as `access_denied`, which is why that
 * code selects `cancelled`; a provider-side refusal of the request itself
 * (`invalid_request`, `unauthorized_client`, `invalid_scope`, ...) is
 * `not_completed`; issuer outages are `temporarily_unavailable`; a hosted
 * continuation the provider still requires is `verification_pending`.
 * Unknown codes fail closed to `not_completed`.
 */
const PROVIDER_ERROR_OUTCOMES: Readonly<Record<string, PublicOutcome>> = Object.freeze({
  access_denied: "cancelled",
  server_error: "temporarily_unavailable",
  temporarily_unavailable: "temporarily_unavailable",
  interaction_required: "verification_pending",
  login_required: "verification_pending",
  consent_required: "verification_pending",
  invalid_request: "not_completed",
  unauthorized_client: "not_completed",
  unsupported_response_type: "not_completed",
  invalid_scope: "not_completed",
});

export function outcomeForProviderError(error: string): PublicOutcome {
  return PROVIDER_ERROR_OUTCOMES[error] ?? "not_completed";
}
