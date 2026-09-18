import { reliabilityEvent } from "@cobudget/contracts/telemetry";

import type { ReliabilitySink } from "./telemetry/sink.ts";

// CBD-262-AC01: the sink type now lives in ./telemetry/sink.ts, shared
// byte-for-byte with apps/worker (see ./telemetry/parity.test.ts). Re-exported
// here so existing imports of `ReliabilitySink` from "./telemetry.js" keep working.
export type { ReliabilitySink } from "./telemetry/sink.ts";

/**
 * The API's only structured-log writer. The shared runtime filter drops any
 * field outside AN-92-003's allowlist before bytes reach stdout.
 */
export const stdoutReliabilitySink: ReliabilitySink = (fields) => {
  process.stdout.write(`${JSON.stringify(reliabilityEvent(fields))}\n`);
};

/**
 * Configuration errors must name the invalid variable, but never its value.
 * This operator diagnostic is deliberately plain text rather than a
 * reliability event: configuration variable names are not telemetry fields.
 */
export function writeStartupDiagnostic(message: string): void {
  process.stderr.write(`${message}\n`);
}
