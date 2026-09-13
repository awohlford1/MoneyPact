import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

type ShutdownSignal = "SIGINT" | "SIGTERM";

// Generated at test time (never a literal) so no fixture value in this file
// shapes like a key/token for scripts/secret_scanner.py's generic-api-key rule.
const TEST_LOCAL_KEY = randomBytes(32).toString("base64");

interface ProcessResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stderr: string;
  readonly stdout: string;
}

// Same entrypoint logic, with an explicit synthetic release row for lifecycle tests.
const sourceEntry = resolve(dirname(fileURLToPath(import.meta.url)), "authorization/process-fixture.ts");

// A cold Windows checkout can spend more than ten seconds starting the tsx
// loader from a synced filesystem. Keep the Linux/CI watchdog tight while
// bounding the slower supported local path instead of accepting a flaky test.
const processDeadlineMs = process.platform === "win32" ? 30_000 : 10_000;

async function availablePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListening, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListening);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise<void>((resolveClosed, reject) => {
    server.close((error) => (error ? reject(error) : resolveClosed()));
  });
  return address.port;
}

async function runUntilSignal(signal: ShutdownSignal): Promise<string> {
  const port = await availablePort();
  const child = spawn(process.execPath, ["--import=tsx", sourceEntry], {
    env: {
      API_PORT: String(port),
      LOG_LEVEL: "info",
      NODE_ENV: "test",
      SERVICE_VERSION: "signal-test",
      COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local",
      COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: TEST_LOCAL_KEY,
      COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "test-v1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  return new Promise<string>((resolveRun, reject) => {
    let stdout = "";
    let stderr = "";
    let sent = false;

    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`API did not stop after ${signal}. stdout=${stdout} stderr=${stderr}`));
    }, processDeadlineMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (!sent && stdout.includes('"operation":"startup"')) {
        sent = true;
        child.kill(signal);
      }
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code, receivedSignal) => {
      clearTimeout(timeout);
      try {
        assert.equal(code, 0, stderr);
        assert.equal(receivedSignal, null);
        assert.equal(sent, true, "the API exited before reporting readiness");
        assert.match(stdout, /"operation":"shutdown"/);
        resolveRun(stdout);
      } catch (error: unknown) {
        reject(error);
      }
    });
  });
}

async function runToExit(
  environment: Readonly<Record<string, string>>,
): Promise<ProcessResult> {
  const child = spawn(process.execPath, ["--import=tsx", sourceEntry], {
    env: environment,
    stdio: ["ignore", "pipe", "pipe"],
  });

  return new Promise<ProcessResult>((resolveRun, reject) => {
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`API did not exit. stdout=${stdout} stderr=${stderr}`));
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

describe("API startup failures", () => {
  for (const name of ["NODE_ENV", "LOG_LEVEL", "SERVICE_VERSION", "API_PORT"]) {
    it(`exits without readiness for missing ${name} and leaves no listener`, async () => {
      const port = await availablePort();
      const environment: Record<string, string> = { NODE_ENV: "test", LOG_LEVEL: "info", SERVICE_VERSION: "CBD113_VALUE_MUST_NOT_APPEAR", API_PORT: String(port) };
      delete environment[name];
      const result = await runToExit(environment);
      assert.equal(result.code, 1);
      assert.equal(result.stdout, "");
      assert.ok(result.stderr.includes(name));
      assert.ok(!result.stderr.includes("CBD113_VALUE_MUST_NOT_APPEAR"));
      const probe = createServer();
      await new Promise<void>((accept, reject) => { probe.once("error", reject); probe.listen(port, "127.0.0.1", accept); });
      await new Promise<void>((accept, reject) => probe.close(error => error ? reject(error) : accept()));
    });
  }
  for (const name of ["NODE_ENV", "LOG_LEVEL", "API_PORT", "API_LISTEN_ADDRESS"]) {
    it(`rejects malformed ${name} without logging its value`, async () => {
      const result = await runToExit({ NODE_ENV: "test", LOG_LEVEL: "info", API_PORT: "3001", SERVICE_VERSION: "local", [name]: "CBD113_VALUE_MUST_NOT_APPEAR" });
      assert.equal(result.code, 1);
      assert.equal(result.stdout, "");
      assert.ok(result.stderr.includes(name));
      assert.ok(!result.stderr.includes("CBD113_VALUE_MUST_NOT_APPEAR"));
    });
  }
  it("fails closed with a sanitized configuration diagnostic", async () => {
    const result = await runToExit({
      LOG_LEVEL: "info",
      NODE_ENV: "test",
      SERVICE_VERSION: "must-not-leak",
    });

    assert.equal(result.code, 1);
    assert.equal(result.signal, null);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /API_PORT/);
    assert.doesNotMatch(result.stderr, /must-not-leak/);
  });

  it("reports only an allowlisted code when the listen port is occupied", async () => {
    const blocker = createServer();
    await new Promise<void>((resolveListening, reject) => {
      blocker.once("error", reject);
      blocker.listen(0, "127.0.0.1", resolveListening);
    });
    const address = blocker.address();
    assert.ok(address && typeof address === "object");

    try {
      const result = await runToExit({
        API_LISTEN_ADDRESS: "127.0.0.1",
        API_PORT: String(address.port),
        LOG_LEVEL: "info",
        NODE_ENV: "test",
        SERVICE_VERSION: "must-not-leak",
        COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local",
        COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: TEST_LOCAL_KEY,
        COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "test-v1",
      });

      assert.equal(result.code, 1);
      assert.equal(result.signal, null);
      assert.equal(result.stdout, "");
      assert.equal(result.stderr, "API startup failed (EADDRINUSE).\n");
    } finally {
      await new Promise<void>((resolveClosed, reject) => {
        blocker.close((error) => (error ? reject(error) : resolveClosed()));
      });
    }
  });
});

/** Confirms the process exited before any listener bound `port`. */
async function assertNoListener(port: number): Promise<void> {
  const probe = createServer();
  await new Promise<void>((accept, reject) => {
    probe.once("error", reject);
    probe.listen(port, "127.0.0.1", accept);
  });
  await new Promise<void>((accept, reject) => {
    probe.close((error) => (error ? reject(error) : accept()));
  });
}

describe("API field-encryption startup enforcement (CBD246-SECURITY-002 finding 1)", () => {
  it("exits before opening a listener or reporting readiness when the provider is missing", async () => {
    const port = await availablePort();
    const result = await runToExit({
      NODE_ENV: "test",
      LOG_LEVEL: "info",
      SERVICE_VERSION: "field-encryption-test",
      API_PORT: String(port),
    });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes("COBUDGET_FIELD_ENCRYPTION_PROVIDER"));
    await assertNoListener(port);
  });

  it("exits before opening a listener or reporting readiness when the local key is missing", async () => {
    const port = await availablePort();
    const result = await runToExit({
      NODE_ENV: "test",
      LOG_LEVEL: "info",
      SERVICE_VERSION: "field-encryption-test",
      API_PORT: String(port),
      COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local",
      COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "test-v1",
    });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes("COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY"));
    await assertNoListener(port);
  });

  it("exits before opening a listener or reporting readiness when the key version is missing", async () => {
    const port = await availablePort();
    const result = await runToExit({
      NODE_ENV: "test",
      LOG_LEVEL: "info",
      SERVICE_VERSION: "field-encryption-test",
      API_PORT: String(port),
      COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local",
      COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: TEST_LOCAL_KEY,
    });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes("COBUDGET_FIELD_ENCRYPTION_KEY_VERSION"));
    await assertNoListener(port);
  });

  it("exits before opening a listener or reporting readiness when NODE_ENV=production selects the local provider", async () => {
    const port = await availablePort();
    const result = await runToExit({
      NODE_ENV: "production",
      LOG_LEVEL: "info",
      SERVICE_VERSION: "field-encryption-test",
      API_PORT: String(port),
      COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local",
      COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: TEST_LOCAL_KEY,
      COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "test-v1",
    });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes("local field-encryption provider is refused"));
    await assertNoListener(port);
  });

  it("exits before opening a listener or reporting readiness when the kms provider has no client", async () => {
    const port = await availablePort();
    const result = await runToExit({
      NODE_ENV: "test",
      LOG_LEVEL: "info",
      SERVICE_VERSION: "field-encryption-test",
      API_PORT: String(port),
      COBUDGET_FIELD_ENCRYPTION_PROVIDER: "kms",
    });

    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.ok(result.stderr.includes("KMS field-encryption provider has no client"));
    await assertNoListener(port);
  });
});

describe("API process lifecycle", { skip: process.platform === "win32" }, () => {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    it(`closes cleanly after ${signal}`, async () => {
      const stdout = await runUntilSignal(signal);

      for (const line of stdout.trim().split("\n")) {
        const event = JSON.parse(line) as Record<string, unknown>;
        assert.deepEqual(Object.keys(event).sort(), ["operation", "outcome", "service", "version"]);
      }
    });
  }
});
