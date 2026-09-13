import parser from "@typescript-eslint/parser";
import { defineConfig, globalIgnores } from "eslint/config";

/**
 * CBD-246-AC01: every application query passes through this layer, and a
 * direct driver import outside it fails lint.
 *
 * `driver.ts` is the one file allowed to import `pg`: it is the seam that
 * turns the raw driver into the role-separated connections `connection.ts`
 * hands out. Every other file in this package -- and, by the identical rule
 * already carried in `apps/api/eslint.config.mjs` and
 * `apps/worker/eslint.config.mjs`, every file in either application -- is
 * refused a direct `pg` import. `src/lint.test.ts` proves this rule fires
 * against a fixture that never touches disk.
 *
 * CBD246-REVIEW-001 medium finding: `no-restricted-imports` only sees a
 * static `import`; `await import("pg")` reached the driver untouched.
 * `no-restricted-syntax` below matches a dynamic `import(...)` call whose
 * argument is a string literal naming `pg` or a `pg/...` subpath, closing
 * that gap without loosening the static rule.
 */
const BOUNDARY_MESSAGE =
  "CBD-246-AC01: pg is imported only by packages/data-access/src/driver.ts. " +
  "Every query goes through @cobudget/data-access so tenant scoping, role " +
  "separation, and field encryption are enforced once, not reimplemented " +
  "per caller.";

const DRIVER_PATTERNS = ["pg", "pg-*", "pg/*"];
const DYNAMIC_IMPORT_SELECTOR =
  "ImportExpression[source.type='Literal'][source.value=/^pg(-.*)?(\\/.*)?$/]";

export default defineConfig([
  globalIgnores(["node_modules/**"]),

  {
    files: ["src/**/*.ts", "scripts/**/*.ts"],
    languageOptions: {
      parser,
      ecmaVersion: 2023,
      sourceType: "module",
    },
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: DRIVER_PATTERNS, message: BOUNDARY_MESSAGE }] },
      ],
      "no-restricted-syntax": [
        "error",
        { selector: DYNAMIC_IMPORT_SELECTOR, message: BOUNDARY_MESSAGE },
      ],
    },
  },

  {
    // The one seam allowed to import the driver directly.
    files: ["src/driver.ts"],
    rules: {
      "no-restricted-imports": "off",
      "no-restricted-syntax": "off",
    },
  },
]);
