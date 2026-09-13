import { testHistory } from "./test-support.js";
import { EventEmitter } from "node:events";
const signalSource = new EventEmitter();
process.on("SIGINT", () => signalSource.emit("SIGINT"));
process.on("SIGTERM", () => signalSource.emit("SIGTERM"));
import { ConfigError } from "@cobudget/contracts/config";
import {
  KmsProviderNotConfiguredError,
  LocalProviderNotAllowedError,
  MissingFieldEncryptionConfigError,
} from "@cobudget/data-access/encryption";

import { loadWorkerConfig, resolveWorkerFieldEncryptionProvider } from "../config.js";
import { startWorker } from "../runtime.js";
import { createShutdownCoordinator, ShutdownTimeoutError } from "../signals.js";
import { stdoutWorkerEventSink, writeStartupDiagnostic } from "../telemetry.js";

/**
 * Configuration-shaped startup failures (CBD246-SECURITY-002 finding 1): each
 * names the missing variable or refused policy and never a secret value, so
 * it is safe to write to the startup diagnostic the same way a `ConfigError`
 * is.
 */
function isConfigurationLikeStartupError(error: unknown): boolean {
  return (
    error instanceof ConfigError
    || error instanceof MissingFieldEncryptionConfigError
    || error instanceof LocalProviderNotAllowedError
    || error instanceof KmsProviderNotConfiguredError
  );
}

process.on("uncaughtException", () => {
  writeStartupDiagnostic("Worker stopped after an uncaught exception.");
  process.exit(1);
});

process.on("unhandledRejection", () => {
  writeStartupDiagnostic("Worker stopped after an unhandled rejection.");
  process.exit(1);
});

export async function bootstrap(): Promise<void> {
  const shutdown = createShutdownCoordinator(signalSource);
  try {
    const config = loadWorkerConfig();
    // Pre-effect startup dependency (CBD246-SECURITY-002 finding 1): resolved
    // before the worker starts or reports readiness, so a missing key, a
    // missing key version, an unconfigured KMS client, or a local-provider
    // selection outside NODE_ENV=development/test fails startup closed.
    resolveWorkerFieldEncryptionProvider(config);
    const worker = startWorker(config, stdoutWorkerEventSink, undefined, testHistory);
    await shutdown.waitForShutdown(worker);
  } finally {
    shutdown.dispose();
  }
}

try {
  await bootstrap();
} catch (error: unknown) {
  if (isConfigurationLikeStartupError(error)) {
    writeStartupDiagnostic((error as Error).message);
  } else if (error instanceof ShutdownTimeoutError) {
    writeStartupDiagnostic(error.message);
    process.exit(1);
  } else {
    writeStartupDiagnostic("Worker stopped after an internal lifecycle error.");
    process.exit(1);
  }
  process.exitCode = 1;
}
