import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseCallbackEnvelope } from "./envelope.ts";

const STATE = "a".repeat(43);
const CODE = "b".repeat(43);

describe("CBD-190 section 4.2 callback envelope (CT-190-009)", () => {
  it("accepts exactly the success shape and exactly the provider-error shape", () => {
    assert.deepEqual(parseCallbackEnvelope(`code=${CODE}&state=${STATE}`), { kind: "success", code: CODE, state: STATE });
    assert.deepEqual(parseCallbackEnvelope(`state=${STATE}&error=access_denied&error_description=user%20left&error_uri=https%3A%2F%2Fx.invalid`), { kind: "provider_error", error: "access_denied", state: STATE });
  });

  it("classifies every other shape as malformed with the same uniform result", () => {
    const malformed = [
      undefined, "", `code=${CODE}`, `state=${STATE}`, `code=&state=${STATE}`, `code=${CODE}&state=`,
      `code=${CODE}&code=${CODE}&state=${STATE}`, `code=${CODE}&state=${STATE}&state=${STATE}`,
      `code=${CODE}&error=x&state=${STATE}`, `code=${CODE}&state=${STATE}&id_token=x`, `code=${CODE}&state=${STATE}&extra=1`,
      `code=${CODE}&state=${STATE}#fragment`, `code=${"c".repeat(600)}&state=${STATE}`, `code=${CODE}&state=${"s".repeat(44)}`,
      `code=${CODE}&state=${STATE.slice(1)}`, `code=%E0%A4%A&state=${STATE}`, `code=%00abc&state=${STATE}`, `code=${CODE}&state=${STATE}&`,
      `error=&state=${STATE}`, `error=${"e".repeat(65)}&state=${STATE}`, `error=access%20denied&state=${STATE}`,
      `error=access_denied&state=${STATE}&error_description=${"d".repeat(1025)}`, `code=${CODE}&state=${STATE}&error_description=x`,
      `code=${CODE}&state=${STATE}&nonce=x`, `code=${CODE}&state=${STATE}&redirect_uri=x`, "x".repeat(9_000),
    ];
    for (const query of malformed) assert.deepEqual(parseCallbackEnvelope(query), { kind: "malformed" }, String(query));
  });
});
