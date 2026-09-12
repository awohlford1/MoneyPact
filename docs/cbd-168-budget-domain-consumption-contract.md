# CBD-168 — Budget-domain consumption contract

| Field | Value |
| --- | --- |
| Status | **Proposed — awaiting reviewer approval linked to CBD-96** |
| Document version | 1.1.1 |
| Decision | `DC-168-001` through `DC-168-012`, plus `DC-168-011a` |
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
must not propagate into the domain package, and today that is enforced rather
than merely instructed. The package's own `tsc --noEmit` runs in CI through the
root `typecheck` script, `npm run typecheck --workspaces --if-present`, so a
non-erasable construct in this package fails the build under the package's
inherited setting no matter what a consumer's tsconfig says.

The enforcement has two removal paths, and they are not equally visible. The
loud one is changing the package's own tsconfig, which is a deliberate edit to
a file this record governs. The quiet one is deleting the `typecheck` script
from `packages/budget-domain/package.json`: `--if-present` skips a workspace
that has no such script instead of failing, so the fence would disappear with
nothing red. Neither path is guarded. Treat the package's `typecheck` script as
part of the contract surface, not as boilerplate.

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
| Rollback and migration | Reversible additively and without touching consumers: the published subpath keys stay identical and gain conditional targets. §8. | Reverting from `dist` back to source is equally mechanical but arrives with 137 rewritten import specifiers to undo. |

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

**Publishing a root barrel (`"."`) alongside the subpaths — rejected, and
already mechanically refused.** A root entry would re-export every module from
one specifier, erasing the module boundary the subpaths exist to express. It is
not merely against policy: `barrel.test.ts` asserts outright that `exports` has
no `"."` key, so adding one fails the package's own test suite. The absence of
`src/index.ts` is deliberate and is guarded.

**A `./*` wildcard export for deep access — rejected, and likewise refused.** It
would make every internal file public by default and reduce the private-import
policy in §6 to a request. The same assertion catches it: `barrel.test.ts`
compares the sorted `exports` keys against the module directories discovered on
disk, and a `./*` key matches no directory.

**`tsx` or another loader as the supported runtime for consumers — rejected as
the contract, retained as a convenience.** `apps/api` and `apps/worker` already
use `--import=tsx` in development, and that continues to work. But making a
loader part of the contract would mean the contract could not be satisfied by
plain Node, which is precisely what `apps/worker` does in production today.
Plain Node is the floor; a loader on top of it is allowed and unremarkable.

## 6. The supported contract

**`DC-168-007` (Binding). The public surface is exactly the published module
barrels — one subpath per module directory under `src/` that publishes a
barrel, no root key, no wildcard.** Today that is four, and the four are:

| Specifier | Resolves to |
| --- | --- |
| `@cobudget/budget-domain/shared` | `src/shared/index.ts` |
| `@cobudget/budget-domain/schedule` | `src/schedule/index.ts` |
| `@cobudget/budget-domain/income` | `src/income/index.ts` |
| `@cobudget/budget-domain/targets` | `src/targets/index.ts` |

The invariant is the one-to-one correspondence, not the number. `barrel.test.ts`
enforces exactly that: it discovers the barrel directories from the filesystem
and asserts that the sorted `exports` keys equal the discovered set, so adding a
fifth module directory with an `index.ts` obliges a fifth export key and adding
an export key with no module behind it fails the same assertion. Stating this
decision as "four" rather than as the correspondence would put a future fifth
module in the position of violating a Binding decision by satisfying the guard.

Anything reachable from a published barrel is public. Anything else is internal
and may be renamed, moved, or deleted without notice.

**`DC-168-008` (Binding). Private-import policy.** A consumer must not import
the package root, must not import a path below a published subpath, and must not
reach the package by a relative path. The first two are enforced by Node itself:
with an `exports` map present and no wildcard key, both
`@cobudget/budget-domain` and `@cobudget/budget-domain/src/schedule/period.ts`
fail with `ERR_PACKAGE_PATH_NOT_EXPORTED`. §7 `EV-168-04` records the
observation, and records that it is a Node runtime observation only —
TypeScript's own enforcement under `nodenext` and `bundler` resolution was not
probed and is listed there as assigned rather than verified.

The third is not enforced by anything. A file in `apps/web` can write
`../../../packages/budget-domain/src/schedule/period.ts` and every tool in the
repository will accept it: it bypasses the export map, the module boundary, and
the barrel guard in one line, and it does not even require the package to be
declared as a dependency. This is the one part of the policy that is currently
words only. §9 raises it.

**`DC-168-009` (Binding). Consumer obligations.** A consumer must do all four of
these:

1. Declare `"@cobudget/budget-domain": "*"` in its `dependencies`.
2. Enable `allowImportingTsExtensions` in its own `tsconfig.json`, or extend
   `tsconfig.base.json`, which sets it. This is not optional and not a
   strictness preference — see `DC-168-010`.
3. Configure its bundler to compile workspace TypeScript if it does not already.
   For Next.js that is `transpilePackages`. This is a separate obligation from
   the one above and neither substitutes for the other.
4. Not run with `--preserve-symlinks`.

**`DC-168-010`. Type checking is per-consumer, and only one kind of divergence
is safe.** Because consumers read source, the domain's 37 files enter each
consumer's TypeScript program and are checked under that consumer's compiler
options rather than the package's. Divergence between the two is therefore
normal, but it splits into two kinds and only the first is harmless.

*Strictness divergence is safe in one direction.* `apps/web` does not extend
`tsconfig.base.json` and so does not set `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, or `verbatimModuleSyntax`. Each of those is
strictly looser, so source that passes the package's own check passes the
consumer's. Looser is safe; stricter would not be, and no consumer currently is.

*Resolution and compatibility divergence has no safe direction, and must be
enumerated rather than assumed away.* One instance exists today and it is
disqualifying rather than cosmetic. `apps/web/tsconfig.json` has no `extends`
key at all, so it does not inherit `allowImportingTsExtensions`. Every one of
the package's 137 relative specifiers ends in `.ts`, and each one entering
`apps/web`'s program without that option raises TS5097 — *an import path can
only end with a '.ts' extension when 'allowImportingTsExtensions' is enabled.*
`next build` type-checks by default, so the build fails, roughly 137 times over.
`transpilePackages` does not help: it governs what the bundler compiles, not
what the compiler accepts. The fix is obligation 2 in `DC-168-009`, which is why
that obligation is stated separately from the bundler one.

The general rule the instance illustrates: a consumer may relax a strictness
option, and must match every option that governs how modules resolve or which
syntax is accepted. `allowImportingTsExtensions` is the one that bites today
because the package's import style depends on it; a future consumer on a
different `module` or `moduleResolution` setting needs the same scrutiny before
it is declared compliant.

The package's `typecheck` script remains the sole place the strict options are
enforced and must keep running in CI independently of any consumer.

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

All four probes are Node runtime observations. No TypeScript compiler was run,
because this working tree has no installed `typescript` and obtaining one was
out of scope for this change. The following are therefore **assigned rather
than verified**, and no claim elsewhere in this record should be read as
resting on evidence for them:

| ID | Claim | Assigned to |
| --- | --- | --- |
| `AS-168-01` | TypeScript's `nodenext` and `bundler` resolution modes honour the `exports` map and reject the root and deep specifiers as Node does. Probably true, and `DC-168-008` is written not to depend on it. | Runtime export guard work |
| `AS-168-02` | `apps/web` with obligations 2 and 3 of `DC-168-009` satisfied type-checks and builds against these subpaths. The failure predicted without obligation 2 is derived from the compiler's documented behaviour, not observed. | First consumer integration |
| `AS-168-03` | npm's workspace script execution would not have ordered a package build before its consumers. Only matters if the rejected alternative is revisited. | Only on reversal, §8 step 3 |

`AS-168-02` is the one to prove first, because it is the assumption a consumer
acts on rather than one this record acts on.

## 8. Reversal and migration

**`DC-168-011`. The trigger conditions are known in advance.** This decision
should be revisited if the package must be published or consumed outside this
workspace; if a consumer's toolchain cannot be made to read workspace
TypeScript; if deployment packaging cannot preserve the workspace link and the
`packages/` tree; or if the Node floor moves below native type stripping.

**`DC-168-011a`. The evidence expires with the toolchain that produced it.** §7
was observed on Node v24.15.0. `.nvmrc` pins `24` and CI resolves its Node from
`.nvmrc`, so the patch and minor version in §7 will drift from what actually
runs without anything failing. A Node or TypeScript major version change obliges
re-running the four probes and re-reading this record before the bump merges.
Type stripping is a young feature and `EV-168-02` and `EV-168-03` depend on an
implementation restriction — the `node_modules` refusal — that could be relaxed
in either direction by a future release. Treat a green CI on a new major as
evidence that nothing in CI exercised these paths, not as confirmation.

**`DC-168-012` (Binding). Reversal is additive and must not change any consumer
import.** The published subpath keys defined by `DC-168-007` are the contract,
whatever their number at the time of migration. A migration that
preserves them is invisible; one that changes them is a breaking change to every
consumer and is not the migration described here.

The path, in order:

1. Add a build tsconfig that emits. This cannot be done by editing
   `tsconfig.base.json`, and it is the step people underestimate.
   `allowImportingTsExtensions` is set in exactly one tracked file,
   `tsconfig.base.json`, and reaches this package by inheritance — every
   workspace tsconfig extends that base except `apps/web`, which has no
   `extends` key and is the subject of `DC-168-010`. TypeScript permits the
   option alongside emit only when `rewriteRelativeImportExtensions` is also
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
| `FU-168-01` | Nothing prevents a consumer from reaching into `packages/budget-domain/src/...` by relative path, bypassing the export map entirely. `DC-168-008` is words only for this case. | Ticketed by Manager, gated on the first consumer integration. The mechanism is already precedented inside this package: `packages/budget-domain/eslint.config.mjs` uses `no-restricted-imports` patterns to hold the internal module seams, under a header reading "A convention nobody checks is not a constraint." The same rule shape applied at the workspace root closes this. Harmless while no consumer exists. |
| `FU-168-02` | Type-only exports are outside the barrel guard's reach; a forgotten `export type` still slips through. Stated in `barrel.test.ts` itself. | Already owned under CBD-96. |
| `FU-168-03` | No deployment packaging exists yet — no Dockerfile, no image definition. Whatever is built must preserve the workspace link and the `packages/` tree, or it reproduces `EV-168-03` in production. | Belongs with cross-workspace packaging verification. |
| `FU-168-04` | `docs/architecture.md` §Open architecture decisions does not record this contract, and its Domain modules section does not mention the package. Out of scope for this change and not edited here. | Raised to Manager for routing to the owner of that document. |
| `FU-168-05` | `@cobudget/contracts` follows the same unstated arrangement — source subpath exports, no build, consumed by two applications in production. This record does not govern it. | Raised to Manager; candidate follow-up to bring it under the same contract. |

## 10. Acceptance criteria traceability

| Criterion | Requirement | Where satisfied |
| --- | --- | --- |
| `CBD-168-AC01` | Decision compares development, CI, production build, debugging, caching, publication, and rollback or migration | §4, one row per dimension, both options; §5 records why the alternative lost on the balance |
| `CBD-168-AC02` | One supported contract, Node and TypeScript assumptions, and private-import policy are explicit | §2 `DC-168-001`; §3 `DC-168-003` through `DC-168-006`; §6 `DC-168-007` through `DC-168-010`. The TypeScript assumptions are stated as consumer obligations in `DC-168-009` and as the divergence taxonomy in `DC-168-010`, which separates strictness divergence a consumer may keep from resolution and compatibility divergence it must not. The private-import policy names what Node enforces, what `barrel.test.ts` enforces, and the one case nothing enforces |
| `CBD-168-AC03` | Export map, tsconfig, and package scripts are consistent with the decision | §11 |
| `CBD-168-AC04` | The record identifies how to reverse or migrate the choice without breaking consumers | §8, with `DC-168-012` fixing the published subpath keys as the invariant that keeps consumers untouched |

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
| 1.1.1 | September 12, 2026 | Re-review. Corrected a false statement introduced by the v1.1 `DC-168-005` fence: the root script is `npm run typecheck --workspaces --if-present`, and the omitted flag is the load-bearing one. Because of it, changing the package's tsconfig is not the only way to lose the fence — deleting the package's own `typecheck` script loses it too, and silently, since `--if-present` skips a workspace that lacks the script rather than failing. Both paths are now named and the package's `typecheck` script is declared part of the contract surface. Tightened `DC-168-007` to "module directory that publishes a barrel", matching what `barrel.test.ts` filters on, and swept three residual "the four subpath keys" phrasings the v1.1 fix left in §4, `DC-168-012`, and the `CBD-168-AC04` row. |
| 1.1 | September 12, 2026 | Independent review, four blockers, decision unchanged. Corrected §8 step 1, which claimed `allowImportingTsExtensions` was enabled repository-wide when it is set in one file and reaches packages by inheritance that `apps/web` does not have. Rewrote `DC-168-010` to separate strictness divergence from resolution and compatibility divergence, and added the instance that made the distinction necessary: `apps/web` lacking `allowImportingTsExtensions` fails on all 137 specifiers with TS5097, which `transpilePackages` does not fix. Promoted that fix to a numbered obligation in `DC-168-009`. Moved the untested TypeScript-resolution claim out of `DC-168-008` into a new assigned-assumption table in §7. Restated `DC-168-007` as the barrel correspondence `barrel.test.ts` actually enforces rather than the number four. Strengthened the §5 rejections and the `DC-168-005` fence to cite the guards that already enforce them, and added `DC-168-011a` on evidence expiry. |
