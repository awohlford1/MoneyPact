import parser from "@typescript-eslint/parser";
import { defineConfig, globalIgnores } from "eslint/config";

/**
 * Lint rules that enforce the claims this package makes about itself.
 *
 * Each rule below turns a comment into a failing build. A convention nobody
 * checks is not a constraint.
 *
 * Note on composition: `no-restricted-syntax` replaces rather than merges when
 * a later config block targets the same rule, so the block that lifts the
 * `process.env` ban for the loader restates nothing and simply turns it off.
 */

const BOUNDARY_MESSAGE =
  "CBD-109 keeps the contract package free of databases, queues, and provider " +
  "SDKs so that both applications can depend on it without either inheriting " +
  "the other's infrastructure. Persistence arrives with CBD-19, hosting " +
  "clients with CBD-103, and identity with CBD-104. Put the dependency in the " +
  "application that needs it.";

const ENVIRONMENT_MESSAGE =
  "Configuration is read through loadConfig, which validates it against a " +
  "declared schema and fails naming any variable that is absent or malformed. " +
  "Reading process.env directly bypasses that, and CBD-110 requires that the " +
  "applications never do so. The single permitted read is " +
  "loadConfigFromEnvironment in src/config/load.ts.";

const INFRASTRUCTURE_PATTERNS = [
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
  "@nestjs/*",
  "fastify",
  "express",
  "next",
];

/** Banned everywhere except the loader: `process.env` and `process["env"]`. */
const ENVIRONMENT_SELECTORS = [
  {
    selector: 'MemberExpression[object.name="process"][property.name="env"]',
    message: ENVIRONMENT_MESSAGE,
  },
  {
    selector: 'MemberExpression[object.name="process"][property.value="env"]',
    message: ENVIRONMENT_MESSAGE,
  },
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
      "no-restricted-syntax": ["error", ...ENVIRONMENT_SELECTORS],
    },
  },

  {
    // The one place the environment is read, so the one place the ban is lifted.
    files: ["src/config/load.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
]);
