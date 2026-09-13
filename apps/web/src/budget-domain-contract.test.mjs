import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";

import * as income from "@cobudget/budget-domain/income";
import * as schedule from "@cobudget/budget-domain/schedule";
import * as shared from "@cobudget/budget-domain/shared";
import * as targets from "@cobudget/budget-domain/targets";

const PUBLIC_MODULES = { income, schedule, shared, targets };
const PUBLIC_SUBPATHS = Object.keys(PUBLIC_MODULES);
const SOURCE_ROOT = new URL("./", import.meta.url);

function sourceFiles(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        /\.[cm]?[jt]sx?$/.test(entry.name) &&
        !entry.name.includes(".test."),
    )
    .map((entry) => `${entry.parentPath}/${entry.name}`);
}

describe("budget-domain consumption contract", () => {
  for (const [subpath, publicModule] of Object.entries(PUBLIC_MODULES)) {
    it(`loads the public ${subpath} subpath`, () => {
      assert.ok(Object.keys(publicModule).length > 0, `${subpath} must expose runtime APIs`);
    });
  }

  it("rejects the private package root", async () => {
    await assert.rejects(import("@cobudget/budget-domain"), {
      code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
    });
  });

  it("rejects a private source path", async () => {
    await assert.rejects(import("@cobudget/budget-domain/src/schedule/period.ts"), {
      code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
    });
  });

  it("rejects a path below a public subpath", async () => {
    await assert.rejects(import("@cobudget/budget-domain/schedule/period.ts"), {
      code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
    });
  });

  it("contains no source-relative or private package imports", () => {
    const violations = sourceFiles(SOURCE_ROOT).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      const imports = [...source.matchAll(/(?:from\s+|import\s*\()(["'])([^"']+)\1/g)].map(
        (match) => match[2],
      );
      return imports
        .filter(
          (specifier) =>
            specifier.includes("packages/budget-domain/src/") ||
            (specifier.startsWith("@cobudget/budget-domain/") &&
              !PUBLIC_SUBPATHS.some((subpath) => specifier === `@cobudget/budget-domain/${subpath}`)),
        )
        .map((specifier) => `${file}: ${specifier}`);
    });

    assert.deepEqual(violations, []);
  });
});
