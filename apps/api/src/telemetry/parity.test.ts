import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { it } from "node:test";

/**
 * CBD-262-AC01: the sink, span, and error-mapping modules are shared
 * byte-for-byte between apps/api and apps/worker -- the same convention
 * `apps/*\/src/authorization/inventory.test.ts`'s "prevents drift" check
 * already enforces for the authorization boundary code. A single admitted
 * difference here would let one deployment unit accept a wider event, a
 * wider span attribute set, or a different error class than the other.
 */
it("prevents drift in the shared telemetry sink code across deployment units", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
  for (const name of ["sink.ts", "spans.ts", "errors.ts", "sink.negative-fixture.test.ts"]) {
    const api = readFileSync(join(root, "apps/api/src/telemetry", name), "utf8").replaceAll("\r\n", "\n");
    const worker = readFileSync(join(root, "apps/worker/src/telemetry", name), "utf8").replaceAll("\r\n", "\n");
    assert.equal(worker, api, name);
    assert.notEqual(worker + "\n// deliberate drift", api, name);
  }
});
