import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { afterEach, describe, it } from "node:test";

import type { NestFastifyApplication } from "@nestjs/platform-fastify";

import { createApiApplication as createRuntimeApplication } from "./application.js";
import { testHistory } from "./authorization/test-support.js";
import { loadApiConfigFrom } from "./config.js";
import { HTTP_LIMITS } from "./http-security.js";
import type { ReliabilitySink } from "./telemetry.js";

const createApiApplication = (config: Parameters<typeof createRuntimeApplication>[0], sink: ReliabilitySink) => createRuntimeApplication(config, sink, testHistory);
// Generated at test time (never a literal) so no fixture value in this file
// shapes like a key/token for scripts/secret_scanner.py's generic-api-key rule.
const TEST_LOCAL_KEY = randomBytes(32).toString("base64");

const config = loadApiConfigFrom({
  API_PORT: "3001",
  LOG_LEVEL: "info",
  NODE_ENV: "test",
  SERVICE_VERSION: "test-sha",
  COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local",
  COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: TEST_LOCAL_KEY,
  COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "test-v1",
});

describe("API application", () => {
  let app: NestFastifyApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it("reports only the API process's readiness", async () => {
    const events: Parameters<ReliabilitySink>[0][] = [];
    app = await createApiApplication(config, (event) => events.push(event));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const response = await app.inject({ method: "GET", url: "/health" });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      service: "api",
      version: "test-sha",
      status: "ready",
    });
    assert.equal("dependencies" in response.json<Record<string, unknown>>(), false);
    assert.deepEqual(events, []);
  });

  it("serves an OpenAPI document at a stable path", async () => {
    app = await createApiApplication(config, () => undefined);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const response = await app.inject({ method: "GET", url: "/openapi.json" });
    const document = response.json<{ paths: Record<string, unknown> }>();

    assert.equal(response.statusCode, 200);
    assert.ok("/health" in document.paths);
  });

  it("applies security and no-cache headers without exposing the framework", async () => {
    app = await createApiApplication(config, () => undefined);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: { origin: "https://attacker.invalid", "x-request-id": "caller-controlled" },
    });

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["access-control-allow-origin"], undefined);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.headers["content-security-policy"], "default-src 'none';base-uri 'none';form-action 'none';frame-ancestors 'none'");
    assert.equal(response.headers["permissions-policy"], "camera=(), geolocation=(), microphone=(), payment=(), usb=()");
    assert.equal(response.headers.pragma, "no-cache");
    assert.equal(response.headers["referrer-policy"], "no-referrer");
    assert.equal(response.headers["strict-transport-security"], undefined);
    assert.equal(response.headers["surrogate-control"], "no-store");
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    assert.equal(response.headers["x-frame-options"], "DENY");
    assert.equal(response.headers["x-powered-by"], undefined);
    assert.equal(response.headers["x-request-id"], undefined);

    const preflight = await app.inject({
      method: "OPTIONS",
      url: "/health",
      headers: {
        origin: "https://attacker.invalid",
        "access-control-request-method": "GET",
      },
    });
    assert.equal(preflight.statusCode, 404);
    assert.equal(preflight.headers["access-control-allow-origin"], undefined);
    assert.equal(preflight.headers["cache-control"], "no-store");
    assert.equal(preflight.headers["x-content-type-options"], "nosniff");
  });

  it("rejects oversized request bodies before a handler receives them", async () => {
    app = await createApiApplication(config, () => undefined);
    const server = app.getHttpAdapter().getInstance();
    let handlerCalled = false;
    server.post("/_test/body-limit", async () => {
      handlerCalled = true;
      return { accepted: true };
    });
    await app.init();
    await server.ready();

    const response = await app.inject({
      method: "POST",
      url: "/_test/body-limit",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ value: "x".repeat(HTTP_LIMITS.bodyBytes) }),
    });

    assert.equal(response.statusCode, 413);
    assert.equal(handlerCalled, false);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(response.headers["x-content-type-options"], "nosniff");
  });

  it("emits HSTS only for production responses", async () => {
    const productionConfig = loadApiConfigFrom({
      API_PORT: "3001",
      LOG_LEVEL: "info",
      NODE_ENV: "production",
      SERVICE_VERSION: "test-sha",
      COBUDGET_FIELD_ENCRYPTION_PROVIDER: "local",
      COBUDGET_FIELD_ENCRYPTION_LOCAL_KEY: TEST_LOCAL_KEY,
      COBUDGET_FIELD_ENCRYPTION_KEY_VERSION: "test-v1",
    });
    app = await createApiApplication(productionConfig, () => undefined);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const response = await app.inject({ method: "GET", url: "/health" });

    assert.equal(
      response.headers["strict-transport-security"],
      "max-age=31536000",
    );
  });

  it("emits an allowlisted shutdown event when the application closes", async () => {
    const events: Parameters<ReliabilitySink>[0][] = [];
    app = await createApiApplication(config, (event) => events.push(event));
    await app.init();

    await app.close();
    app = undefined;

    assert.deepEqual(events, [
      {
        service: "api",
        version: "test-sha",
        operation: "shutdown",
        outcome: "ok",
      },
    ]);
  });
});
