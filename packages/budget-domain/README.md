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

The public surface is exactly four specifiers — `/shared`, `/schedule`,
`/income`, `/targets`.

Do not import the package root, do not import a path below one of those four,
and do not reach the package by a relative path into `src/`. The first two fail
at resolution; the third is a policy violation that no tool currently catches.

A consumer must declare `"@cobudget/budget-domain": "*"` in its dependencies,
must not run with `--preserve-symlinks`, and must configure its bundler to read
workspace TypeScript if it does not already (for Next.js, `transpilePackages`).

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
