import parser from "@typescript-eslint/parser";
import { defineConfig, globalIgnores } from "eslint/config";

const ENVIRONMENT_MESSAGE =
  "Read configuration through @cobudget/contracts so every value is validated " +
  "and every failure names its variable without exposing its value.";

const INFRASTRUCTURE_MESSAGE =
  "CBD-110 is an application skeleton only. Database, queue, provider, and " +
  "authentication dependencies arrive in their owning stories.";

/**
 * CBD246-SECURITY-002 finding 2: `no-restricted-imports` only sees a static
 * `import`; `await import("pg")` (or `createRequire(...)("pg")`) reached the
 * driver untouched. `no-restricted-syntax` below matches a dynamic
 * `import(...)` call whose argument is a string literal naming `pg` or a
 * `pg/...` subpath, closing that gap without loosening the static rule.
 * Mirrors `packages/data-access/eslint.config.mjs`'s identical guard.
 */
const DYNAMIC_IMPORT_SELECTOR =
  "ImportExpression[source.type='Literal'][source.value=/^pg(-.*)?(\\/.*)?$/]";

export default defineConfig([
  globalIgnores(["dist/**", "node_modules/**"]),
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser,
      ecmaVersion: 2023,
      sourceType: "module",
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "pg",
                "pg-*",
                "postgres",
                "mysql*",
                "sqlite*",
                "better-sqlite3",
                "typeorm",
                "prisma",
                "@prisma/*",
                "knex",
                "drizzle-orm",
                "ioredis",
                "redis",
                "bullmq",
                "bull",
                "amqplib",
                "kafkajs",
                "@aws-sdk/*",
                "aws-sdk",
                "@google-cloud/*",
                "@azure/*",
                "plaid",
              ],
              message: INFRASTRUCTURE_MESSAGE,
            },
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: 'MemberExpression[object.name="process"][property.name="env"]',
          message: ENVIRONMENT_MESSAGE,
        },
        {
          selector: 'MemberExpression[object.name="process"][property.value="env"]',
          message: ENVIRONMENT_MESSAGE,
        },
        {
          selector: DYNAMIC_IMPORT_SELECTOR,
          message: INFRASTRUCTURE_MESSAGE,
        },
      ],
    },
  },
]);
