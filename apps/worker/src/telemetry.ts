import { writeSync } from "node:fs";

import { readinessReport } from "@cobudget/contracts/health";
import type { ReadinessReport } from "@cobudget/contracts/health";
import { reliabilityEvent } from "@cobudget/contracts/telemetry";
import type { ReliabilityEvent } from "@cobudget/contracts/telemetry";

import type { ReliabilitySink } from "./telemetry/sink.ts";

// CBD-262-AC01: the sink type now lives in ./telemetry/sink.ts, shared
// byte-for-byte with apps/api (see ./telemetry/parity.test.ts). Re-exported
// here so existing imports of `ReliabilitySink` from "./telemetry.js" keep working.
export type { ReliabilitySink } from "./telemetry/sink.ts";

export interface WorkerEventSink {
  readonly readiness: (report: ReadinessReport) => void;
  readonly reliability: ReliabilitySink;
}

export function serializeReadiness(report: ReadinessReport): string {
  return JSON.stringify(readinessReport(report.service, report.version));
}

export function serializeReliability(event: ReliabilityEvent): string {
  return JSON.stringify(reliabilityEvent(event));
}

function writeLifecycleLine(fileDescriptor: 1 | 2, line: string): void {
  // Lifecycle records are tiny and rare. A synchronous write guarantees that
  // readiness is observable before startup continues and shutdown is not lost
  // when the event loop becomes empty immediately afterward.
  const encodedLine = Buffer.from(`${line}\n`, "utf8");
  let offset = 0;
  while (offset < encodedLine.length) {
    const bytesWritten = writeSync(
      fileDescriptor,
      encodedLine,
      offset,
      encodedLine.length - offset,
    );
    if (bytesWritten === 0) {
      throw new Error("Lifecycle output stream accepted no bytes.");
    }
    offset += bytesWritten;
  }
}

/** The worker's only structured-log writer. Both event shapes are rebuilt through shared filters. */
export const stdoutWorkerEventSink: WorkerEventSink = {
  readiness: (report) => {
    writeLifecycleLine(1, serializeReadiness(report));
  },
  reliability: (event) => {
    writeLifecycleLine(1, serializeReliability(event));
  },
};

/** Configuration diagnostics name variables only and deliberately are not structured telemetry. */
export function writeStartupDiagnostic(message: string): void {
  writeLifecycleLine(2, message);
}
