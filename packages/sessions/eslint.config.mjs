import parser from "@typescript-eslint/parser";
import { defineConfig, globalIgnores } from "eslint/config";

/**
 * CBD-191: this package persists only through @cobudget/data-access; it
 * never imports the driver directly and never reads process.env (the
 * shared loader in @cobudget/contracts owns that -- see
 * scripts/check-environment.mjs, which additionally enforces the
 * process.env ban at the repository level).
 */
const BOUNDARY_MESSAGE =
  "packages/sessions persists only through @cobudget/data-access (CBD-191); a "
  + "direct driver or framework import here would duplicate role separation "
  + "and tenant/platform scoping this package must not reimplement.";

const INFRASTRUCTURE_PATTERNS = [
  "pg",
  "pg-*",
  "postgres",
  "@nestjs/*",
  "fastify",
  "express",
];

export default defineConfig([
  globalIgnores(["node_modules/**"]),

  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser,
      ecmaVersion: 2023,
      sourceType: "module",
    },
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [{ group: INFRASTRUCTURE_PATTERNS, message: BOUNDARY_MESSAGE }] },
      ],
    },
  },
]);
