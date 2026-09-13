import "reflect-metadata";

import { ConfigError } from "@cobudget/contracts/config";
import {
  KmsProviderNotConfiguredError,
  LocalProviderNotAllowedError,
  MissingFieldEncryptionConfigError,
} from "@cobudget/data-access/encryption";

import { createApiApplication } from "./application.js";
import { resolveApiFieldEncryptionProvider, loadApiConfig } from "./config.js";
import { runApiBootstrap } from "./bootstrap.js";
import { stdoutReliabilitySink, writeStartupDiagnostic } from "./telemetry.js";

const SAFE_STARTUP_ERROR_CODES = new Set(["EACCES", "EADDRINUSE", "EADDRNOTAVAIL"]);

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

function messageForStartupFailure(error: unknown): string {
  const code =
    error instanceof Error && "code" in error && typeof error.code === "string"
      ? error.code
      : undefined;
  return code !== undefined && SAFE_STARTUP_ERROR_CODES.has(code)
    ? `API startup failed (${code}).`
    : "API startup failed with an internal error.";
}

process.on("uncaughtException", () => {
  writeStartupDiagnostic("API stopped after an uncaught exception.");
  process.exit(1);
});

process.on("unhandledRejection", () => {
  writeStartupDiagnostic("API stopped after an unhandled rejection.");
  process.exit(1);
});

export async function bootstrap(): Promise<void> {
  await runApiBootstrap({
    loadConfig: loadApiConfig,
    resolveEncryptionProvider: resolveApiFieldEncryptionProvider,
    createApplication: createApiApplication,
    sink: stdoutReliabilitySink,
  });
}

try {
  await bootstrap();
} catch (error: unknown) {
  if (isConfigurationLikeStartupError(error)) {
    writeStartupDiagnostic((error as Error).message);
  } else {
    writeStartupDiagnostic(messageForStartupFailure(error));
  }
  process.exitCode = 1;
}
