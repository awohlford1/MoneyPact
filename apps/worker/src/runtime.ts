import { readinessReport } from "@cobudget/contracts/health";
import { assertPolicyCompatibility } from "./authorization/compatibility.js";
import { unavailableJobs } from "./authorization/jobs.js";
import type { AuthorizedJobs } from "./authorization/jobs.js";

import type { WorkerConfig } from "./config.js";
import type { WorkerEventSink } from "./telemetry.js";

const MAXIMUM_TIMER_DELAY_MILLISECONDS = 2_147_483_647;

export interface WorkerRuntime {
  readonly closed: Promise<void>;
  readonly stop: () => Promise<void>;
}

/**
 * Starts an intentionally idle worker. The timer is only a process-lifetime
 * handle: CBD-111 introduces no polling, queue, scheduler, database, or job.
 */
export function startWorker(config: WorkerConfig, sink: WorkerEventSink, jobs?: AuthorizedJobs, history?: unknown): WorkerRuntime & { readonly jobs: AuthorizedJobs } {
  assertPolicyCompatibility(history);
  const authorizedJobs = jobs ?? unavailableJobs(() => sink.reliability({ service: "worker", version: config.SERVICE_VERSION, operation: "job", outcome: "error" }));
  const idleHandle = setInterval(() => undefined, MAXIMUM_TIMER_DELAY_MILLISECONDS);
  try {
    sink.reliability({
      service: "worker",
      version: config.SERVICE_VERSION,
      operation: "startup",
      outcome: "ok",
    });
    sink.readiness(readinessReport("worker", config.SERVICE_VERSION));
  } catch (error: unknown) {
    clearInterval(idleHandle);
    throw error;
  }

  let stopping = false;
  let resolveClosed: () => void = () => undefined;
  let rejectClosed: (error: unknown) => void = () => undefined;
  const closed = new Promise<void>((resolve, reject) => {
    resolveClosed = resolve;
    rejectClosed = reject;
  });

  return {
    jobs: authorizedJobs,
    closed,
    stop: () => {
      if (stopping) {
        return closed;
      }
      stopping = true;
      clearInterval(idleHandle);
      const closeTask = Promise.resolve().then(() => {
        sink.reliability({
          service: "worker",
          version: config.SERVICE_VERSION,
          operation: "shutdown",
          outcome: "ok",
        });
      });
      void closeTask.then(resolveClosed, rejectClosed);
      return closed;
    },
  };
}
