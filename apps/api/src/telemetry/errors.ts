import type { ErrorClass } from "@cobudget/contracts/telemetry";

/**
 * CBD-262-AC03: the only place an exception's message and stack trace may
 * go. Nothing in this module, `sink.ts`, or `spans.ts` ever attaches a
 * `RestrictedDiagnostic`'s `message` or `stack` to a `ReliabilityEvent` or a
 * `ReliabilitySpanAttributes` value -- neither type has a field that could
 * hold one. The S1 stream gets `errorClass` only, produced by `classifyError`
 * below; `reportError` is the single seam that sees both the coarse class
 * and the free-text diagnostic, and it hands them to two different
 * destinations rather than one.
 */
export interface RestrictedDiagnostic {
  readonly errorClass: ErrorClass;
  readonly message: string;
  readonly stack?: string;
}

/** The restricted-diagnostics interface: the only sink message/stack may reach. */
export type RestrictedDiagnosticSink = (diagnostic: RestrictedDiagnostic) => void;

function hasStringCode(error: unknown): error is { code: string } {
  return typeof error === "object" && error !== null && "code" in error
    && typeof (error as { code: unknown }).code === "string";
}

const TIMEOUT_CODES = new Set(["ETIMEDOUT", "ESOCKETTIMEDOUT"]);
const UNAVAILABLE_CODES = new Set(["ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENOTFOUND", "EPIPE", "EAI_AGAIN"]);

/**
 * Maps an exception to the coarse `ErrorClass` the S1 stream may carry.
 *
 * Classification never inspects `error.message`: message text is exactly
 * what must not reach the S1 stream, so this function is deliberately blind
 * to it and looks only at the error's constructor (via `isConfigurationError`,
 * supplied by the caller so this module does not need to import every
 * configuration error class) and well-known Node error `code`s.
 */
export function classifyError(
  error: unknown,
  isConfigurationError: (error: unknown) => boolean = () => false,
): ErrorClass {
  if (isConfigurationError(error)) return "config";
  if (hasStringCode(error)) {
    if (TIMEOUT_CODES.has(error.code)) return "timeout";
    if (UNAVAILABLE_CODES.has(error.code)) return "unavailable";
  }
  if (error instanceof Error) return "internal";
  return "unknown";
}

/**
 * Splits one exception into the two disjoint outputs the S1 boundary
 * requires: an `ErrorClass` for the reliability sink, and a
 * `RestrictedDiagnostic` (message and stack) for the restricted-diagnostics
 * interface only. There is no return value that carries both halves in a
 * form a caller could forward whole to a `ReliabilitySink` -- the split
 * happens here, once.
 */
export function reportError(
  error: unknown,
  diagnosticSink: RestrictedDiagnosticSink,
  isConfigurationError?: (error: unknown) => boolean,
): ErrorClass {
  const errorClass = classifyError(error, isConfigurationError);
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  diagnosticSink(stack === undefined ? { errorClass, message } : { errorClass, message, stack });
  return errorClass;
}
