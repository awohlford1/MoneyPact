# @cobudget/budget-domain

Pure domain logic for budget schedules, periods, income, and targets. No I/O, no
framework, no persistence.

## How to consume it

This package is consumed as **TypeScript source**, resolved through its
`exports` map, **inside this npm workspace only**. Nothing is compiled ahead of
time and there is no `dist`.

```ts
import { /* ... */ } from "@cobudget/budget-domain/schedule";
```

The public surface is one subpath per module directory — currently `/shared`,
`/schedule`, `/income`, `/targets`. There is no root entry and no wildcard, and
`barrel.test.ts` enforces that correspondence rather than the count.

Do not import the package root, do not import a path below a published subpath,
and do not reach the package by a relative path into `src/`. The first two fail
at resolution; the third is a policy violation that no tool currently catches.

A consumer must:

1. Declare `"@cobudget/budget-domain": "*"` in its dependencies.
2. **Enable `allowImportingTsExtensions` in its own tsconfig, or extend
   `tsconfig.base.json`.** Every relative import in this package ends in `.ts`.
   A consumer without this option gets TS5097 on all 137 of them, and
   `next build` type-checks by default, so the build fails. `apps/web` does not
   extend the base tsconfig and needs this explicitly.
3. Configure its bundler to compile workspace TypeScript — for Next.js,
   `transpilePackages`. This does **not** substitute for step 2: one governs
   what the bundler compiles, the other what the compiler accepts.
4. Not run with `--preserve-symlinks`.

## Why, and how to change it

`docs/cbd-168-budget-domain-consumption-contract.md` is authoritative. It records
the decision, the Node and TypeScript assumptions it depends on, what was
compared against compiling to `dist`, and the migration path to reverse it
without changing any consumer import.

This file is a pointer, not a second copy. If the two disagree, the decision
record wins and this file is wrong.

## Scripts

`npm run typecheck`, `npm run test`, `npm run lint`. There is deliberately no
`build` script — see the decision record, §11.
