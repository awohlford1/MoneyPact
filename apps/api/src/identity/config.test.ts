import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConfigError } from "@cobudget/contracts/config";
import { loadApiConfigFrom } from "../config.ts";
import { identityConfigFailures, IdentityConfigurationError, resolveIdentityConfig } from "./config.ts";
import { APPLICATION_ORIGIN, CALLBACK_URI, CEREMONY_ORIGIN, ISSUER, localEnvironment } from "./test-support/harness.ts";

const failing = (overrides: Record<string, string | undefined>): string[] => identityConfigFailures({ ...localEnvironment(), ...overrides }).map((failure) => failure.variable);

describe("CBD-190-AC05 identity configuration (CT-190-014 cross-wire matrix)", () => {
  it("positive control: a complete local configuration for development and for test resolves", () => {
    for (const NODE_ENV of ["development", "test"] as const) {
      const config = resolveIdentityConfig({ ...localEnvironment(), NODE_ENV, COBUDGET_IDENTITY_ENVIRONMENT_ID: NODE_ENV });
      assert.equal(config.adapterKind, "local");
      if (config.adapterKind !== "local") return;
      assert.equal(config.environmentId, NODE_ENV);
      assert.equal(config.authorizationEndpoint, `${ISSUER}/authorize`);
      assert.deepEqual(config.scopes, ["openid"]);
      assert.deepEqual(config.allowedAlgorithms, ["RS256"]);
      assert.equal(config.mappingMaxAttempts, 4);
    }
    assert.deepEqual(failing({}), []);
    const loaded = loadApiConfigFrom(localEnvironment());
    assert.equal(loaded.COBUDGET_IDENTITY_PROVIDER, "local");
  });

  it("refuses the local provider outside NODE_ENV=development/test (section 3 rule 5)", () => {
    assert.ok(failing({ NODE_ENV: "production", COBUDGET_IDENTITY_ENVIRONMENT_ID: "production" }).includes("COBUDGET_IDENTITY_PROVIDER"));
    assert.throws(() => loadApiConfigFrom(localEnvironment({ NODE_ENV: "production", COBUDGET_IDENTITY_ENVIRONMENT_ID: "production" })), ConfigError);
  });

  it("rejects every single-field cross-environment substitution while the positive control passes", () => {
    const substitutions: [string, string][] = [
      ["COBUDGET_IDENTITY_ENVIRONMENT_ID", "production"],
      ["COBUDGET_IDENTITY_ENVIRONMENT_ID", "staging"],
      ["COBUDGET_IDENTITY_ENVIRONMENT_ID", "development"],
      ["COBUDGET_IDENTITY_ISSUER", "https://auth.moneypact.example/v1/identity/local"],
      ["COBUDGET_IDENTITY_ISSUER", `${APPLICATION_ORIGIN}/v1/identity/local`],
      ["COBUDGET_IDENTITY_ISSUER", `${CEREMONY_ORIGIN}/v1/identity/other`],
      ["COBUDGET_IDENTITY_APPLICATION_ORIGIN", "https://app.moneypact.example"],
      ["COBUDGET_IDENTITY_APPLICATION_ORIGIN", "http://app.internal:3000"],
      ["COBUDGET_IDENTITY_CEREMONY_ORIGIN", APPLICATION_ORIGIN],
      ["COBUDGET_IDENTITY_CEREMONY_ORIGIN", "http://192.168.1.10:3001"],
      ["COBUDGET_IDENTITY_CALLBACK_URI", "https://app.moneypact.example/v1/identity/callback"],
      ["COBUDGET_IDENTITY_CALLBACK_URI", `${APPLICATION_ORIGIN}/v1/identity/callback/extra`],
      ["COBUDGET_IDENTITY_CALLBACK_URI", `${APPLICATION_ORIGIN}/v1/identity/callback?x=1`],
      ["COBUDGET_IDENTITY_CALLBACK_URI", `${APPLICATION_ORIGIN}/v1/identity/callback#frag`],
      ["COBUDGET_IDENTITY_CALLBACK_URI", `${APPLICATION_ORIGIN}/v1/identity/*`],
      ["COBUDGET_IDENTITY_CLIENT_ID", "cobudget-*"],
      ["COBUDGET_IDENTITY_CHALLENGE_LIFETIME_SECONDS", "0"],
      ["COBUDGET_IDENTITY_EXCHANGE_LIFETIME_MS", "0"],
      ["COBUDGET_IDENTITY_MAPPING_MAX_ATTEMPTS", "0"],
      ["COBUDGET_IDENTITY_HANDOFF_LIFETIME_SECONDS", "0"],
    ];
    for (const [variable, value] of substitutions) {
      const failures = failing({ [variable]: value });
      assert.ok(failures.includes(variable), `${variable}=${value} should be rejected; got ${JSON.stringify(failures)}`);
    }
  });

  it("rejects absent required values by name under the local adapter, never with a default", () => {
    for (const variable of ["COBUDGET_IDENTITY_ENVIRONMENT_ID", "COBUDGET_IDENTITY_ISSUER", "COBUDGET_IDENTITY_CLIENT_ID", "COBUDGET_IDENTITY_APPLICATION_ORIGIN", "COBUDGET_IDENTITY_CEREMONY_ORIGIN", "COBUDGET_IDENTITY_CALLBACK_URI", "COBUDGET_IDENTITY_CHALLENGE_LIFETIME_SECONDS", "COBUDGET_IDENTITY_EXCHANGE_LIFETIME_MS", "COBUDGET_IDENTITY_MAPPING_MAX_ATTEMPTS", "COBUDGET_IDENTITY_HANDOFF_LIFETIME_SECONDS", "COBUDGET_IDENTITY_CLOCK_SKEW_SECONDS"]) {
      assert.ok(failing({ [variable]: undefined }).includes(variable), variable);
    }
    for (const variable of ["COBUDGET_SESSION_PEPPER", "COBUDGET_SESSION_IDLE_TIMEOUT_SECONDS", "COBUDGET_SESSION_ENVELOPE_KEY"]) {
      assert.throws(() => loadApiConfigFrom(localEnvironment({ [variable]: undefined })), (error: unknown) => error instanceof ConfigError && error.failures.some((failure) => failure.variable === variable));
    }
  });

  it("reports every failing variable at once and never echoes a value", () => {
    const env = localEnvironment({ COBUDGET_IDENTITY_ISSUER: "https://leaked.example/v1/identity/local", COBUDGET_IDENTITY_CLIENT_ID: undefined });
    assert.throws(() => resolveIdentityConfig(env), (error: unknown) => {
      assert.ok(error instanceof IdentityConfigurationError);
      assert.ok(error.failures.length >= 2);
      assert.ok(!error.message.includes("leaked.example"));
      return true;
    });
  });

  it("keeps cognito refused and treats unavailable or absent as the explicit no-sign-in path", () => {
    assert.ok(failing({ COBUDGET_IDENTITY_PROVIDER: "cognito" }).includes("COBUDGET_IDENTITY_PROVIDER"));
    assert.deepEqual(resolveIdentityConfig({ NODE_ENV: "production", COBUDGET_IDENTITY_PROVIDER: "unavailable" }), { adapterKind: "unavailable" });
    assert.deepEqual(resolveIdentityConfig({ NODE_ENV: "production" }), { adapterKind: "unavailable" });
    assert.equal(loadApiConfigFrom(localEnvironment({ COBUDGET_IDENTITY_PROVIDER: "unavailable", COBUDGET_IDENTITY_ISSUER: "not a url" })).COBUDGET_IDENTITY_PROVIDER, "unavailable");
    assert.ok(CALLBACK_URI.startsWith(APPLICATION_ORIGIN));
  });
});
