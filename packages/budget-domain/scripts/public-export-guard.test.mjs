import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  missingRuntimeExports,
  missingTypeExports,
  runtimeDiagnostic,
  typeDiagnostic,
} from "./public-export-guard.mjs";

const fixture = (name) => new URL(`./fixtures/public-exports/${name}`, import.meta.url);

describe("public export guard mutation fixtures", () => {
  it("identifies an omitted runtime symbol and module", async () => {
    const module = await import("./fixtures/public-exports/runtime-missing/module.mjs");
    const barrel = await import("./fixtures/public-exports/runtime-missing/index.mjs");
    const missing = missingRuntimeExports(module, barrel);

    assert.deepEqual(missing, ["requiredRuntime"]);
    assert.equal(
      runtimeDiagnostic("module.mjs", "fixture", missing),
      "module.mjs exports requiredRuntime which fixture/index.ts does not re-export",
    );
  });

  it("identifies an omitted public type but ignores an intentionally private type", () => {
    const moduleSource = readFileSync(fixture("type-missing/module.ts"), "utf8");
    const barrelSource = readFileSync(fixture("type-missing/index.ts"), "utf8");
    const missing = missingTypeExports(moduleSource, barrelSource, "./module.ts");

    assert.deepEqual(missing, ["RequiredType"]);
    assert.equal(
      typeDiagnostic("module.ts", "fixture", missing),
      "module.ts exports type RequiredType which fixture/index.ts does not re-export",
    );
  });
});
