import parser from "@typescript-eslint/parser";
import { defineConfig, globalIgnores } from "eslint/config";

/**
 * CBD-232 §3.1: this package owns normalization, validation composition,
 * preview assembly, proposal state transitions, canonical serialization,
 * digests, binding verification, and the §9 ports. It contains no NestJS
 * decorator, database client, provider SDK, or direct clock/randomness access.
 */

const BOUNDARY_MESSAGE =
  "CBD-232 §3.1 keeps this package free of databases, queues, and provider " +
  "SDKs; persistence is CBD-246's seam behind the §9 ports and HTTP is a " +
  "thin adapter in apps/api. Put the dependency in the consumer that needs it.";

const CLOCK_MESSAGE =
  "CBD-232 §3.1 forbids direct clock/randomness access so the application " +
  "stays deterministic under test. Use the injected Clock/OpaqueIdGenerator " +
  "ports instead of Date.now(), new Date(), or Math.random().";

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
      "no-restricted-syntax": [
        "error",
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: CLOCK_MESSAGE,
        },
        {
          selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
          message: CLOCK_MESSAGE,
        },
        {
          selector: "CallExpression[callee.object.name='Math'][callee.property.name='random']",
          message: CLOCK_MESSAGE,
        },
      ],
    },
  },

  {
    // Tests construct fixed instants and deterministic fakes; that is fixture
    // setup, not the application reaching for a real clock or RNG.
    files: ["src/**/*.test.ts"],
    rules: {
      "no-restricted-syntax": "off",
    },
  },
]);
