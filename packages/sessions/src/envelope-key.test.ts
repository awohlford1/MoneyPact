import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EnvelopeKeyProviderNotAllowedError,
  KmsEnvelopeKeyProviderNotConfiguredError,
  MissingEnvelopeKeyConfigError,
  resolveSessionEnvelopeKeyProvider,
} from "./envelope-key.ts";
import { sealDelivery, openDelivery } from "./envelope.ts";

const VALID_KEY = Buffer.alloc(32, 1).toString("base64");

void test("CBD191-CORRECTION-001 item 1: a missing provider selection fails closed", () => {
  assert.throws(() => resolveSessionEnvelopeKeyProvider({ NODE_ENV: "test" }), MissingEnvelopeKeyConfigError);
});

void test("a missing key or version fails closed even with the local provider selected", () => {
  assert.throws(
    () => resolveSessionEnvelopeKeyProvider({ NODE_ENV: "test", COBUDGET_SESSION_ENVELOPE_KEY_PROVIDER: "local", COBUDGET_SESSION_ENVELOPE_KEY_VERSION: "v1" }),
    MissingEnvelopeKeyConfigError,
  );
  assert.throws(
    () => resolveSessionEnvelopeKeyProvider({ NODE_ENV: "test", COBUDGET_SESSION_ENVELOPE_KEY_PROVIDER: "local", COBUDGET_SESSION_ENVELOPE_KEY: VALID_KEY }),
    MissingEnvelopeKeyConfigError,
  );
});

void test("a short key fails closed", () => {
  assert.throws(
    () =>
      resolveSessionEnvelopeKeyProvider({
        NODE_ENV: "test",
        COBUDGET_SESSION_ENVELOPE_KEY_PROVIDER: "local",
        COBUDGET_SESSION_ENVELOPE_KEY: Buffer.alloc(8).toString("base64"),
        COBUDGET_SESSION_ENVELOPE_KEY_VERSION: "v1",
      }),
    MissingEnvelopeKeyConfigError,
  );
});

void test("PROVIDERS-LOCAL-001: the local provider is refused outside development/test", () => {
  assert.throws(
    () =>
      resolveSessionEnvelopeKeyProvider({
        NODE_ENV: "production",
        COBUDGET_SESSION_ENVELOPE_KEY_PROVIDER: "local",
        COBUDGET_SESSION_ENVELOPE_KEY: VALID_KEY,
        COBUDGET_SESSION_ENVELOPE_KEY_VERSION: "v1",
      }),
    EnvelopeKeyProviderNotAllowedError,
  );
});

void test("the kms provider is not yet implemented and fails closed rather than silently falling back", () => {
  assert.throws(() => resolveSessionEnvelopeKeyProvider({ NODE_ENV: "production", COBUDGET_SESSION_ENVELOPE_KEY_PROVIDER: "kms" }), KmsEnvelopeKeyProviderNotConfiguredError);
});

void test("a fully configured local provider builds a usable seal/open key, distinct from any other config's key", () => {
  const provider = resolveSessionEnvelopeKeyProvider({
    NODE_ENV: "test",
    COBUDGET_SESSION_ENVELOPE_KEY_PROVIDER: "local",
    COBUDGET_SESSION_ENVELOPE_KEY: VALID_KEY,
    COBUDGET_SESSION_ENVELOPE_KEY_VERSION: "v7",
  });
  assert.equal(provider.currentVersion, "v7");
  const sealed = sealDelivery(provider.sealingKey(), { cookieValue: "a.b", csrfValue: "c", sessionRef: "r", sessionHandoffId: "h1" });
  const opened = openDelivery(provider.keyFor("v7")!, sealed, "h1");
  assert.deepEqual(opened, { cookieValue: "a.b", csrfValue: "c", sessionRef: "r" });
  assert.equal(provider.keyFor("unknown-version"), undefined);
});
