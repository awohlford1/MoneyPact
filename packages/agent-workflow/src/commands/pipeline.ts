import type { OperationOutcome } from "../contracts/operations.ts";

export interface ConsequentialOperation<T> {
  operationId: string;
  persistIntent(attempt: number): Promise<void>;
  perform(): Promise<T>;
  persistOutcome(outcome: OperationOutcome, value?: T, error?: unknown): Promise<void>;
  isTransient?(error: unknown): boolean;
}
export interface ConsequentialPipelineOptions { retryCount: number; backoffSeconds: number[]; sleep?: (milliseconds: number) => Promise<void>; jitter?: () => number }
export interface ConsequentialResult<T> { status: OperationOutcome; performed: boolean; value?: T; error?: unknown; intentAttempts: number }

export async function runConsequentialOperation<T>(operation: ConsequentialOperation<T>, options: ConsequentialPipelineOptions): Promise<ConsequentialResult<T>> {
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  let lastError: unknown;
  let attempts = 0;
  for (let attempt = 0; attempt <= options.retryCount; attempt += 1) {
    attempts += 1;
    try { await operation.persistIntent(attempt); lastError = undefined; break; }
    catch (error) {
      lastError = error;
      if (operation.isTransient?.(error) !== true || attempt === options.retryCount) break;
      const seconds = options.backoffSeconds[Math.min(attempt, options.backoffSeconds.length - 1)] ?? 0;
      const jitter = options.jitter?.() ?? 1;
      await sleep(seconds * 1_000 * jitter);
    }
  }
  if (lastError !== undefined) {
    try { await operation.persistOutcome("prevented", undefined, lastError); } catch { /* original intent failure remains authoritative */ }
    return { status: "prevented", performed: false, error: lastError, intentAttempts: attempts };
  }
  try {
    const value = await operation.perform();
    await operation.persistOutcome("succeeded", value);
    return { status: "succeeded", performed: true, value, intentAttempts: attempts };
  } catch (error) {
    try { await operation.persistOutcome("failed", undefined, error); }
    catch { return { status: "unknown", performed: true, error, intentAttempts: attempts }; }
    return { status: "failed", performed: true, error, intentAttempts: attempts };
  }
}
