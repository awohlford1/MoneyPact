import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ReadinessReport } from "@cobudget/contracts/health";
import type { ReliabilityEvent } from "@cobudget/contracts/telemetry";

import { loadWorkerConfigFrom } from "./config.js";
import { startWorker as startRuntime } from "./runtime.js";
import { testHistory } from "./authorization/test-support.js";

const startWorker = (config: Parameters<typeof startRuntime>[0], sink: Parameters<typeof startRuntime>[1]) => startRuntime(config, sink, undefined, testHistory);

const config = loadWorkerConfigFrom({
  LOG_LEVEL: "info",
  NODE_ENV: "test",
  SERVICE_VERSION: "test-sha",
});

describe("worker runtime", () => {
  it("reports startup and readiness, stays open, and shuts down exactly once", async () => {
    const reliability: ReliabilityEvent[] = [];
    const readiness: ReadinessReport[] = [];
    const worker = startWorker(config, {
      readiness: (report) => readiness.push(report),
      reliability: (event) => reliability.push(event),
    });
    let closed = false;
    void worker.closed.then(() => {
      closed = true;
    });

    await Promise.resolve();
    assert.equal(closed, false);
    assert.deepEqual(reliability, [
      {
        service: "worker",
        version: "test-sha",
        operation: "startup",
        outcome: "ok",
      },
    ]);
    assert.deepEqual(readiness, [
      { service: "worker", version: "test-sha", status: "ready" },
    ]);

    const firstStop = worker.stop();
    const secondStop = worker.stop();
    assert.equal(firstStop, secondStop);
    assert.equal(firstStop, worker.closed);
    await Promise.all([firstStop, worker.closed]);

    assert.equal(closed, true);
    assert.deepEqual(reliability.at(-1), {
      service: "worker",
      version: "test-sha",
      operation: "shutdown",
      outcome: "ok",
    });
    assert.equal(reliability.length, 2);
  });

  it("clears its lifetime handle when startup reporting fails", () => {
    assert.throws(
      () =>
        startWorker(config, {
          readiness: () => {
            throw new Error("readiness output failed");
          },
          reliability: () => undefined,
        }),
      /readiness output failed/,
    );
  });

  it("rejects one stable close promise when shutdown reporting fails", async () => {
    const worker = startWorker(config, {
      readiness: () => undefined,
      reliability: (event) => {
        if (event.operation === "shutdown") {
          throw new Error("shutdown output failed");
        }
      },
    });

    const firstStop = worker.stop();
    const secondStop = worker.stop();

    assert.equal(firstStop, secondStop);
    assert.equal(firstStop, worker.closed);
    await Promise.all([
      assert.rejects(firstStop, /shutdown output failed/),
      assert.rejects(worker.closed, /shutdown output failed/),
    ]);
  });
});
