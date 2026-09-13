/**
 * Guards against barrel drift.
 *
 * Adding a public function to a module and forgetting to re-export it from its
 * `index.ts` fails silently: the function works, its tests pass, and consumers
 * simply cannot reach it. Nothing else in the toolchain notices, because an
 * unexported symbol is not an error.
 *
 * Modules are discovered from the filesystem rather than listed here. An earlier
 * version enumerated them by hand, which meant a newly added module had no
 * coverage until someone remembered to add it — reintroducing exactly the
 * "rely on remembering" weakness this file exists to remove.
 *
 * Runtime values are checked against the public package subpath consumers load.
 * Type-only declarations are checked from the TypeScript syntax tree below.
 * The public/private rule is structural: every declaration exported by a
 * non-test source module is public-required; an intentionally private helper
 * must omit `export`. That prevents private declarations from becoming false
 * positives without maintaining an exception list that can drift.
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { describe, it } from "node:test";

import * as incomeBarrel from "@cobudget/budget-domain/income";
import * as scheduleBarrel from "@cobudget/budget-domain/schedule";
import * as sharedBarrel from "@cobudget/budget-domain/shared";
import * as targetsBarrel from "@cobudget/budget-domain/targets";

import {
  missingRuntimeExports,
  missingTypeExports,
  runtimeDiagnostic,
  typeDiagnostic,
} from "../scripts/public-export-guard.mjs";

interface BarrelGroup {
  readonly label: string;
  readonly directory: URL;
}

/**
 * Every directory under `src/` that publishes a barrel.
 *
 * Discovered rather than listed, for the same reason the modules below are. An
 * earlier version named `shared` and `schedule` by hand, which meant a newly
 * added directory had no coverage until someone remembered to add it — the
 * exact "rely on remembering" weakness this file exists to remove, moved up one
 * level from the modules to the groups.
 */
function barrelGroups(): readonly BarrelGroup[] {
  return readdirSync(new URL("./", import.meta.url), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((label) => existsSync(new URL(`./${label}/index.ts`, import.meta.url)))
    .sort()
    .map((label) => ({ label, directory: new URL(`./${label}/`, import.meta.url) }));
}

const GROUPS = barrelGroups();
const PUBLIC_BARRELS: Readonly<Record<string, Record<string, unknown>>> = {
  income: incomeBarrel,
  schedule: scheduleBarrel,
  shared: sharedBarrel,
  targets: targetsBarrel,
};

describe("barrel discovery", () => {
  it("finds at least one barrel directory", () => {
    // Guards the guard, as within each group below: a discovery bug that found
    // nothing would register no assertions at all and pass in silence.
    assert.ok(GROUPS.length > 0, "no barrel directories discovered under src/");
  });
});

/**
 * Every non-test source module beneath a directory, excluding barrels.
 *
 * Recursive on purpose. A non-recursive `readdirSync` only sees modules at one
 * exact depth, so a file at `schedule/nested/orphan.ts` was invisible — the same
 * "only checks what it happens to look at" failure as the hand-written list this
 * replaced, moved down one level rather than removed.
 *
 * Paths are normalised to forward slashes because `recursive: true` returns
 * platform separators, and a URL needs `/` on every platform.
 */
function sourceModulesIn(directory: URL): readonly string[] {
  return readdirSync(directory, { recursive: true })
    .map((entry) => String(entry).replaceAll("\\", "/"))
    .filter(
      (name) =>
        name.endsWith(".ts") &&
        !name.endsWith(".test.ts") &&
        !name.split("/").includes("index.ts"),
    )
    .sort();
}

for (const group of GROUPS) {
  const fileNames = sourceModulesIn(group.directory);
  const barrel = PUBLIC_BARRELS[group.label];
  assert.ok(barrel, `no public package import is registered for ${group.label}`);

  describe(`${group.label} barrel`, () => {
    it("has at least one module to check", () => {
      // Guards the guard: a discovery bug that found nothing would otherwise
      // make every assertion below vacuously pass.
      assert.ok(fileNames.length > 0, `no source modules discovered in ${group.label}/`);
    });

    for (const fileName of fileNames) {
      it(`re-exports every runtime export of ${fileName}`, async () => {
        const module: Record<string, unknown> = await import(
          new URL(fileName, group.directory).href
        );
        const missing = missingRuntimeExports(module, barrel);
        assert.deepEqual(
          missing,
          [],
          runtimeDiagnostic(fileName, group.label, missing),
        );
      });
    }
  });
}

for (const group of GROUPS) {
  const fileNames = sourceModulesIn(group.directory);
  const barrelFile = new URL("index.ts", group.directory);

  describe(`${group.label} type barrel`, () => {
    for (const fileName of fileNames) {
      it(`re-exports every public type of ${fileName}`, () => {
        const missing = missingTypeExports(
          readFileSync(new URL(fileName, group.directory), "utf8"),
          readFileSync(barrelFile, "utf8"),
          `./${fileName}`,
        );
        assert.deepEqual(
          missing,
          [],
          typeDiagnostic(fileName, group.label, missing),
        );
      });
    }
  });
}

describe("package entry points", () => {
  it("publishes exactly the discovered barrels, and no root barrel", () => {
    // Deriving the expectation from the barrels found on disk stops the two
    // drifting in either direction: a new directory with an index.ts must be
    // published, and a published path must exist. Asserted separately, the
    // absence of a "." entry keeps the §8.10 seam structural — a root barrel
    // would give classification a convenient path into schedule and undo the
    // boundary the lint rules enforce.
    const packageJson = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { exports: Record<string, unknown> };

    assert.deepEqual(
      Object.keys(packageJson.exports).sort(),
      GROUPS.map((group) => `./${group.label}`),
    );
    assert.deepEqual(Object.keys(PUBLIC_BARRELS).sort(), GROUPS.map((group) => group.label));
    assert.equal(Object.hasOwn(packageJson.exports, "."), false, "no root entry point");
  });
});
