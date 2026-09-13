import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import type { ShutdownSignal } from "./signals.js";

interface ProcessResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stderr: string;
  readonly stdout: string;
}

// Same entrypoint logic, with an explicit synthetic release row for lifecycle tests.
const sourceEntry = resolve(dirname(fileURLToPath(import.meta.url)), "main.ts");

// Generated at test time (never a literal) so no fixture value in this file
// shapes like a key/token for scripts/secret_scanner.py's generic-api-key rule.
const TEST_LOCAL_KEY = randomBytes(32).toString("base64");

const validEnvironment = {
  LOG_LEVEL: "info",
  NODE_ENV: "test",
  SERVICE_VERSION: "process-test",
  COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local",
  COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: TEST_LOCAL_KEY,
  COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "test-v1",
};

// A cold Windows checkout can spend more than ten seconds starting the tsx
// loader from a synced filesystem. Keep the Linux/CI watchdog tight while
// bounding the slower supported local path instead of accepting a flaky test.
const processDeadlineMs = process.platform === "win32" ? 30_000 : 10_000;

function spawnWorker(environment: Readonly<Record<string, string>>) {
  return spawn(process.execPath, ["--import=tsx", sourceEntry], {
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function runToExit(environment: Readonly<Record<string, string>>): Promise<ProcessResult> {
  const child = spawnWorker(environment);

  return new Promise<ProcessResult>((resolveRun, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Worker did not exit. stdout=${stdout} stderr=${stderr}`));
    }, processDeadlineMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolveRun({ code, signal, stderr, stdout });
    });
  });
}

async function runUntilReady(signal?: ShutdownSignal): Promise<ProcessResult> {
  const child = spawnWorker(validEnvironment);

  return new Promise<ProcessResult>((resolveRun, reject) => {
    let stdout = "";
    let stderr = "";
    let ready = false;
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Worker did not become ready. stdout=${stdout} stderr=${stderr}`));
    }, processDeadlineMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (!ready && stdout.includes('"status":"ready"')) {
        ready = true;
        if (signal === undefined) {
          setTimeout(() => child.kill("SIGKILL"), 100);
        } else {
          child.kill(signal);
        }
      }
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, receivedSignal) => {
      clearTimeout(timeout);
      if (!ready) {
        reject(new Error(`Worker exited before readiness. stdout=${stdout} stderr=${stderr}`));
        return;
      }
      resolveRun({ code, signal: receivedSignal, stderr, stdout });
    });
  });
}

describe("worker process lifecycle", () => {
  for (const name of ["NODE_ENV", "LOG_LEVEL", "SERVICE_VERSION"]) {
    it(`rejects missing ${name} before readiness`, async () => {
      const environment: Record<string, string> = { ...validEnvironment, SERVICE_VERSION: "CBD113_VALUE_MUST_NOT_APPEAR" };
      delete environment[name];
      const result = await runToExit(environment);
      assert.equal(result.code, 1);
      assert.equal(result.stdout, "");
      assert.ok(result.stderr.includes(name));
      assert.ok(!result.stderr.includes("CBD113_VALUE_MUST_NOT_APPEAR"));
    });
  }
  for (const name of ["NODE_ENV", "LOG_LEVEL"]) {
    it(`rejects malformed ${name} without disclosing its value`, async () => {
      const result = await runToExit({ ...validEnvironment, [name]: "CBD113_VALUE_MUST_NOT_APPEAR" });
      assert.equal(result.code, 1);
      assert.equal(result.stdout, "");
      assert.ok(result.stderr.includes(name));
      assert.ok(!result.stderr.includes("CBD113_VALUE_MUST_NOT_APPEAR"));
    });
  }
  it("fails closed with a sanitized configuration diagnostic", async () => {
    const result = await runToExit({ LOG_LEVEL: "info", NODE_ENV: "test" });

    assert.equal(result.code, 1);
    assert.equal(result.signal, null);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /SERVICE_VERSION/);
  });

  it("never echoes a malformed configuration value", async () => {
    const malformedValue = "sensitive-invalid-log-level";
    const result = await runToExit({
      ...validEnvironment,
      LOG_LEVEL: malformedValue,
    });

    assert.equal(result.code, 1);
    assert.equal(result.signal, null);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /LOG_LEVEL/);
    assert.doesNotMatch(result.stderr, new RegExp(malformedValue));
  });

  it("logs startup and readiness, then stays running", async () => {
    const result = await runUntilReady();
    const lines = result.stdout.trim().split("\n").map((line) => JSON.parse(line));

    assert.equal(result.code, null);
    assert.equal(result.signal, "SIGKILL");
    assert.equal(result.stderr, "");
    assert.deepEqual(lines, [
      {
        service: "worker",
        version: "process-test",
        operation: "startup",
        outcome: "ok",
      },
      { service: "worker", version: "process-test", status: "ready" },
    ]);
  });
});

describe("worker field-encryption startup enforcement (CBD246-SECURITY-002 finding 1)", () => {
  it("exits before reporting readiness when the provider is missing", async () => {
    const result = await runToExit({
      LOG_LEVEL: "info",
      NODE_ENV: "test",
      SERVICE_VERSION: "field-encryption-test",
    });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes("COBUDGET_FIELD_ENCRYPTION_PROVIDER"));
  });

  it("exits before reporting readiness when the local key is missing", async () => {
    const result = await runToExit({
      LOG_LEVEL: "info",
      NODE_ENV: "test",
      SERVICE_VERSION: "field-encryption-test",
      COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local",
      COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "test-v1",
    });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes("COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY"));
  });

  it("exits before reporting readiness when the key version is missing", async () => {
    const result = await runToExit({
      LOG_LEVEL: "info",
      NODE_ENV: "test",
      SERVICE_VERSION: "field-encryption-test",
      COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local",
      COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: TEST_LOCAL_KEY,
    });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes("COBUDGET_FIELD_ENCRYPTION_KEY_VERSION"));
  });

  it("exits before reporting readiness when NODE_ENV=production selects the local provider", async () => {
    const result = await runToExit({
      LOG_LEVEL: "info",
      NODE_ENV: "production",
      SERVICE_VERSION: "field-encryption-test",
      COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local",
      COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: TEST_LOCAL_KEY,
      COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "test-v1",
    });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes("local field-encryption provider is refused"));
  });

  it("exits before reporting readiness when the kms provider has no client", async () => {
    const result = await runToExit({
      LOG_LEVEL: "info",
      NODE_ENV: "test",
      SERVICE_VERSION: "field-encryption-test",
      COBUDGET_FIELD_ENCRYPTION_PROVIDER: "kms",
    });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes("KMS field-encryption provider has no client"));
  });
});

describe("worker operating-system signals", { skip: process.platform === "win32" }, () => {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    it(`exits cleanly after ${signal} with no process left running`, async () => {
      const result = await runUntilReady(signal);
      const lines = result.stdout.trim().split("\n").map((line) => JSON.parse(line));

      assert.equal(result.code, 0, result.stderr);
      assert.equal(result.signal, null);
      assert.deepEqual(lines.at(-1), {
        service: "worker",
        version: "process-test",
        operation: "shutdown",
        outcome: "ok",
      });
    });
  }
});
