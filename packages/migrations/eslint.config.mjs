import parser from "@typescript-eslint/parser";
import { defineConfig, globalIgnores } from "eslint/config";

/**
 * CBD-116-AC06 as a lint rule.
 *
 * The architecture chose "managed PostgreSQL with a typed SQL layer", not an
 * ORM that owns the schema. The distinction is not a preference: an ORM that
 * generates the schema from a model makes the model the source of truth, and
 * then forward-only expand-and-contract (TD-103-028) is no longer expressible
 * -- the tool wants to diff the model against the database and emit whatever
 * closes the gap, including a drop.
 *
 * The migration check enforces the same rule against declared dependencies.
 * This enforces it against imports, which is the way the rule would actually
 * be broken: a transitive dependency pulled in by hand rather than declared.
 */
const SCHEMA_OWNER_PATTERNS = [
  "prisma",
  "prisma/*",
  "@prisma/*",
  "typeorm",
  "typeorm/*",
  "sequelize",
  "sequelize-typescript",
  "mikro-orm",
  "@mikro-orm/*",
  "objection",
  "waterline",
  "bookshelf",
];

const SCHEMA_OWNER_MESSAGE =
  "docs/architecture.md chose a typed SQL layer over an ORM that owns the " +
  "schema, and CBD-116-AC06 holds the migration tooling to that choice. The " +
  "schema is defined by the .sql files in packages/migrations/migrations and " +
  "by nothing else. A query layer that reads the schema is welcome; a model " +
  "that generates it is not.";

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
        { patterns: [{ group: SCHEMA_OWNER_PATTERNS, message: SCHEMA_OWNER_MESSAGE }] },
      ],
    },
  },
]);
