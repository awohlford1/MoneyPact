import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, it } from "node:test";

import { loadWorkerConfigFrom } from "./config.js";
import { startWorker as startRuntime } from "./runtime.js";
import { testHistory } from "./authorization/test-support.js";
import type { WorkerRuntime } from "./runtime.js";
const startWorker = (config: Parameters<typeof startRuntime>[0], sink: Parameters<typeof startRuntime>[1]) => startRuntime(config, sink, undefined, testHistory);
import {
  createShutdownCoordinator,
  ShutdownTimeoutError,
  waitForShutdownSignal,
} from "./signals.js";

const config = loadWorkerConfigFrom({
  LOG_LEVEL: "info",
  NODE_ENV: "test",
  SERVICE_VERSION: "test-sha",
});

describe("worker signal handling", () => {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    it(`stops cleanly on ${signal} and removes both handlers`, async () => {
      const source = new EventEmitter();
      const events: string[] = [];
      const worker = startWorker(config, {
        readiness: () => undefined,
        reliability: (event) => events.push(event.operation),
      });
      const waiting = waitForShutdownSignal(worker, source);

      source.emit(signal);
      await waiting;

      assert.deepEqual(events, ["startup", "shutdown"]);
      assert.equal(source.listenerCount("SIGINT"), 0);
      assert.equal(source.listenerCount("SIGTERM"), 0);
    });
  }

  it("calls stop once when both signals arrive together", async () => {
    const source = new EventEmitter();
    let stopCalls = 0;
    const closed = Promise.resolve();
    const worker: WorkerRuntime = {
      closed,
      stop: () => {
        stopCalls += 1;
        return closed;
      },
    };
    const waiting = waitForShutdownSignal(worker, source);

    source.emit("SIGINT");
    source.emit("SIGTERM");
    await waiting;

    assert.equal(stopCalls, 1);
    assert.equal(source.listenerCount("SIGINT"), 0);
    assert.equal(source.listenerCount("SIGTERM"), 0);
  });

  it("latches a signal received during startup before the worker exists", async () => {
    const source = new EventEmitter();
    const coordinator = createShutdownCoordinator(source);
    let stopCalls = 0;
    const closed = Promise.resolve();

    assert.equal(source.listenerCount("SIGINT"), 1);
    assert.equal(source.listenerCount("SIGTERM"), 1);
    source.emit("SIGTERM");

    const worker: WorkerRuntime = {
      closed,
      stop: () => {
        stopCalls += 1;
        return closed;
      },
    };
    await coordinator.waitForShutdown(worker);

    assert.equal(stopCalls, 1);
    assert.equal(source.listenerCount("SIGINT"), 0);
    assert.equal(source.listenerCount("SIGTERM"), 0);
  });

  it("cleans up a partial registration when the signal source rejects one handler", () => {
    const source = new EventEmitter();

    assert.throws(
      () =>
        createShutdownCoordinator({
          off: (signal, listener) => source.off(signal, listener),
          once: (signal, listener) => {
            if (signal === "SIGTERM") {
              throw new Error("registration failed");
            }
            return source.once(signal, listener);
          },
        }),
      /registration failed/,
    );
    assert.equal(source.listenerCount("SIGINT"), 0);
    assert.equal(source.listenerCount("SIGTERM"), 0);
  });

  it("refuses a second waiter without triggering shutdown twice", async () => {
    const source = new EventEmitter();
    const coordinator = createShutdownCoordinator(source);
    let stopCalls = 0;
    const closed = Promise.resolve();
    const worker: WorkerRuntime = {
      closed,
      stop: () => {
        stopCalls += 1;
        return closed;
      },
    };
    const firstWait = coordinator.waitForShutdown(worker);

    await assert.rejects(
      coordinator.waitForShutdown(worker),
      /can only be awaited once/,
    );
    source.emit("SIGINT");
    await firstWait;

    assert.equal(stopCalls, 1);
  });

  it("fails immediately when disposed before use", async () => {
    const source = new EventEmitter();
    const coordinator = createShutdownCoordinator(source);
    const closed = Promise.resolve();
    const worker: WorkerRuntime = { closed, stop: () => closed };

    coordinator.dispose();

    await assert.rejects(
      coordinator.waitForShutdown(worker),
      /disposed before it was awaited/,
    );
    assert.equal(source.listenerCount("SIGINT"), 0);
    assert.equal(source.listenerCount("SIGTERM"), 0);
  });

  it("rejects a shutdown that exceeds its deadline and removes both handlers", async () => {
    const source = new EventEmitter();
    const neverCloses = new Promise<void>(() => undefined);
    const worker: WorkerRuntime = {
      closed: neverCloses,
      stop: () => neverCloses,
    };
    const waiting = waitForShutdownSignal(worker, source, 5);

    source.emit("SIGTERM");

    await assert.rejects(waiting, ShutdownTimeoutError);
    assert.equal(source.listenerCount("SIGINT"), 0);
    assert.equal(source.listenerCount("SIGTERM"), 0);
  });

  it("rejects an invalid shutdown deadline before registering handlers", async () => {
    const source = new EventEmitter();
    const closed = Promise.resolve();
    const worker: WorkerRuntime = { closed, stop: () => closed };

    await assert.rejects(waitForShutdownSignal(worker, source, 0), RangeError);
    assert.equal(source.listenerCount("SIGINT"), 0);
    assert.equal(source.listenerCount("SIGTERM"), 0);
  });
});
