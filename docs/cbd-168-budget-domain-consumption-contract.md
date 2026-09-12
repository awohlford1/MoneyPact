# CBD-168 — Budget-domain consumption contract

| Field | Value |
| --- | --- |
| Status | **Proposed — awaiting reviewer approval linked to CBD-96** |
| Document version | 1.0 |
| Decision | `DC-168-001` through `DC-168-012` |
| Owner | Alexander Wohlford |
| Jira subtask | [CBD-168](https://cobudget.atlassian.net/browse/CBD-168) |
| Parent | [CBD-96](https://cobudget.atlassian.net/browse/CBD-96) |
| Subject package | `packages/budget-domain` (`@cobudget/budget-domain`) |
| Repository baseline | `ba1c1d3` |
| Last updated | September 12, 2026 |

## 1. Purpose and authority

`packages/budget-domain` holds 9,017 lines of pure budget logic across 37 files
in four modules — `shared/`, `schedule/`, `income/`, `targets/` — with no I/O,
no framework, and no persistence. It has no consumer. No application manifest
in `apps/web`, `apps/api`, or `apps/worker` names `@cobudget/budget-domain`.

That absence is why this record exists. The package already behaves as though a
consumption contract had been decided: it publishes four subpath exports that
point at TypeScript source, it has no build script, and it deliberately has no
root `src/index.ts`. Nothing states that this is the intended contract, what it
depends on to keep working, or what a consumer is forbidden to do. An unstated
contract is not a contract; it is a set of accidents that the first real
consumer will discover one at a time.

This record selects the contract, states the assumptions it rests on, and gives
the reversal path. It is a decision record, not an implementation. Wiring the
first consumer, adding the export guards, and verifying cross-workspace
packaging are separate items and are not attempted here.

Decisions marked **Binding** govern design, implementation, and review for this
package. A change to one is a change to this record, not an implementation
detail.

## 2. Decision

**`DC-168-001` (Binding). The supported consumption contract is TypeScript
source, resolved through the package `exports` map, inside this npm workspace
only.** Consumers import the package's published subpath specifiers. Resolution
lands on `.ts` source files. Nothing is compiled ahead of time, no `dist`
directory exists, and no declaration files are emitted or shipped.

**`DC-168-002` (Binding). The contract is workspace-internal and the package
stays `private: true`.** Source consumption stops working the moment the package
is installed as real files under `node_modules` rather than linked from
`packages/`. This is a hard runtime boundary, not a preference; §7 gives the
evidence and §8 gives the migration that publication would require.

The alternative — compiling to `dist/` with emitted declarations — is rejected.
§4 compares them across the seven dimensions CBD-168 requires and §5 records why
the alternative lost.

## 3. What the decision rests on

These are the conditions that make `DC-168-001` work. Each is a real dependency,
not background colour. If one stops holding, the decision is invalidated and §8
applies.

**`DC-168-003` (Binding). Node 24, ESM, native type stripping.** The root
manifest pins `"node": ">=24 <25"`. Node 24 strips TypeScript types from `.ts`
files natively, with no loader and no flag. The package declares
`"type": "module"` and is ESM only. There is no CommonJS entry and none will be
added.

**`DC-168-004` (Binding). Relative imports inside the package carry explicit
`.ts` extensions.** The source does this already: 137 relative specifiers, every
one of them extensioned, for example `from "./period.ts"`. Node's ESM resolver
does not guess extensions, so this is what makes the source runnable unbuilt. It
is also, as §8 notes, the single largest obstacle to compiling the package.

**`DC-168-005` (Binding). `erasableSyntaxOnly` stays enabled for this package.**
`tsconfig.base.json` sets `"erasableSyntaxOnly": true`, which rejects any
TypeScript construct that survives erasure — enums, parameter properties,
namespaces with runtime meaning. That option is what keeps the source strippable
by Node, so for this package it is load-bearing rather than stylistic.
`apps/api` sets `"erasableSyntaxOnly": false` because NestJS needs decorator
metadata. That exemption is specific to the application composition root and
must not propagate into the domain package.

**`DC-168-006` (Binding). Workspace resolution must dereference the link.**
npm links a workspace package into `node_modules` as a symlink or a Windows
junction. Node resolves that to its real path — `packages/budget-domain/src/...`
— which is outside `node_modules`, and only therefore is it willing to strip
types. Running with `--preserve-symlinks` keeps the resolved path inside
`node_modules` and the process fails at import time. `--preserve-symlinks` is
prohibited for any process that reaches this package. §7 records the observed
failure.

## 4. Comparison across the required dimensions

| Dimension | Source through `exports` (chosen) | Compiled `dist` with declarations (rejected) |
| --- | --- | --- |
| Development | Edit and run. No build step, no watch process, no ordering between packages. What the consumer executes is the file the author edited. | Requires a watch build or project references. Introduces a stale-artifact failure: the consumer runs yesterday's logic and every test agrees with it. |
| CI | Nothing to build. `typecheck`, `test`, and `lint` run directly against source. Consumer typecheck reads the same files. | Needs a `build` script that must run before any consumer's `typecheck`, `test`, or `build`. Root `build` is `npm run build --workspaces --if-present`, and npm offers no dependency-ordered workspace execution, so the ordering guarantee has to be built. |
| Production build | `apps/api` and `apps/worker` bundle with `esbuild --packages=external`, which leaves workspace specifiers as imports in the output. `apps/worker` then starts as plain `node dist/main.js` and Node strips the external package's types at load. This path is already in service for `@cobudget/contracts`. | The bundle would resolve against emitted JavaScript instead. Marginally simpler at runtime, at the cost of the build ordering above and an artifact to keep in step. |
| Debugging | Stack frames name the real `.ts` file at the real line. Node's stripping erases annotations in place rather than re-emitting, so positions are preserved exactly and no source map is involved. Go-to-definition lands on the implementation. | Needs `sourceMap` and `declarationMap` to get back to source, and both have to be correct, shipped, and loaded. Without `declarationMap`, go-to-definition stops at a `.d.ts` wall. |
| Caching | No artifact exists, so no artifact can be stale and no cache key can be wrong. The failure mode is absent rather than mitigated. | A compiled package is cacheable across CI runs. Real, but the saving is small against 9,017 lines with no dependencies, and it is bought with a correctness risk. |
| Publication | Blocks publication. Node refuses to strip types under `node_modules`, so a packed or published install of this package fails at import. The package must stay private. | This is the alternative's one decisive advantage. A published package must ship JavaScript and declarations. |
| Rollback and migration | Reversible additively and without touching consumers: the four subpath keys stay identical and gain conditional targets. §8. | Reverting from `dist` back to source is equally mechanical but arrives with 137 rewritten import specifiers to undo. |

## 5. Alternatives and why they lost

**Compiled `dist` with emitted declarations — rejected.** It wins exactly one
dimension, publication, and CBD-168 does not require publication. It loses
development and CI outright by introducing a build-ordering problem the
toolchain has no answer for, and it introduces a stale-artifact failure mode
that is silent by construction: a consumer running against an old `dist` sees
green tests. Against that, the caching benefit at this size is not material.
Critically, choosing source now does not forfeit this option — §8 shows the
migration is additive and invisible to consumers, so the cost of deferring is
close to zero while the cost of building the machinery now is immediate.

**Publishing a root barrel (`"."`) alongside the subpaths — rejected.** A root
entry would re-export all four modules from one specifier. It creates a second
public surface that `barrel.test.ts` does not cover, so a symbol could be
reachable at the root and missing from its module barrel, or the reverse, with
nothing to notice. It also erases the module boundary the subpaths exist to
express. The absence of `src/index.ts` is deliberate and stays deliberate.

**A `./*` wildcard export for deep access — rejected.** It would make every
internal file public by default and turn the private-import policy in §6 from a
mechanically enforced rule into a request. The current map has no wildcard and
should not acquire one.

**`tsx` or another loader as the supported runtime for consumers — rejected as
the contract, retained as a convenience.** `apps/api` and `apps/worker` already
use `--import=tsx` in development, and that continues to work. But making a
loader part of the contract would mean the contract could not be satisfied by
plain Node, which is precisely what `apps/worker` does in production today.
Plain Node is the floor; a loader on top of it is allowed and unremarkable.

## 6. The supported contract

**`DC-168-007` (Binding). The public surface is exactly four specifiers.**

| Specifier | Resolves to |
| --- | --- |
| `@cobudget/budget-domain/shared` | `src/shared/index.ts` |
| `@cobudget/budget-domain/schedule` | `src/schedule/index.ts` |
| `@cobudget/budget-domain/income` | `src/income/index.ts` |
| `@cobudget/budget-domain/targets` | `src/targets/index.ts` |

Anything reachable from one of those four barrels is public. Anything else is
internal and may be renamed, moved, or deleted without notice.

**`DC-168-008` (Binding). Private-import policy.** A consumer must not import
the package root, must not import a path below a published subpath, and must not
reach the package by a relative path. The first two are enforced by Node itself:
with an `exports` map present and no wildcard key, both
`@cobudget/budget-domain` and `@cobudget/budget-domain/src/schedule/period.ts`
fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`, and TypeScript's `nodenext` and
`bundler` resolution modes both honour the same map. §7 records the observation.

The third is not enforced by anything. A file in `apps/web` can write
`../../../packages/budget-domain/src/schedule/period.ts` and every tool in the
repository will accept it: it bypasses the export map, the module boundary, and
the barrel guard in one line, and it does not even require the package to be
declared as a dependency. This is the one part of the policy that is currently
words only. §9 raises it.

**`DC-168-009` (Binding). Consumer obligations.** A consumer declares
`"@cobudget/budget-domain": "*"` in its `dependencies`. A consumer whose
toolchain does not resolve raw TypeScript out of `node_modules` by default must
configure it to — for Next.js that is `transpilePackages`. A consumer must not
run with `--preserve-symlinks`.

**`DC-168-010`. Type checking is per-consumer and the package keeps its own.**
Because consumers read source, the domain's files enter each consumer's
TypeScript program and are checked under that consumer's compiler options, not
the package's. `apps/web` does not extend `tsconfig.base.json` and therefore
does not set `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, or
`verbatimModuleSyntax`. Those settings are strictly looser, so source that
passes the package's own check will pass a consumer's — the divergence is safe
in that direction only. The package's `typecheck` script remains the sole place
the strict options are enforced and must keep running in CI independently of
any consumer.

## 7. Verification evidence

Four behaviours this record depends on were observed directly rather than
assumed, on Node v24.15.0, using a minimal package that reproduces the
arrangement: `"type": "module"`, a subpath export pointing at a `.ts` file, an
extensioned relative import, and a junction into a consumer's `node_modules`.

| ID | Behaviour tested | Result |
| --- | --- | --- |
| `EV-168-01` | Import a `.ts` subpath export through a linked workspace package, plain `node`, no loader | Resolved and executed |
| `EV-168-02` | The same import under `--preserve-symlinks` | Failed, `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` |
| `EV-168-03` | The same import with the package present as real files under `node_modules` rather than linked | Failed, `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` |
| `EV-168-04` | Import the package root, and a path below a published subpath | Both failed, `ERR_PACKAGE_PATH_NOT_EXPORTED` |

`EV-168-03` is the one that fixes the publication boundary in `DC-168-002`. It
is also the reason the deployment question in §9 is a real risk rather than a
theoretical one: any packaging step that materialises the workspace package as
files inside `node_modules`, instead of preserving the link and the
`packages/` tree, reproduces `EV-168-03` in production.

Not verified here, and assigned rather than assumed: whether `next build`
resolves and compiles these subpaths without additional configuration
(`DC-168-009`), and whether npm's workspace script execution would have ordered
a build correctly (§4, CI row). Neither is a dependency of this decision — the
first is a consumer obligation to prove when a consumer exists, the second only
matters if the rejected alternative is ever revisited.

## 8. Reversal and migration

**`DC-168-011`. The trigger conditions are known in advance.** This decision
should be revisited if the package must be published or consumed outside this
workspace; if a consumer's toolchain cannot be made to read workspace
TypeScript; if deployment packaging cannot preserve the workspace link and the
`packages/` tree; or if the Node floor moves below native type stripping.

**`DC-168-012` (Binding). Reversal is additive and must not change any consumer
import.** The four subpath keys in §6 are the contract. A migration that
preserves them is invisible; one that changes them is a breaking change to every
consumer and is not the migration described here.

The path, in order:

1. Add a build tsconfig that emits. This cannot be done by editing
   `tsconfig.base.json`, and it is the step people underestimate.
   `allowImportingTsExtensions` is enabled repository-wide, and TypeScript
   permits it alongside emit only when `rewriteRelativeImportExtensions` is also
   enabled. So emitting means either turning that rewrite on, or turning
   `allowImportingTsExtensions` off and rewriting all 137 relative specifiers
   from `.ts` to `.js`. Both are deliberate compiler-option decisions; neither is
   a flag flip, and `tsconfig.base.json` is shared with every other package.
2. Add `declaration`, `declarationMap`, `sourceMap`, and an `outDir` in that
   build config only, so `noEmit` stays true for the checking path.
3. Add a `build` script to the package manifest. Its mere presence changes CI
   behaviour, because root `build` is `--workspaces --if-present`; confirm the
   ordering problem in §4 is solved before relying on it.
4. Convert each `exports` entry to conditional form, keeping the same key:
   `"types"` pointing at the emitted `.d.ts` and `"default"` at the emitted
   `.js`. Consumers change nothing.
5. Retain `"development"` or `"source"` conditions pointing back at `src/*.ts`
   if the development ergonomics in §4 are worth keeping. This makes the two
   options coexist rather than trade off, and it is also the rollback: dropping
   the emitted conditions restores `DC-168-001` exactly.
6. Only then remove `private: true`, if publication was the trigger.

Rolling forward and rolling back therefore touch the same file and never touch a
consumer. That property is the main reason `DC-168-001` is safe to choose now.

## 9. Known gaps and follow-ups

| ID | Gap | Disposition |
| --- | --- | --- |
| `FU-168-01` | Nothing prevents a consumer from reaching into `packages/budget-domain/src/...` by relative path, bypassing the export map entirely. `DC-168-008` is words only for this case. | Needs a lint rule with no owning ticket. Raised to Manager; candidate follow-up. |
| `FU-168-02` | Type-only exports are outside the barrel guard's reach; a forgotten `export type` still slips through. Stated in `barrel.test.ts` itself. | Already owned under CBD-96. |
| `FU-168-03` | No deployment packaging exists yet — no Dockerfile, no image definition. Whatever is built must preserve the workspace link and the `packages/` tree, or it reproduces `EV-168-03` in production. | Belongs with cross-workspace packaging verification. |
| `FU-168-04` | `docs/architecture.md` §Open architecture decisions does not record this contract, and its Domain modules section does not mention the package. Out of scope for this change and not edited here. | Raised to Manager for routing to the owner of that document. |
| `FU-168-05` | `@cobudget/contracts` follows the same unstated arrangement — source subpath exports, no build, consumed by two applications in production. This record does not govern it. | Raised to Manager; candidate follow-up to bring it under the same contract. |

## 10. Acceptance criteria traceability

| Criterion | Requirement | Where satisfied |
| --- | --- | --- |
| `CBD-168-AC01` | Decision compares development, CI, production build, debugging, caching, publication, and rollback or migration | §4, one row per dimension, both options; §5 records why the alternative lost on the balance |
| `CBD-168-AC02` | One supported contract, Node and TypeScript assumptions, and private-import policy are explicit | §2 `DC-168-001`; §3 `DC-168-003` through `DC-168-006`; §6 `DC-168-007` through `DC-168-010`, with the enforcement boundary stated and the unenforced case named |
| `CBD-168-AC03` | Export map, tsconfig, and package scripts are consistent with the decision | §11 |
| `CBD-168-AC04` | The record identifies how to reverse or migrate the choice without breaking consumers | §8, with `DC-168-012` fixing the four subpath keys as the invariant that keeps consumers untouched |

## 11. Consistency of the export map, tsconfig, and package scripts

`CBD-168-AC03` asks whether the configuration agrees with the decision. It does,
in all three places, and no change is made to `packages/budget-domain/package.json`
or `packages/budget-domain/tsconfig.json` by this record.

**Export map — consistent.** The four entries in `exports` point at
`./src/<module>/index.ts`. There is no `"."` key, no `./*` wildcard, and no
conditional form. That is `DC-168-001`, `DC-168-007`, and `DC-168-008` expressed
in the manifest, and §5 records why the two absent keys stay absent.

**tsconfig — consistent, and structurally so.** The package tsconfig extends
`tsconfig.base.json` and adds only `include`. It inherits `"noEmit": true`,
`"module": "nodenext"`, `"allowImportingTsExtensions": true`, and
`"erasableSyntaxOnly": true`. This configuration cannot produce a `dist`: as §8
step 1 sets out, emitting requires a separate build config and a deliberate
change to how `.ts` import extensions are handled. The repository is not merely
choosing source consumption, it is currently configured so that the alternative
is unreachable without an explicit decision. That is the right shape for a
decision of this kind.

**Package scripts — consistent, and the absence is the point.** The package
declares `lint`, `test`, and `typecheck`, and no `build`. Root `build` is
`npm run build --workspaces --if-present`, so a package with no `build` script is
skipped rather than failing. The missing script is the mechanical statement that
this package produces no artifact; adding one would contradict `DC-168-001`
before any other file changed.

## 12. Revision history

| Version | Date | Change |
| --- | --- | --- |
| 1.0 | September 12, 2026 | Initial record. Selects source consumption through the export map, states the Node and TypeScript assumptions and the private-import policy, records the four observed behaviours in §7, and gives the additive reversal path. |
