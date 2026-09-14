import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { ConfigError, undocumentedVariables } from "@cobudget/contracts/config";

import { apiConfigSchema, loadApiConfigFrom, resolveApiListenAddress } from "./config.js";
import { sessionConfigSchema } from "./config.js";
import { identityConfigSchema } from "./identity/config.ts";

// Every CBD-191 session and CBD-190 identity variable is optional at the schema level (required only under
// COBUDGET_IDENTITY_PROVIDER=local, enforced by loadApiConfigFrom); absent means `undefined`, never a default.
const OPTIONAL_IDENTITY_VARIABLES = Object.fromEntries(Object.keys({ ...sessionConfigSchema, ...identityConfigSchema }).map((name) => [name, undefined]));

// Generated at test time (never a literal) so no fixture value in this file
// shapes like a key/token for scripts/secret_scanner.py's generic-api-key rule.
const TEST_LOCAL_KEY = randomBytes(32).toString("base64");

const validEnvironment = {
  API_PORT: "3001",
  LOG_LEVEL: "info",
  NODE_ENV: "test",
  SERVICE_VERSION: "test-sha",
  // COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY and _KEY_VERSION are required by
  // loadApiConfigFrom whenever the provider is "local" (CBD246-SECURITY-002
  // finding 1: fieldEncryptionConfigFailures runs immediately after the
  // schema load), so both are present in every happy-path fixture below.
  COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local",
  COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: TEST_LOCAL_KEY,
  COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "test-v1",
} as const;

describe("API configuration", () => {
  it("preserves optional binding defaults and validates explicit IP addresses", () => {
    for (const NODE_ENV of ["development", "test", "production"]) {
      const config = loadApiConfigFrom({ ...validEnvironment, NODE_ENV });
      assert.equal(resolveApiListenAddress(config), NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");
      const optional: string | undefined = config.API_LISTEN_ADDRESS;
      // @ts-expect-error — the environment override remains optional.
      const required: string = config.API_LISTEN_ADDRESS;
      assert.equal(optional, required);
    }
    for (const address of ["127.0.0.1", "0.0.0.0", "::1", "::"]) {
      assert.equal(resolveApiListenAddress(loadApiConfigFrom({ ...validEnvironment, API_LISTEN_ADDRESS: address })), address);
    }
    for (const address of ["localhost", "999.1.1.1", "127.0.0.1:80", "CBD113_VALUE_MUST_NOT_APPEAR"]) {
      assert.throws(() => loadApiConfigFrom({ ...validEnvironment, API_LISTEN_ADDRESS: address }), (error: unknown) => {
        assert.ok(error instanceof ConfigError);
        assert.match(error.message, /API_LISTEN_ADDRESS/);
        assert.ok(!JSON.stringify(error).includes(address));
        assert.ok(!error.message.includes(address));
        return true;
      });
    }
  });
  it("loads through the shared typed configuration contract", () => {
    assert.deepEqual(loadApiConfigFrom(validEnvironment), {
      ...OPTIONAL_IDENTITY_VARIABLES,
      API_PORT: 3001,
      API_LISTEN_ADDRESS: undefined,
      LOG_LEVEL: "info",
      NODE_ENV: "test",
      SERVICE_VERSION: "test-sha",
      COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local",
      COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: TEST_LOCAL_KEY,
      COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "test-v1",
    });
  });

  it("allows an explicit API listen address override", () => {
    assert.deepEqual(
      loadApiConfigFrom({ ...validEnvironment, API_LISTEN_ADDRESS: "0.0.0.0" }),
      {
        ...OPTIONAL_IDENTITY_VARIABLES,
        API_PORT: 3001,
        API_LISTEN_ADDRESS: "0.0.0.0",
        LOG_LEVEL: "info",
        NODE_ENV: "test",
        SERVICE_VERSION: "test-sha",
        COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local",
        COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: TEST_LOCAL_KEY,
        COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "test-v1",
      },
    );
  });

  it("fails startup naming a missing variable without echoing values", () => {
    const { API_PORT: _removed, ...withoutPort } = validEnvironment;

    assert.throws(
      () => loadApiConfigFrom(withoutPort),
      (error: unknown) => {
        assert.ok(error instanceof ConfigError);
        assert.match(error.message, /API_PORT/);
        assert.doesNotMatch(error.message, /test-sha/);
        return true;
      },
    );
  });

  it("rejects a malformed port instead of coercing or defaulting it", () => {
    assert.throws(
      () => loadApiConfigFrom({ ...validEnvironment, API_PORT: "three thousand" }),
      (error: unknown) => {
        assert.ok(error instanceof ConfigError);
        assert.match(error.message, /API_PORT/);
        assert.doesNotMatch(error.message, /three thousand/);
        return true;
      },
    );
  });

  it("fails startup naming the missing local key when the provider is local (CBD246-SECURITY-002 finding 1)", () => {
    const { COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: _removed, ...withoutKey } = validEnvironment;

    assert.throws(
      () => loadApiConfigFrom(withoutKey),
      (error: unknown) => {
        assert.ok(error instanceof ConfigError);
        assert.match(error.message, /COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY/);
        assert.doesNotMatch(error.message, new RegExp(TEST_LOCAL_KEY));
        return true;
      },
    );
  });

  it("fails startup naming the missing key version when the provider is local (CBD246-SECURITY-002 finding 1)", () => {
    const { COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: _removed, ...withoutVersion } = validEnvironment;

    assert.throws(
      () => loadApiConfigFrom(withoutVersion),
      (error: unknown) => {
        assert.ok(error instanceof ConfigError);
        assert.match(error.message, /COBUDGET_FIELD_ENCRYPTION_KEY_VERSION/);
        return true;
      },
    );
  });

  it("does not require a local key or key version for the kms provider", () => {
    const { COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: _removedKey, COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: _removedVersion, ...withoutLocalMaterial } = validEnvironment;

    const config = loadApiConfigFrom({ ...withoutLocalMaterial, COBUDGET_FIELD_ENCRYPTION_PROVIDER: "kms" });
    assert.equal(config.COBUDGET_FIELD_ENCRYPTION_PROVIDER, "kms");
  });

  it("documents every API variable in the repository environment template", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const envExample = readFileSync(resolve(here, "../../../.env.example"), "utf8");

    assert.deepEqual(undocumentedVariables(apiConfigSchema, envExample), []);
  });
});
