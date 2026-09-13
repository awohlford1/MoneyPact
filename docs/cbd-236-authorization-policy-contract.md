# CBD-236 — Centralized versioned authorization policy contract

| Field | Value |
| --- | --- |
| Status | **Approved — Product Owner, September 13, 2026 (PO-CONTRACT-APPROVALS-001); open questions and residuals stay recorded and open** |
| Document version | 0.4 |
| Decision | `PC-236-001` through `PC-236-020`; questions `OQ-236-001` through `OQ-236-010`, with `OQ-236-007` and `OQ-236-008` closed |
| Owner | Alexander Wohlford |
| Jira subtask | [CBD-236](https://cobudget.atlassian.net/browse/CBD-236) |
| Parent | [CBD-24](https://cobudget.atlassian.net/browse/CBD-24) — Enforce owner authorization, under epic [CBD-4](https://cobudget.atlassian.net/browse/CBD-4) |
| Subject package | `packages/contracts` (`@cobudget/contracts`) for the decision core; `apps/api` and `apps/worker` for the enforcement adapters. See §3 |
| Governing permission model | CBD-72 approved v0.1.54 — §2, §3 `PM-72-001`–`PM-72-011`, §4 matrix permissions 1–35, §8 required inputs, §9 audit inventory |
| Governing authority model | CBD-82 approved v0.2.1 — `AU-82-01`–`AU-82-10`, `LK-82-01`–`LK-82-07`; `CBD82-APPROVAL-CONDITION-001` is satisfied |
| Governing threat and control sources | CBD-92 approved v1.0.1 — `SA-92-*`, `CA-92-*`, `OP-92-*`, `RL-92-*`, `TH-92-008`–`TH-92-013`, `TH-92-017`–`TH-92-018`, `RF-92-001`; CBD-93 approved v1.1.2 — §2.1 actor postures; CBD-94 approved v1.0.4 — `SR-94-001`–`SR-94-021`, `SR-94-063`–`SR-94-065`, `VT-94-018`–`VT-94-035`, `PR-94-001`, `PR-94-004`, `PR-94-005` |
| Scope record | CBD-76 approved v1.0.1 — `INC-76-007`, `PRO-76-001`, `PRO-76-008`; CBD-95 `FU-95-006` |
| Milestone | `PROTOTYPE-SLICE-001` and `PROVIDERS-LOCAL-001` (Executive, September 12, 2026) |
| Repository baseline | `8ac588f` on `main` |
| Last updated | September 12, 2026 |

> **Authority.** CBD-72 decides what each role may do and CBD-82 decides who holds authority over a profile, a connection, and a link. This document decides neither. It decides the single server-side path through which those decisions are evaluated, the shape of what goes in and what comes out, how a decision is versioned and rechecked at commit, and where the code lives. Where this document appears to widen or narrow an approved permission, the approved source wins and this document is wrong.

## 1. Purpose, authority, and limits

CBD-24 asks for one deny-by-default policy decision path that request handlers, data-access helpers, derived surfaces, and mutation commits cannot bypass. CBD-95 `FU-95-006` records why that path does not yet exist: "CBD-24 exists but is materially thinner than the approved control contract," and names the deliverable as an architecture decision record, a complete policy schema, a call-site inventory, and deterministic allow/deny fixtures. CBD-92 `RF-92-001` states the same gap from the threat side: the two authority modes are approved but "there is no selected policy evaluation point, typed/signed decision contract, purpose/effect enforcement mechanism, version propagation rule, or invalidation SLO."

This document is the architecture decision half of that deliverable. It supplies:

* the policy input schema (§4) and decision output (§5), typed so that a decision cannot be constructed from a request payload;
* the versioning and commit-time re-evaluation rule (§6);
* the fail-closed enforcement boundary in the API and the worker (§7);
* the complete current CBD-72 Primary Owner column, plus the one approved service-authority cell, with every other role and service purpose denied until mapped (§8);
* the negative cases each acceptance criterion names (§9), the deterministic fixture catalog rule (§10), and the policy-log allowlist (§11);
* the package placement, the interfaces it touches, and the migration path (§3, §12);
* the alternatives and selected local transport (§13), the remaining questions and recorded Executive decisions (§14), and the disposition of `RF-92-001` (§15).

It does not supply code. CBD-236's implementation half — the `packages/contracts` module, the API and worker adapters, the fixtures, and the unit and property tests — follows as a separate implementation packet once this contract has passed Security and Product review, which is the completion standard the ticket states.

`PROTOTYPE-SLICE-001` is an evidence milestone, not a reduction of the approved Private-MVP boundary: it exercises sign-in, one account subject and financial profile, one personal budget space with exactly one Primary Owner, monthly schedule/category targets, persistence, and reload. It expressly says invitations, alerts, exports, linked accounts, comments, archival, and deletion remain Included although the milestone does not evidence them. Therefore policy version 1 maps the complete current CBD-72 Primary Owner column required by AC04; the prototype is expected to exercise only the smaller route subset that exists in that increment. Under `PROVIDERS-LOCAL-001` there is no identity provider; the subject and assurance facts arrive through the CBD-190 contract from a local Cognito-shaped adapter, and this document consumes that contract's shape rather than the provider's.

Rules marked **Binding** govern the implementation packet and its review. A change to one is a change to this record.

## 2. Decision summary

**`PC-236-001` (Binding). There is exactly one policy entry point, `decide(input: PolicyInput): PolicyDecision`, and it is a pure function.** It performs no I/O, consults no store, reads no request, and holds no mutable state. Every fact it needs is in `PolicyInput`; every consequence it produces is in `PolicyDecision`. This is what makes the decision deterministic, fixture-testable, and property-testable, and it is what lets the API and the worker share one implementation (`SR-94-012`, `SR-94-015`).

**`PC-236-002` (Binding). The input is assembled only by a server-side context assembler from verified stores; the request or job envelope supplies locators and intent, never authority facts.** A caller or producer may name a resource, an action, and a field set. The API resolves user authority from the session store, application datastore, and identity-provider evidence; the worker resolves user-delegated authority from its authenticated envelope's opaque delegation locator and then the current delegation/application stores, or resolves service authority from authenticated workload identity and current server-side policy/source stores. Role, consent, assurance, purpose authority, owning scope, and current versions never come from headers, bodies, query strings, ordinary envelope fields, cookies other than the opaque application session, or cached client state (`SR-94-004`, `SR-94-013`–`SR-94-015`, `SR-94-032`, CBD-104 `ID-104-004`).

**`PC-236-003` (Binding). Denial is the default and the only response to an input the policy cannot fully evaluate.** Allow is produced only when every predicate for the exact matrix cell passes on a complete, well-formed, current input. A missing, malformed, unknown, inactive, revoked, expired, stale, cross-space, or unsupported field denies without evaluating the rest and without any customer-data effect (CBD-72 `PM-72-001`, `PM-72-004`; CBD-82 `LK-82-05`, `PB-82-09`; `SR-94-013`).

**`PC-236-004` (Binding). A decision names the immutable policy tuple that produced it, and an effect is applied only inside a commit that reloads the same authority sources, proves exact version equality, and re-evaluates the comparable authority snapshot against that tuple.** §6 gives the rule. A precheck decision is advisory; a commit decision is the one that authorizes an effect (`AU-82-09`, `SR-94-019`, `TH-92-013`).

**`PC-236-005` (Binding). Policy version 1 maps every current CBD-72 Primary Owner cell, including the explicit `Deny` and `Not applicable` cells, and the approved `SA-92-002` service cell. Every other role and service purpose denies until mapped from an approved source in a later immutable version.** The schema knows all five roles and all thirty-five numbered permissions; action codes preserve each separately governed operation (§8). This complete mapping satisfies AC04's scope without claiming that every mapped capability is exercised by `PROTOTYPE-SLICE-001`.

## 3. Where the contract lands, and why

**`PC-236-006` (Binding). The decision core lives in `packages/contracts` under `src/authorization/`, exported as `@cobudget/contracts/authorization`. The enforcement adapters live in `apps/api/src/authorization/` and `apps/worker/src/authorization/`.**

The reasons, in the order they decided it:

1. **Both the API and the worker must call the same function.** `SA-92-*` gives background work its own authority mode; `SR-94-015` requires a worker to prove either user-delegated authority or exactly one listed purpose, and `VT-94-023` tests that an unlisted purpose "cannot fall back to system authority." A policy implemented inside `apps/api` would leave the worker to reimplement it, which is the alternate authorization path CBD-24 forbids. `packages/contracts` is the package both applications already import (`@cobudget/api` and `@cobudget/worker` both depend on `@cobudget/contracts`), and its charter — "no I/O beyond reading the environment, no framework, no persistence, no provider SDK" — is exactly the constraint `PC-236-001` places on the decision core.
2. **The precedent is already in the package.** `packages/contracts/src/telemetry/reliability-event.ts` is "the allowlist as a type" with a runtime filter that both applications import "so that changing it breaks the type check in both." The policy input, decision, reason classes, and log allowlist are the same kind of artifact and belong beside it.
3. **`packages/budget-domain` is the wrong home.** CBD-168 fixes that package as pure budget logic — schedule, income, targets — with no consumer yet. Authorization is cross-cutting and consumes the domain's identifiers; putting policy there would make the budget engine depend on membership and consent, which it has no business knowing.
4. **The adapters are application code because they do I/O.** The API adapter resolves the opaque session (CBD-191), loads facts through the CBD-246 data-access seam, builds `PolicyInput`, calls `decide`, and hands the handler an `AuthorizedContext`. The worker adapter does the same from a job envelope. Neither may contain a predicate; a predicate in an adapter is a second policy.

The module layout the implementation packet builds:

| Path | Contents | Owner of change |
| --- | --- | --- |
| `packages/contracts/src/authorization/input.ts` | The discriminated `PolicyInput` variants and their field-level `FactProvenance` map (§4) | This record §4 |
| `packages/contracts/src/authorization/decision.ts` | `PolicyDecision`, `Obligation`, the branded `AuthorizedEffect` token (§5, §6) | This record §5–§6 |
| `packages/contracts/src/authorization/reason.ts` | The closed `ReasonClass` union and the external collapse rule (§5.2) | `PR-94-004` route; §14 `OQ-236-001` |
| `packages/contracts/src/authorization/policy/v1.ts` | The frozen `POLICY_SET`: `ACTION_DEFINITIONS`, `USER_CELLS`, `SERVICE_CELLS`, and predicates/obligations (§4.2, §8) | Product-approved CBD-72 and CBD-92 cells only |
| `packages/contracts/src/authorization/policy/registry.ts` | `POLICY_VERSIONS`, `CURRENT_POLICY_VERSION`, digests, and the compatibility check (§6) | This record §6 |
| `config/authorization-policy-release-history.json` | Independently governed append-only released version/digest/schema/commit and approval pins (§6) | Product Owner and Security sign-off required by `CBD236-POLICY-APPROVAL-001` |
| `packages/contracts/src/authorization/evaluate.ts` | `decide()` | This record §2 |
| `packages/contracts/src/authorization/log.ts` | `PolicyAuditEvent` allowlist and runtime filter (§11) | This record §11 |
| `packages/contracts/src/authorization/fixtures/` | Deterministic fixtures generated from `ACTION_DEFINITIONS` and both cell tables plus the negative families (§10) | Generated; never hand-edited |
| `apps/api/src/authorization/` | Session resolution hook, route authorization metadata, context assembler, the `preHandler` chain, the commit recheck helper (§7.1) | Implementation packet |
| `apps/worker/src/authorization/` | Envelope validation, purpose binding, context assembler, and atomic transport-consumption adapter for jobs (§5.1, §7.2) | Implementation packet |

The package keeps `erasableSyntaxOnly` and source-through-`exports` consumption exactly as CBD-168 `DC-168-001`–`DC-168-006` fix them for the sibling package: no enums (closed string unions instead), no build step, explicit `.ts` extensions.

## 4. The policy input schema

**`PC-236-007` (Binding). `PolicyInput` is the complete, versioned discriminated union of `ApiOrdinaryUserPolicyInput`, `ApiBootstrapUserPolicyInput`, `WorkerUserDelegatedPolicyInput`, and `WorkerServicePolicyInput`. Every present fact carries field-level provenance, and caller- or envelope-originated values may occupy only the locator/intent fields assigned in §4.2.** A field whose provenance is anything other than the one listed, a missing required field, or a field forbidden by the selected variant is a malformed input and denies.

Ticket scope names the sections: account/profile, space, membership role, consent, resource scope, requested action/purpose and policy-derived effect class, lifecycle, policy/auth/target versions, assurance, and service authority. Each declared input is a section of the record; the effect class is derived inside `decide` as §4.2 requires. Identifiers are the opaque, stable identifiers CBD-82 §3 requires; none encodes a provider identifier, a subject, or a space.

### 4.1 Sections and fields

| Section | Field | Type | Provenance | Source rule |
| --- | --- | --- | --- | --- |
| `subject` | `accountSubjectId` | opaque id | adapter-path verified user binding | session store for API; resolved current delegation for worker user-delegated; §4.2 |
| `subject` | `sessionRef`, `sessionVersion` | opaque reference, never the session identifier itself; integer; API user variants only | session store | `SR-94-002`; CBD-191 rotation and revocation; never logged |
| `subject` | `delegationRef`, `delegationVersion` | opaque reference; integer; worker user-delegated variant only | verified delegation store | the authenticated envelope supplies only the reference; the worker resolves and reloads the current delegation |
| `subject` | `subjectState`, `subjectVersion` | `active` / `deletion_requested` / `deleted`; integer | datastore (`EN-82-01`) | `PA-92-*`; only `active` can be allowed; version is captured for a mutation |
| `assurance` | `level` | `session` / `fresh` | adapter-path verified assurance | current identity-provider evidence for API; current delegation store for worker user-delegated; `SR-94-001`; `DI-91-052`; §4.2 |
| `assurance` | `boundAction`, `boundSpaceId`, `expiresAt` | present only when `level` is `fresh` | adapter-path verified assurance | current identity-provider evidence for API; current delegation store for worker user-delegated; CBD-72 §6.1; CBD-104 `ID-104-007`; §4.2 |
| `profile` | `profileId`, `profileState`, `profileVersion` | opaque id; `absent` / `active` / `deleted`; integer | datastore (`EN-82-02`) | `CD-82-01`; exactly one active per subject; version is captured for a mutation |
| `bootstrap` | `candidateSpaceId`, `candidatePrimaryMembershipId` | opaque ids; present only for `space.create` | server identifier allocator | generated server-side; neither identifier is accepted from the request |
| `bootstrap` | `spaceState`, `primaryMembershipState` | literal `absent`; present only for `space.create` | datastore negative lookup | both absences are rechecked under the creation transaction and protected by unique constraints (§6.1) |
| `space` | `spaceId` | opaque id | datastore; for a request, resolved from the route locator and then verified as the owning space of every named resource | `PM-72-010`; `SR-94-014` |
| `space` | `lifecycle`, `lifecycleVersion` | `live` / `archived` / `deletion_pending` / `purged`; integer | datastore | CBD-72 §6.4–§6.5; state and version are re-read at commit |
| `space` | `primaryOwnerMembershipId` | opaque id | datastore | `PM-72-008` invariant input |
| `membership` | `membershipId` | opaque id | datastore | CBD-72 §8 |
| `membership` | `role` | `primary_owner` / `co_owner` / `collaborator` / `viewer` / `accountability_partner` | datastore | CBD-76 §7 internal enum; never a display name |
| `membership` | `status` | `active` / `pending` / `revoked` / `expired` / `inactive` | datastore | CBD-72 §2.1; only `active` can be allowed |
| `membership` | `authorizationVersion` | integer | datastore (`DI-91-005`) | bumps on any role, profile, scope, consent, or status change |
| `membership` | `viewerProfile` | `{ type, groupIds, version }` or absent | datastore | CBD-72 §5.1; required whenever `role` is `viewer` |
| `consent` | `consentId`, `disclosureVersion`, `state` | opaque id; integer; `current` / `superseded` / `ended` | datastore (`DI-91-007`) | CBD-73 §6 rule 6: consent evidence never authorizes, but a membership whose consent is not `current` cannot be allowed |
| `resource` | `type` | closed union of CBD-72 §2.3 entities plus `space`, `membership`, `connection`, `link`, `interaction`, `alert_instance`, `export_package`, `profile`, `preference` | adapter-path locator, then verified | exact producer is fixed by §4.2; `SR-94-014` |
| `resource` | `id` | opaque id | adapter-path locator, then verified against the datastore | exact producer is fixed by §4.2; identifier is a locator, never authority |
| `resource` | `owningSpaceId` | opaque id or `none` for profile-domain resources | datastore | `PM-72-010`; must equal `space.spaceId` or the input is cross-space |
| `resource` | `version` | integer | datastore | `TH-92-013` |
| `resource` | `authorizerSubjectId` | opaque id; present for `connection` | datastore (`FD-82-008`) | `AU-82-01`, `AU-82-02` |
| `resource` | `authorSubjectId` | opaque id; present for `interaction` | datastore | CBD-72 permissions 11b–11c |
| `resource` | `lifecycle` | resource-specific state from the CBD-82 §3 and CBD-72 §5.5 state sets | datastore | `PM-72-003` |
| `request` | `action` | `ActionCode` (§8.1) | adapter-path intent | exact producer is fixed by §4.2; the CBD-72 permission number is the citation key |
| `request` | `purpose` | `user_delegated` or an `SA-92-00N` purpose | adapter-path binding | exact producer is fixed by §4.2; CBD-92 §2.4 |
| `request` | `fieldSet` | closed list of field identifiers, or `default` | adapter-path intent | exact producer is fixed by §4.2; CBD-72 §8 "requested field set"; `SR-94-016` |
| `versions` | `policyVersion` | policy version identifier (§6) | the deployed registry | never from the request |
| `versions` | `capturedAtPrecheck` | input-variant-specific version record or absent in the precheck phase | the precheck decision | §6.1; present and complete only in the commit phase |
| `authority` | `mode` | `user_delegated` / `service` | adapter-path verified authority | exact producer is fixed by §4.2; `SA-92-*` |
| `authority` | `servicePurpose`, `serviceIdentity`, `workloadIdentityVersion`, `servicePolicyVersion`, `sourceVersion` | present only when `mode` is `service` | authenticated workload identity and current server-side service-policy/source stores; the envelope supplies locators and claimed versions only | `SR-94-015`, `SR-94-032` |
| `serviceSource` | `scheduleConfigurationVersion`, `ruleReferenceDataVersion`, `sourceState` | integers; `current` / `superseded` / `disabled`; present only for `SA-92-002` | current schedule/configuration and rule/reference-data stores | CBD-92 `SA-92-002`; only `current` can allow |
| `evaluation` | `adapter` | `api` / `worker` | contracts package | discriminates the exact producer matrix below |
| `evaluation` | `evaluatedAt` | UTC timestamp | the assembler's clock | expiry comparisons |
| `evaluation` | `inputSchemaVersion` | integer | the contracts package | rejects an assembler built against another schema |

### 4.2 Provenance and the request boundary

`FactProvenance` is an exact field-path map, not one marker for a whole section. For every present leaf in the selected input variant, `provenance["section.field"]` records exactly one source from the closed union `session_store`, `delegation_store`, `datastore`, `idp_evidence`, `registry`, `request_locator`, `route_metadata`, `envelope_locator`, `workload_identity`, `server_policy_store`, `precheck_decision`, `assembler_clock`, `contracts_package`, or `server_identifier_allocator`. The assembler emits exactly one entry per present leaf; missing, extra, section-level-only, or wrong-source entries deny `input_invalid`. `decide` validates every entry against this exhaustive producer matrix; an em dash means the field is forbidden in that variant:

| Exact leaf path(s) | API ordinary user | API bootstrap user | Worker user-delegated | Worker service |
| --- | --- | --- | --- | --- |
| `subject.accountSubjectId` | `session_store` | `session_store` | `delegation_store` | — |
| `subject.sessionRef`, `subject.sessionVersion` | `session_store` | `session_store` | — | — |
| `subject.delegationRef`, `subject.delegationVersion` | — | — | `delegation_store` | — |
| `subject.subjectState`, `subject.subjectVersion` | `datastore` | `datastore` | `datastore` | — |
| `assurance.level`, `assurance.boundAction`, `assurance.boundSpaceId`, `assurance.expiresAt` | `idp_evidence` | `idp_evidence` | `delegation_store` | — |
| `profile.profileId`, `profile.profileState`, `profile.profileVersion` | `datastore` | `datastore` | `datastore` | — |
| `bootstrap.candidateSpaceId`, `bootstrap.candidatePrimaryMembershipId` | — | `server_identifier_allocator` | — | — |
| `bootstrap.spaceState`, `bootstrap.primaryMembershipState` | — | `datastore` | — | — |
| `space.spaceId`, `space.lifecycle`, `space.lifecycleVersion`, `space.primaryOwnerMembershipId` | `datastore` | — | `datastore` | `datastore` |
| `membership.membershipId`, `membership.role`, `membership.status`, `membership.authorizationVersion`, `membership.viewerProfile.type`, `membership.viewerProfile.groupIds`, `membership.viewerProfile.version` | `datastore` | — | `datastore` | — |
| `consent.consentId`, `consent.disclosureVersion`, `consent.state` | `datastore` | — | `datastore` | — |
| `resource.type` | `route_metadata` | — | `envelope_locator` | `envelope_locator` |
| `resource.id` | `request_locator` | — | `envelope_locator` | `envelope_locator` |
| `resource.owningSpaceId`, `resource.version`, `resource.authorizerSubjectId`, `resource.authorSubjectId`, `resource.lifecycle` | `datastore` | — | `datastore` | `datastore` |
| `request.action` | `route_metadata` | `route_metadata` | `envelope_locator` | `envelope_locator` |
| `request.purpose` | `route_metadata` | `route_metadata` | `delegation_store` | `server_policy_store` |
| `request.fieldSet` | `request_locator` | `route_metadata` | `envelope_locator` | `envelope_locator` |
| `versions.policyVersion` | `registry` | `registry` | `registry` | `registry` |
| `versions.capturedAtPrecheck.*` when present | `precheck_decision` | `precheck_decision` | `precheck_decision` | `precheck_decision` |
| `authority.mode` | `route_metadata` | `route_metadata` | `delegation_store` | `workload_identity` |
| `authority.servicePurpose`, `authority.serviceIdentity`, `authority.workloadIdentityVersion` | — | — | — | `workload_identity` |
| `authority.servicePolicyVersion`, `authority.sourceVersion` | — | — | — | `server_policy_store` |
| `serviceSource.scheduleConfigurationVersion`, `serviceSource.ruleReferenceDataVersion`, `serviceSource.sourceState` | — | — | — | `server_policy_store` |
| `evaluation.adapter`, `evaluation.inputSchemaVersion` | `contracts_package` | `contracts_package` | `contracts_package` | `contracts_package` |
| `evaluation.evaluatedAt` | `assembler_clock` | `assembler_clock` | `assembler_clock` | `assembler_clock` |

There are four concrete variants: `ApiOrdinaryUserPolicyInput`, `ApiBootstrapUserPolicyInput`, `WorkerUserDelegatedPolicyInput`, and `WorkerServicePolicyInput`. Each requires exactly the fields assigned in its matrix column and forbids fields marked with an em dash, subject to the conditional rows in §4.1: fresh-assurance bindings exist only for `fresh`, Viewer profile leaves only for Viewer, target-specific resource leaves only for the applicable resource, and `capturedAtPrecheck` only at commit. The worker user-delegated variant resolves the envelope's opaque delegation reference through the current delegation store; the envelope cannot supply subject, role, assurance, consent, or version facts. The worker service variant authenticates its workload first and resolves the current purpose and versions from server-side stores. Thus an envelope locator can select a row to load but cannot become a verified authority fact.

`request.effect` is deliberately not a `PolicyInput` field and has no provenance entry. The frozen `ACTION_DEFINITIONS` table inside the selected `POLICY_SET` maps each supported `request.action` to exactly one `{ effectClass, resourceType, authorityModes }` record. After input-shape and provenance validation, `decide` performs that lookup and derives the authoritative `effectClass` internally; an absent action definition denies `input_unsupported`. Adapters may transport a `claimedEffectClass` outside `PolicyInput` for routing or envelope validation, but they never stamp it as a fact: the verifier compares it with the decision's authoritative `effectClass`, and mismatch denies. This lookup is part of the one `decide` entry point, not an adapter predicate.

The only caller- or envelope-contributed values are intent and locators in the matrix: they name the action, field set, and row the assembler loads. The assembler then verifies the row's `owningSpaceId` against the acting space, and a mismatch is reported as a cross-space input, not as a lookup failure (`PM-72-010`, CBD-72 §7 last row, `XSP-02`).

### 4.3 Space creation: the one input with no membership

`PROTOTYPE-SLICE-001` requires "deny-by-default from the first persisted budget space." Before a space exists there is no membership to evaluate, so `space.create` is the single `BootstrapUserPolicyInput` action. Its bootstrap cell is keyed on the active subject, active profile, user-delegated authority, session-or-better assurance, server-generated candidate identifiers, and verified absence of both the candidate space and candidate Primary membership. It does not synthesize an ordinary space, membership, consent, resource, or target version. The allow decision carries `{ kind: "bootstrap", action: "space.create" }`, the complete `BootstrapCapturedVersions`, and the obligation `create_primary_owner_membership`. The commit rechecks the captured records and both absences, then writes the space, the sole `primary_owner` membership, and the initial schedule version in one transaction guarded by the datastore uniqueness constraints (CBD-23; CBD-72 `PM-72-008`). A collision or newly present row denies `stale_version`; no second action is evaluable against the space until that membership row exists. `OQ-236-006` asks Product and Security to confirm this is the only membership-free cell.

## 5. The decision output

**`PC-236-008` (Binding). `PolicyDecision` is the internal record below and nothing else.** It is consumed only by enforcement and restricted-audit adapters; it is never serialized to a customer. It may cross a process boundary only as the decision payload of the signed service envelope defined below. The response adapter emits only the uniform external denial envelope described in §5.2; `OQ-236-001/002` must approve its vocabulary and transport before a protected surface ships.

### 5.1 Fields

| Field | Type | Meaning |
| --- | --- | --- |
| `outcome` | `allow` / `deny` | Explicit. There is no third value and no "allow with conditions" — conditions are obligations, and an undischarged obligation is a denial at commit |
| `effectClass` | `read` / `mutate` / `export` / `acknowledge` / `comment` / `lifecycle` / `protected`, or absent for an unsupported/malformed action | Derived only by `decide` from the selected policy version's `ACTION_DEFINITIONS`; never copied from an adapter or envelope |
| `reasonClass` | `ReasonClass` (§5.2) | Present on every decision, including allow (`allowed_by_cell`), so a log line never has to infer it |
| `policyVersion` | policy version identifier | The immutable version evaluated (§6) |
| `policyDigest` | hex digest | The content digest of that version's policy set, so a decision can prove which table it ran against |
| `cellRef` | `{ kind: "user", permission, role }` / `{ kind: "bootstrap", action: "space.create" }` / `{ kind: "service", purpose, operation }` or absent | The exact ordinary-user, bootstrap, or service cell that decided an allow; absent on deny |
| `inputDigest` | hex digest | Digest of the comparable authority snapshot, excluding `evaluation.evaluatedAt` and the phase-only `versions.capturedAtPrecheck`; the commit recheck compares it (§6) |
| `capturedVersions` | `ApiUserCapturedVersions` / `BootstrapCapturedVersions` / `WorkerUserDelegatedCapturedVersions` / `ServiceCapturedVersions` or absent | The complete input-variant-specific version set in §6.1 that an allow was computed against; absent on deny |
| `obligations` | `Obligation[]` | Exactly `audit` on deny; on allow, `audit` plus the closed instructions required by the matched cell (§5.3) |
| `decisionId` | opaque id | Correlation for audit and for the commit recheck |
| `evaluatedAt` | UTC timestamp | Copied from the input |

`TransportedPolicyDecision` is the exact service envelope `{ decision, action, targetBinding, claimedEffectClass, issuer, audience, issuedAt, expiresAt, oneUseId, algorithm, signature }`. `algorithm` is the literal `Ed25519`, using the Node runtime crypto implementation rather than a new dependency. The signed bytes are the UTF-8 encoding of the fixed domain separator `cobudget.authorization.TransportedPolicyDecision.v1` followed by one zero byte and the RFC 8785 JSON Canonicalization Scheme serialization of the envelope with `signature` omitted; no runtime-dependent object-key order or alternate number/string encoding is accepted. The verifier rejects any other algorithm, wrong issuer/audience, future or expired lifetime, lifetime above the configured local maximum, signature failure, or any envelope whose exact policy tuple/digest/input/action/target binding differs from the receiving operation. It also compares `claimedEffectClass` with the `effectClass` derived inside `decide`; inequality denies, and the claim is never inserted into `PolicyInput`. Key material is never an envelope field or log field. Under `CBD236-SIGNING-KEY-001`, an explicitly local runtime generates one key pair per developer environment: only the signing process receives the private key, local verifiers receive the public key, and neither is committed or exported outside that environment. Every non-local verifier fails closed until hosting supplies approved custody and activation configuration.

The local receiver owns an `AuthorizationTransportConsumption` relation in the same transactional datastore used by the protected effect. Its unique key is `{ developerEnvironmentId, issuer, audience, oneUseId }`; its row also records the envelope digest, purpose, action, target binding, policy tuple, `issuedAt`, `expiresAt`, consumption time, and, for a material effect, the separate durable idempotency key required by `SR-94-033`. The environment identifier comes from trusted receiver configuration, never the envelope. The relation is shared by every receiver process in that developer environment and survives process restart. A row is retained at least through `expiresAt` plus the verifier's maximum accepted clock-skew window; after that point expiry rejection is authoritative and garbage collection may remove it. The replay row is restricted authorization metadata and follows the same no-content/no-credential logging boundary as §11.

For a transported mutation, signature and binding validation occur first without consuming the identifier. Inside the same datastore transaction as §6 commit re-evaluation, audit, and the material effect, the runtime inserts the consumption row using the unique key; the insert must succeed exactly once before the mutation callback can run. A uniqueness conflict is `reused_one_use_id`, denies, and performs no effect. Concurrent receivers therefore have one winner. Any failure before transaction commit rolls back both consumption and effect so a bounded retry may try the same envelope again; any successful commit persists both, so a lost acknowledgement cannot re-run the effect. On redelivery after an ambiguous acknowledgement, the worker reconciles the separately scoped `SR-94-033` material-effect record and returns its bounded already-committed terminal result rather than applying the mutation again. Store unavailability, uncertain transaction outcome, or inability to prove the replay row/effect relationship fails closed and enters the bounded reconciliation path; it is never converted to allow. A transported read inserts and commits the consumption row before releasing customer data, and releases no data if that commit is uncertain. The material-effect idempotency key remains distinct from `oneUseId`: the first prevents duplicate business effects across authorized retries or redrive, while the second prevents reuse of one signed authorization.

### 5.2 Safe reason classes

**`PC-236-009` (Binding). `ReasonClass` is a closed union. Internal classes are recorded in security evidence; the customer-facing response uses the single external class for every denial on an existence-sensitive surface.**

| Class | Produced when | External class |
| --- | --- | --- |
| `allowed_by_cell` | Every predicate of one cell passed | not a denial |
| `not_authenticated` | No live session resolved | `denied` |
| `input_invalid` | A required field is missing, malformed, or carries the wrong provenance | `denied` |
| `input_unsupported` | The action is reserved but has no table in this policy version, or the action, resource type, purpose, field set, or schema version is unknown | `denied` |
| `policy_version_unsupported` | The registry does not hold the requested version, or its digest mismatches | `denied`; also a startup failure (§6) |
| `subject_not_active` | `subjectState` or `profileState` is not `active` | `denied` |
| `membership_not_active` | `membership.status` is not `active`, or no membership exists for the acting subject in the space | `denied` |
| `role_not_permitted` | An action represented in `USER_CELLS` is Deny or Not applicable for this role, or is mapped for another role but unmapped for this one | `denied` |
| `scope_mismatch` | `resource.owningSpaceId` differs from `space.spaceId`, or an `Authorizer` or `Own` cell's subject does not match | `denied` |
| `lifecycle_blocked` | The space or resource lifecycle does not admit the action (archived space and a mutation; `deletion_pending` and a non-restore action) | `denied` |
| `stale_version` | Any captured value is unequal to the current value at commit, or a bootstrap absence predicate no longer holds | `denied` |
| `consent_not_current` | The membership's consent state is not `current` | `denied` |
| `assurance_required` | The cell requires `fresh` assurance and only `session` is present | `denied`; internal security evidence only, with no customer-visible hint or non-audit obligation |
| `assurance_insufficient` | `fresh` assurance is present but bound to another action, space, or has expired | `denied` |
| `authority_mode_unsupported` | A service-mode input reached a user-delegated cell or the reverse | `denied` |
| `service_purpose_not_listed` | `servicePurpose` is not one of `SA-92-001`–`SA-92-008`, or the purpose's permitted effects do not include the policy-derived `effectClass` | `denied` |
| `reused_one_use_id` | A transported decision's `{ developerEnvironmentId, issuer, audience, oneUseId }` already exists in the authoritative consumption relation | `denied` |

The external class is deliberately one word. `RL-92-003`, `SR-94-020`, `SR-94-126`, and CBD-72 `XSP-02` require that every denial—including `assurance_required`—be indistinguishable from a nonexistent, cross-space, or otherwise unauthorized target in status, body, headers, length, retry behavior, notification side effects, and timing. A resource-sensitive denial never returns a step-up flag, URL, header, or obligation. A step-up ceremony may be offered only by a separate pre-resource stage whose response-equivalence for nonexistent and unauthorized targets has been approved under `PR-94-003`/`PR-94-004` and proven by differential tests; until then no such hint ships. Whether the single external class is transported as not-found or forbidden remains `OQ-236-001`/`OQ-236-002`. The internal classes above are proposed restricted-security-evidence classes, not an approved customer vocabulary.

### 5.3 Obligations

**`PC-236-010` (Binding). An obligation is a closed, typed instruction the enforcement adapter must discharge before or inside the commit. An adapter that cannot discharge an obligation treats the decision as deny.**

| Obligation | Carried by | Discharged by |
| --- | --- | --- |
| `audit { eventClass }` | Every decision | Writing the `PolicyAuditEvent` (§11) in the same transaction as the effect, or before returning a denial |
| `recheck_at_commit { capturedVersions }` | Every allow whose `effectClass` is not `read` | Calling `decide` again inside the transaction with rows read under lock; §6 |
| `fresh_assurance { actionClass, spaceId }` | Every cell CBD-72 marks as a protected action (permissions 20a, 20b, 27, 29, 34, 35; restoration; Primary-package generation) | Presenting a `fresh` assurance bound to that action and space with an unexpired window (CBD-72 §6.1; CBD-104 `ID-104-007`) |
| `create_primary_owner_membership` | `space.create` only | The atomic creation transaction (§4.3) |
| `mask { fieldSet }` | Every `Scoped` or `Read` cell whose role has a field boundary | Removing the named fields, identifiers, counts, and shapes before serialization (`SR-94-016`) |
| `label_partial_view` | Every `Scoped` cell for a Viewer profile other than Full budget | The "Shared view — not the full budget" label (CBD-72 §5.1 item 10) |
| `bind_cache_key { dimensions }` | Every `read` allow on a derived surface | Including every listed dimension in the cache, index, or report key (`SR-94-017`) |
| `notify { class }` | Cells whose approved rule requires a safe notice | The notification layer, under `PR-94-004` classes |
| `confirm { targetDescriptor, consequenceClass }` | Cells whose approved rule requires explicit confirmation | A versioned, action-bound confirmation naming only the authorized target and approved consequence class; absence or mismatch denies |
| `invalidate { artifactClasses }` | Cells whose approved rule revokes or changes access, lifecycle, or derived state | Atomic invalidation or disposition of every named cache, view, job, package, link, alert, or open-work class |
| `preserve { recordClasses }` | Cells that archive, remove, disconnect, or correct without erasing governed history/source fields | The same transaction retains the named history, provenance, tombstone, or immutable source fields |
| `secure_package { allowlist, recipientBinding, retentionClass }` | Export and snapshot cells | Pre-serialization allowlist/redaction, recipient-bound encryption, generation/download authorization, rate limit, and bounded retention/expiry |

Policy version 1 may emit every obligation above because it contains the complete Primary Owner column. `fresh_assurance` is carried only by an allow after fresh, correctly bound evidence has already passed the cell predicate; it is never carried by a deny or exposed as customer guidance. The full per-cell obligation and predicate reconciliation is §8.3.

## 6. Versioning and the commit-time re-evaluation rule

**`PC-236-011` (Binding). A released policy version is immutable, enforced against independent history.** `POLICY_VERSIONS` is a frozen registry in `packages/contracts`. Each entry is `{ version, digest, actionDefinitions, userCells, serviceCells, schemaVersion }`, where `version` is an opaque monotonic identifier (`p1`, `p2`, …) and `digest` is the SHA-256 of the canonical serialization of all three tables. Changing an action definition, cell, predicate, or obligation produces a new version; an old entry is never edited.

The implementation also creates `config/authorization-policy-release-history.json`, an append-only release manifest outside the registry and package exports. Each released row pins `{ version, digest, schemaVersion, releaseCommit, productApprovalRef, securityApprovalRef }`. Under `CBD236-POLICY-APPROVAL-001`, a row may be appended only after Product Owner and Security sign-off of that exact version; both resolvable sign-off references are mandatory in the row. A CI immutability guard validates those required references and compares every row present on the merge base or signed release tag byte-for-byte with the candidate: an existing row may not be changed or removed, and the corresponding registry serialization must hash to its pinned digest. Updating an old cell and its adjacent registry digest therefore still fails against independently pinned history; updating the historical row also fails the append-only comparison. Before the first approved release, the candidate `p1` row is not falsely described as released evidence.

**`PC-236-012` (Binding). Every decision identifies the version and digest used, and every audit event and every persisted authorization-bearing record carries them.** CBD-72 §9 requires "policy/rule version" on every audit event; CBD-73 `DR-73-01` and `DR-73-04` already carry a policy version on invitation and consent records.

**`PC-236-013` (Binding). Deployment rejects an application/policy compatibility mismatch at startup.** `apps/api` and `apps/worker` each declare the exact supported tuples `SUPPORTED_POLICY_TUPLES: { version, expectedDigest, schemaVersion }[]`; version-only or separate unpaired sets are forbidden. Before the first route or job is registered, each application verifies that its selected tuple exists, the registry serialization hashes to `expectedDigest`, and the independent release-history row matches the same tuple. Missing, extra, or mismatched values are a fatal startup error with reason class `policy_version_unsupported`. A running application never re-reads policy; changing policy is a deployment.

### 6.1 Input-variant-specific captured versions

`ApiUserCapturedVersions` is exactly `{ sessionVersion, subjectVersion, profileVersion, authorizationVersion, consentDisclosureVersion, spaceLifecycleVersion, primaryOwnershipVersion, targetVersion, policyVersion, policyDigest, inputSchemaVersion }`. `WorkerUserDelegatedCapturedVersions` replaces `sessionVersion` with `delegationVersion` and is otherwise exact to the same set. A cell adds every target-specific workflow version it reads—for example schedule, recipient-membership, connection, package, or confirmation version—and the cell cannot allow unless that addition is declared.

`BootstrapCapturedVersions` for `space.create` is exactly `{ sessionVersion, subjectVersion, profileVersion, policyVersion, policyDigest, inputSchemaVersion }`. It contains no membership, consent, space-lifecycle, ownership, or target version because those records do not yet exist. The captured bootstrap input also binds the server-generated candidate space and Primary-membership identifiers; commit authorization additionally requires transactional absence checks for both identifiers, as stated below.

`ServiceCapturedVersions` for `SA-92-002` is exactly `{ workloadIdentityVersion, servicePolicyVersion, sourceVersion, scheduleConfigurationVersion, ruleReferenceDataVersion, spaceLifecycleVersion, targetVersion, policyVersion, policyDigest, inputSchemaVersion }`. Service authority never substitutes for a missing version and never inherits a user session, membership, or consent value.

**`PC-236-014` (Binding). The commit-time rule.** For any decision whose `effectClass` is not `read`:

1. **Precheck.** The adapter assembles `PolicyInput` from current rows and calls `decide`. A deny ends the request. An allow yields `capturedVersions`, `inputDigest`, and obligations. Nothing has been written.
2. **Discharge.** The adapter discharges every obligation that can be discharged before the transaction (`fresh_assurance`, `mask` planning). An undischargeable obligation converts the decision to deny with the obligation's reason class.
3. **Commit evaluation.** Inside the transaction/conditional write that applies the effect, the adapter re-reads every authority source named by the cell. API ordinary-user mode reloads the live session, subject, profile, membership, consent, Primary-ownership state, space lifecycle, target, and every cell-specific workflow/confirmation row. Worker user-delegated mode reloads the current delegation in place of the session and reloads the same datastore facts. Bootstrap-user mode reloads the live session, subject, and profile, verifies the candidate identifiers still match the precheck input, and proves under the same transaction that no space or Primary-membership row uses either identifier; uniqueness constraints make both absence predicates conditions of the insert. Service mode reauthenticates the workload identity and reloads the service-policy, envelope source, schedule/configuration, rule/reference data, space lifecycle, and target rows. It reassembles the same discriminated `PolicyInput` variant with the complete §6.1 precheck record and calls `decide` against the same policy tuple. **Every** captured value must equal—not merely be no older than—the reloaded value, and the comparable authority snapshot must reproduce the precheck `inputDigest`. Missing sources, newly present bootstrap rows, inequality, digest/tuple mismatch, or an undeclared version deny; other predicate failures use their ordinary internal class. Only this second allow authorizes the write, conditioned on the same equality or bootstrap-absence checks (`SR-94-019`; CBD-82 `LC-82-04`; CBD-72 `PM-72-003`, `PM-72-005`, `PM-72-008`; `VT-94-021`, `VT-94-030`).
4. **Runtime mutation seam.** The second allow is represented as an `AuthorizedEffect` branded and constructed only inside a private authorization module. The brand is a development guard, not the security boundary. The shared conditional-commit helper validates at runtime the decision provenance, input digest, exact policy tuple, action/derived-effect-class/target-or-bootstrap binding, obligation discharge evidence, and the §6.1 equality or absence set before invoking a mutation callback. For a transported decision, the same transaction first performs the unique `AuthorizationTransportConsumption` insert specified in §5.1; neither consumption, audit, nor effect may commit alone. No raw token constructor is exported. API routes and **every worker mutation** use this helper. CI inventories every protected route/job and datastore mutation import, rejects direct imports of private constructors or lower-level write clients, and rejects unregistered write paths. Runtime datastore identities are least-privilege: application code outside the helper and read-only worker paths lack the mutation capability. Casts, untyped boundaries, or direct datastore access therefore do not satisfy the contract and are covered by negative integration tests.
5. **Audit.** For an allow, the `PolicyAuditEvent` is part of the same atomic commit and audit failure rolls back the effect. For a commit-time deny, the protected transaction rolls back first; a separate restricted-audit write records the attempt before the denial returns and cannot mutate or disclose customer data. Its failure cannot turn the denial into allow and raises the bounded security/operations failure path (CBD-72 `PM-72-004`; CBD-82 `EV-82-21`).

For a `read`, one evaluation suffices, but the derived-surface obligations bind the result to the complete applicable version set so a cache, index, or report built from it is invalidated when any value changes (`SR-94-017`; CBD-82 `DS-82-01`, `DS-82-02`).

**`PC-236-015` (Binding). Version propagation.** `membership.authorizationVersion` increments on every role, status, Viewer profile, scope-group, consent, and ownership change to that membership; `space.lifecycle` changes increment every membership's version in that space; a policy version change is a deployment and invalidates nothing retroactively but makes every later decision carry the new version. The invalidation objective `RF-92-001` asks for is expressed as `PR-94-005` and is a value this document does not set (`OQ-236-004`).

## 7. The fail-closed enforcement boundary

**`PC-236-016` (Binding). No protected route or job executes without a decision, and every failure inside the boundary is a denial.** An exception, a timeout, a missing store, an unregistered route, a malformed envelope, or an assembler that cannot stamp provenance produces `input_invalid` or `not_authenticated`, never a pass-through. There is no development-mode bypass, no allowlist of unprotected paths beyond the explicitly public health and OpenAPI routes already in `apps/api`, and no environment variable that relaxes the chain.

### 7.1 The API chain

The order below runs as Fastify hooks and Nest guards in `apps/api`, before any handler, and the order matters because each step's failure must be indistinguishable from the next's:

1. **Session resolution** (CBD-191). The opaque cookie resolves server-side to `{ accountSubjectId, sessionVersion, sessionRef }` or the chain ends with `not_authenticated`. An IdP token is not a session (CBD-191-AC01).
2. **Surface registration** (CBD-266). The route's `RL-92-001` surface record is checked. CBD-266 denies a route whose surface has no approved record. The relative order of this step and step 3 is `OQ-236-003`, because both produce a uniform denial and the two subtasks must agree on which runs first.
3. **Route authorization metadata.** Every route declares `{ action, resourceLocator, purpose: "user_delegated" }` at registration. A route with no declaration is denied at request time and, mirroring CBD-266, listed and failed by a build check so it never reaches a deployment. This is the call-site inventory `FU-95-006` requires, produced by the framework rather than maintained by hand.
4. **Context assembly.** The assembler loads the subject, profile, acting membership, consent, space, and target rows through the CBD-246 tenant-scoped statements, stamps provenance, and builds `PolicyInput`. A row that cannot be loaded, or a target whose owning space is not the acting space, is recorded in the input as absent or cross-space; the assembler never substitutes a default tenant, a system actor, or a broader role (`SR-94-013`).
5. **Decision.** `decide` runs. A deny is serialized as the single external class with the uniform response contract (`PR-94-003`).
6. **Handler.** The handler receives an `AuthorizedContext` — the input, the decision, and the `AuthorizedEffect` for reads — and every CBD-246 statement it issues takes that context, which supplies the budget-space parameter CBD-246 requires on every tenant-scoped table. A handler cannot obtain a tenant parameter from anywhere else.
7. **Commit.** For a mutation, the handler opens the transaction through the recheck helper, which performs §6 steps 3–5 and hands the write its `AuthorizedEffect`.

### 7.2 The worker chain

A job envelope carries an authority-mode claim and either an opaque user-delegation reference plus operation locators or one `SA-92-00N` purpose locator with claimed versions (`SR-94-031`-shaped per `RF-92-003`, which this document does not design). The worker adapter authenticates the producer, validates the complete envelope before any lookup (`SR-94-032`), and treats ordinary envelope values only as locators and replay claims. For user-delegated work it resolves the current delegation and reloads subject, profile, membership, consent, space, target, and applicable assurance facts; for service work it authenticates the workload and reloads the current purpose, policy, source, lifecycle, target, and purpose-specific facts. It stamps only the exact §4.2 worker-column provenance, assembles that discriminated `PolicyInput`, and calls the same `decide` used by the API. A job with a missing/unequal version, unlisted purpose, `claimedEffectClass` unequal to the policy-derived class, or stale user-delegated binding denies and reaches the bounded terminal state `RL-92-006` requires. Every worker mutation then uses the §6 shared conditional-commit helper and complete re-read set. No unsigned API decision or envelope-carried authority fact is trusted; a local transported decision is accepted only after the §5 verifier succeeds, its one-use identifier is consumed atomically with the effect, and commit re-evaluation passes. Policy version 1 has the one service cell defined in §8.4, `SA-92-002`; the other seven purposes deny (`OQ-236-009`). The separately scoped material-effect idempotency key remains mandatory. `RF-92-003` still blocks a customer-data worker until its per-queue contract exists.

### 7.3 What the boundary does not do

It does not rate-limit (CBD-266), does not mask on its own (the `mask` obligation names the fields; the serializer removes them), does not key caches (the `bind_cache_key` obligation names the dimensions; `FU-95-010` designs the cache), and does not decide the response status of a denial (`PR-94-003`). Each of those is a consumer of the decision, not part of it.

## 8. The CBD-72 matrix adapter and policy version 1

**`PC-236-017` (Binding). One `POLICY_SET` contains three typed tables interpreted by the same `decide`: `ACTION_DEFINITIONS`, keyed by action and fixing its authoritative effect class/resource type/authority modes; `USER_CELLS`, keyed by CBD-72 permission and role; and `SERVICE_CELLS`, keyed by approved `SA-92-*` purpose and operation.** A user permission appears in no second cell table; a service purpose is not represented as a user role or CBD-72 permission. All three tables share the same version tuple and digest. The cell tables use the same input validation, effect vocabulary, decision output, obligations, audit path, and fail-closed rules. An adapter may select an action code but cannot map it to an effect class or override the table.

### 8.1 Action codes

An `ActionCode` is `<permission>.<operation>` using the CBD-72 permission number as the stable citation key, so an audit event, fixture, and scenario cite the same rule. Multi-operation rows have distinct codes—for example create category, edit category, archive category, and restore category are four separate permission-4 codes—because their predicates and obligations differ. Service action codes are `service.<SA-purpose>.<operation>`. `space.create` is the sole membership-free bootstrap action under CBD-23 and `PM-72-008` (§4.3). `profile.create`, `profile.read`, and `preference.update` are reserved known-but-unsupported codes only: no approved CBD-22 permission source and predicates are pinned here, so they do not appear in `USER_CELLS` and deterministically deny `input_unsupported` until Product supplies a table in a new version. By contrast, a supported `USER_CELLS` action presented by an unmapped role denies `role_not_permitted`.

### 8.2 Notation to predicate

| CBD-72 notation | Predicates `decide` requires, in addition to the universal ones | Universal predicates |
| --- | --- | --- |
| Allow | membership active, role matches the cell, resource lifecycle admits the operation | subject active; profile active; session live; consent current; lifecycle state admitted by the exact cell (baseline `live`; archived admits read effects and permissions 20a/20b/21 only at frozen archival scope; deletion cancel and Primary restore are the other explicit exceptions); resource owning space equals acting space; authority mode `user_delegated`; policy tuple supported |
| Read | as Allow, policy-derived `effectClass` is `read`; archived access is read-only at the member's frozen archival-time scope | as above |
| Scoped | as Read, plus `viewerProfile` present and the resource inside the profile's inherited scope; obligations `mask` and, unless Full budget, `label_partial_view` | as above |
| Authorizer | as Allow, plus `resource.authorizerSubjectId` equals `subject.accountSubjectId` | as above |
| Own | as Allow, plus `resource.authorSubjectId` equals the subject and the subject can currently read the target | as above |
| Primary | as Allow, plus `membership.membershipId` equals `space.primaryOwnerMembershipId`; obligation `fresh_assurance` where CBD-72 names it | as above |
| Deny | none; the cell denies with `role_not_permitted` | not evaluated |
| Not applicable | none; the cell denies with `role_not_permitted` (permission 13) | not evaluated |
| Action represented in `USER_CELLS`, role cell absent | none; denies with `role_not_permitted` | not evaluated |
| Action reserved without a policy table, or unknown action | none; denies with `input_unsupported` | not evaluated |

### 8.3 Policy version 1 user cells: complete Primary Owner reconciliation

The table below is the lossless normalization of every current CBD-72 §4 Primary Owner cell, including explicit denial and non-applicability. “Binding normalization” lists the operation-specific predicates and obligations in addition to §8.2 universal predicates; the complete cited CBD-72 rule remains incorporated and the implementation may not omit a condition merely because this column compresses its wording. A code that combines operations is forbidden unless their normalized predicate/obligation sets are identical.

| Cell | Action code(s) | Notation | Binding normalization of the complete CBD-72 rule |
| --- | --- | --- | --- |
| bootstrap | `space.create` | Allow on subject/profile | §4.3 only; subject/profile active; atomic space, sole Primary membership, and initial schedule; `create_primary_owner_membership` |
| 1 | `1.view_space` | Read | Field-set allowlist excludes all personal notification/delivery preferences; identity/role only when relevant to accessible content |
| 2a | `2a.create_plan`, `2a.edit_plan`, `2a.edit_target` | Allow | Draft/future target set; active/historical correction creates a retained version, never replacement; `preserve { plan_history }` |
| 2b | `2b.discard_draft_plan` | Allow | Never-active draft only; `confirm`; active/historical plans cannot be deleted and remain versioned |
| 3 | `3.create_bill`, `3.edit_bill`, `3.archive_bill`, `3.restore_bill`, `3.create_goal`, `3.edit_goal`, `3.archive_goal`, `3.restore_goal`, `3.discard_resource_draft` | Allow | Permanent discard only for never-confirmed, never-active, unreferenced bill/goal draft; confirmed resource archives/restores with readable history and no future occurrences/targets; destructive operations use §5.5 confirmation/dependency/preservation rules |
| 4 | `4.create_category`, `4.edit_category`, `4.archive_category`, `4.restore_category` | Allow | Confirmed categories never hard-delete; archive blocks new planning/assignment, preserves transactions/targets/reports/history, and requires every future reference resolved; restore allowed; removal copy must say archive; validation/totals disclose no restricted Viewer data |
| 5 | `5.create_schedule`, `5.edit_schedule`, `5.cancel_schedule`, `5.confirm_schedule` | Allow | Attribute/audit every mutation and recheck current authorization plus schedule state at submission/commit |
| 6a | `6a.confirm_income_suggestion`, `6a.reject_income_suggestion` | Allow | Mutates only reconciliation relationship/audited state; source records remain distinct |
| 6b | `6b.match_expected_income`, `6b.unmatch_expected_income` | Allow | Expected and actual records remain distinct |
| 6c | `6c.match_pending_posted`, `6c.unmatch_pending_posted` | Allow | Bank source records/fields remain immutable |
| 6d | `6d.split_pending_posted_match` | Allow | Each result retains amount and audit trail |
| 6e | `6e.dismiss_reconciliation_candidate` | Allow | Creates no match; independent source records preserved |
| 7 | `7.override_budget_date` | Allow | Cannot change period boundaries or retained provider authorization/posted dates; atomically recalculate totals/alerts; audit prior/replacement date and reason/provenance |
| 8 | `8.assign_transaction_category`, `8.change_transaction_category` | Allow | Recalculate totals/alerts and audit before/after; bank merchant, amount, account, dates, lifecycle, and other source fields immutable |
| 9 | `9.add_manual_transaction`, `9.edit_manual_transaction`, `9.remove_manual_transaction`, `9.restore_manual_transaction` | Allow | Manual label/provenance always retained; removal specifically requires target/consequence confirmation and resolved dependencies, hides record/children from ordinary surfaces, atomically recalculates, permits 30-day restore, then approved purge to minimal non-financial tombstone; `preserve`/`invalidate` |
| 10 | `10.edit_bank_source_field` | Deny | No role may edit bank-reported source fields; overlays/workflows only; deny without effect and audit |
| 11a | `11a.add_comment` | Allow | Supported readable target required; attributed interaction only; cannot mutate financial/reconciliation state |
| 11b | `11b.edit_own_comment` | Own | Current target read plus active original author; edited indicator; lifecycle audit; no cross-author edit |
| 11c | `11c.remove_own_comment` | Own | Current target read plus active original author; body leaves ordinary access/export; neutral reply tombstone and minimal lifecycle evidence where required |
| 11d | `11d.moderate_other_comment` | Deny | No budget-space role has cross-author moderation; platform safety/support is separate |
| 12 | `12.acknowledge_firm_alert` | Allow | Recipient-personal instance must belong to actor and remain authorized; mutate no shared event, other instance, or delivery attempt |
| 13 | `13.acknowledge_informational_alert` | Not applicable | Operation/state does not exist; source resolution, not recipient acknowledgement, closes instances and suppresses queued delivery |
| 14 | `14.view_accounts_balances_transactions` | Read | Mask/cross-space isolate; exclude credentials, tokens, authentication details, and private connection configuration |
| 15 | `15.view_planning_and_reports` | Read | Reports require explicit support and all readable inputs; hidden inputs cannot leak through totals/counts/labels/shape/zero substitution |
| 16 | `16.view_schedule_reconciliation_history` | Read | Reauthorize at open; actor identity/role only when needed for accessible content; security-only audit metadata excluded |
| 17 | `17.search_financial_records` | Allow | Authorize before indexing/querying; results/counts/suggestions/autocomplete/filters/empty states use only readable resources and reveal no hidden existence; exclude credentials/private connection/cross-space data |
| 18 | `18.view_derived_indicators` | Allow | Derive only from complete readable inputs; no hidden-input zeroing or leakage through comparisons, percentages, charts, forecasts, labels, or shape; version-bound cache |
| 19 | `19.generate_report` | Allow | Authorize before calculation/render/cache/delivery; every required input readable; bind cache to space, applicable profile/scope groups, and authorization version; grants no export right |
| 20a | `20a.generate_financial_export`, `20a.download_financial_export` | Allow | Versioned readable-data allowlist and categorical exclusions; fresh assurance, irreversible-download warning, generation/download recheck, recipient-bound encryption, short retention, rate limit, audit; `secure_package` |
| 20b | `20b.generate_admin_history_export`, `20b.download_admin_history_export` | Primary | §5.7 customer-history allowlist/redaction only; excludes security/fraud/support/telemetry/connection management; fresh assurance, warning, both-stage authorization, encryption bound to the recipient, one-day maximum non-renewable lifetime, rate limit, audit |
| 21 | `21.create_viewer_snapshot` | Allow | Intended Viewer’s current profile/inherited scope only; §5.8 allowlist/exclusions; recipient-bound encrypted non-transferable/non-renewable package expiring permanently ≤24 hours; generation/download recheck and invalidation on relevant authority change; Viewer cannot initiate/expand/redirect/reuse |
| 22 | `22.assign_viewer_scope`, `22.change_viewer_scope`, `22.remove_viewer_scope` | Allow | Exactly one profile and same-type groups, never item grants; atomic update and immediate invalidation of reads/search/reports/alerts/caches/open work/downloads/packages; safe notify and before/after audit |
| 23 | `23.change_partner_partial_visibility` | Deny | Partner cannot carry Viewer profile; narrower access requires separate role change to Viewer and then permission 22 |
| 24 | `24.invite_nonowner`, `24.revoke_nonowner`, `24.resend_invitation`, `24.replace_invitation`, `24.remove_nonowner` | Allow | Only Collaborator/Viewer/Partner; active revocation immediately invalidates access/derived artifacts; safe notify/audit; cannot appoint/remove owner or transfer Primary |
| 25 | `25.assign_nonowner_role`, `25.change_nonowner_role` | Allow | One role; Viewer starts without profile; leaving Viewer removes profile/groups; owner roles excluded; atomic transition, invalidation, safe notify, before/after audit |
| 26 | `26.invite_coowner`, `26.assign_coowner` | Allow | Recipient explicit acceptance; recheck eligibility/membership at acceptance; atomic failure if stale/ineligible; notify recipient/relevant owners; no Primary or connection-authority transfer |
| 27 | `27.remove_coowner` | Primary | Fresh assurance and target/consequence confirmation; recheck actor/target membership versions; atomic removal/invalidation; notify both; other Co-owners unchanged; no connection-authority transfer |
| 28 | `28.remove_primary_owner`, `28.demote_primary_owner` | Deny | Direct removal/demotion/deactivation/inactivation forbidden; only permission 29 may replace Primary atomically |
| 29 | `29.transfer_primary_ownership` | Primary | Eligible active member recipient; recipient authenticated acceptance of versioned disclosure; current Primary fresh assurance/confirmation; recheck both sessions, memberships/roles, ownership; atomic sole-Primary transition with former Primary→Co-owner; close prior Viewer/Partner state, retain consent/audit and personal preferences; invalidate/recalculate/notify/audit; no connection transfer |
| 30 | `30.update_shared_setting` | Allow | Field-set limited to name/currency/locale/time zone/budget conventions/shared presentation/report defaults; excludes personal notifications/alerts, membership/Viewer profiles, ownership, connections, credentials/security, and separately governed financial resources |
| 31 | `31.authorize_connection` | Allow (self-consent) | Actor entitled to account and completes institution auth/consent; becomes sole authorizer of that connection; joint accounts may have multiple independently authorized connections but a connection never has multiple authorizers; explain resulting space visibility; grants no ownership/membership/admin; protect secrets; safe linkage audit |
| 32 | `32.refresh_connection`, `32.repair_connection`, `32.reauthorize_connection`, `32.disconnect_connection` | Authorizer | Actor equals sole connection authorizer; disconnect confirmation, stop sync/invalidate provider authorization as supported, preserve imported history/provenance, remove private-config access, never transfer authority |
| 33 | `33.view_connection_management_details` | Authorizer | Only safe institution/account selection, sync/consent/repair/error/disconnect fields; raw credentials, tokens, secrets, and unnecessary provider payloads categorically inaccessible and never exported/audited |
| 34 | `34.request_space_deletion`, `34.cancel_space_deletion` | Primary | Request: already archived, fresh assurance, space/permanent-destruction confirmation, commit authority/lifecycle checks, and 30-day restore window before irreversible minimal-tombstone purge. Cancellation: `deletion_pending`, current Primary authority and version, atomic return to archived-without-pending-deletion. Both notify affected members and audit; export remedy stays available throughout the window |
| 35 | `35.archive_space`, `35.restore_space` | Primary | Fresh assurance and space/every-member consequence confirmation; atomic authority/lifecycle check; notify every active member; archive stops all active work/sync/alerts but preserves all data and indefinite role-scoped read/export; no countdown or owner removal; restore is fresh/confirmed Primary-only and does not restart connections. The §6.3 inactive-owner archival path is separate and grants no action through this Primary cell |

Every `co_owner`, `collaborator`, `viewer`, and `accountability_partner` cell is absent from `p1` and therefore denies until a later approved immutable version maps that role. That is an implementation sequencing rule, not a reinterpretation of the approved CBD-72 values. The explicit Primary `Deny`/`Not applicable` cells above remain represented so AC04 and generated fixtures cannot mistake them for unsupported actions.

### 8.4 Policy version 1 service cell

`SERVICE_CELLS` contains exactly one allow row:

| Service action | Purpose | Effect | Required current server facts | Lifecycle and version predicates | Obligations |
| --- | --- | --- | --- | --- | --- |
| `service.SA-92-002.generate_period_state` | `SA-92-002` schedule and period generation | `mutate` deterministic system-owned period state only | Authenticated workload identity authorized for this queue/operation; live space; current schedule/configuration; current rule/reference data; verified target belongs to the space; envelope source is current and bound to the same space/action | `sourceState=current`; space `live` (deny archived, deletion-pending, purged); exact equality for the complete `ServiceCapturedVersions` set at commit; idempotency key bound to source/action/target | `audit`, `recheck_at_commit`, preserve source provenance; §6 runtime mutation seam |

The cell grants no customer read/disclosure, user-delegated mutation, connection management, or cross-purpose effect. Every other operation under `SA-92-002`, every other `SA-92-*` purpose, a user action presented in service mode, and a service action presented in user mode denies. `USER_CELLS` and `SERVICE_CELLS` are serialized together as `p1` and evaluated by the one `decide` path.

Policy version 1 is `p1`. Its candidate digest is computed by the implementation packet; it becomes a released immutable digest only through §6 after the release-history row cites both approvals required by `CBD236-POLICY-APPROVAL-001`.

## 9. Negative cases the acceptance criteria name

**`PC-236-018` (Binding). Each row below is a required future fixture family. The implementation must prove that every row denies, produces no customer-data effect, and writes only the §11 audit allowlist; this proposal is not that evidence.**

### 9.1 CBD-236-AC02: facts that alone never produce allow

| ID | The input has only this | Missing or failing predicate | Reason class |
| --- | --- | --- | --- |
| `NC-236-01` | A live session (authentication) | No membership in the space; or `space.create` with an inactive profile | `membership_not_active`; `subject_not_active` |
| `NC-236-02` | Profile ownership of a linked account | Link is not membership; `AU-82-06`, `LK-82-04` | `membership_not_active` |
| `NC-236-03` | An email or phone matching an invitation destination | Channel proof is not acceptance (CBD-73 §6 rule 1); no membership row | `membership_not_active` |
| `NC-236-04` | Possession of an invitation locator or code | Invitation state is not Accepted; code possession confers nothing (`IC-73-001`) | `membership_not_active` |
| `NC-236-05` | A valid resource identifier from the acting space | Identifier is a locator; role cell still evaluated | whichever cell predicate fails; never allow on the identifier alone |
| `NC-236-06` | A client-asserted role, membership id, or assurance in a header or body | Provenance is `request` on a fact section | `input_invalid` |

### 9.2 CBD-236-AC03: inputs that deny without effect

| ID | Condition | Where it appears in the input | Reason class |
| --- | --- | --- | --- |
| `NC-236-07` | Missing | Any required section or field absent | `input_invalid` |
| `NC-236-08` | Malformed | Wrong type, unknown enum member, provenance mismatch, schema version mismatch | `input_invalid` |
| `NC-236-09` | Unknown | Action, resource type, purpose, or field set not in the policy version | `input_unsupported` |
| `NC-236-10` | Inactive | `subjectState`, `profileState`, or `membership.status` not active; `space.lifecycle` not admitting the effect | `subject_not_active`; `membership_not_active`; `lifecycle_blocked` |
| `NC-236-11` | Revoked | `membership.status` is `revoked`; session revoked at resolution | `membership_not_active`; `not_authenticated` |
| `NC-236-12` | Expired | `membership.status` is `expired`; `assurance.expiresAt` in the past | `membership_not_active`; `assurance_insufficient` |
| `NC-236-13` | Stale | Any user or service captured value is unequal at commit; a consent is `superseded` | `stale_version`; `consent_not_current` |
| `NC-236-14` | Cross-space | `resource.owningSpaceId` differs from `space.spaceId` | `scope_mismatch` |
| `NC-236-15` | Unsupported | Policy version not in registry; service purpose not listed; authority mode wrong for the cell | `policy_version_unsupported`; `service_purpose_not_listed`; `authority_mode_unsupported` |

The implementation must prove “no customer-data effect”: every negative fixture must assert transaction rollback, no row-version change, no derived recomputation, no notification side effect, and the uniform external class with no assurance/step-up hint (`VT-94-018`, `VT-94-020`, `VT-94-033`).

### 9.3 CBD-236-AC07: named negative families for the fixture catalog

| Family | Fixture rule | CBD-72 scenario and CBD-94 test |
| --- | --- | --- |
| Wrong role | Every user action evaluated for each of the four unmapped roles with an otherwise valid input | `ROLE-01`, `ROLE-04`; `VT-94-018` |
| Wrong space | Every space-bound user/service action with the target's owning space replaced by another live space | `XSP-01`, `XSP-02`; `VT-94-019` |
| Wrong target | Every action with the wrong resource type or failed recipient/authorizer/author/readability binding | `XSP-02`; `VT-94-019` |
| Inactive lifecycle | Every mutation against each disallowed space/resource lifecycle, while separately testing the explicit archival read/export exceptions | `LIFE-03`, `LIFE-04`; `VT-94-020` |
| Stale version or bootstrap collision | Every mutation with each member of its complete input-variant-specific captured set changed between precheck and commit, one at a time; `space.create` also with each required absence replaced by a colliding row | `AUTH-01`, `AUTH-02`, `OWN-04`; `VT-94-021`, `VT-94-030` |
| Assurance obligation | Every protected action with session-only, expired, wrong-action, and wrong-space assurance; all four external responses match nonexistent/wrong-space cases and carry no step-up hint | `LIFE-04`; `VT-94-020`; CBD-104 `ID-104-007` |
| Service purpose/effect | `SA-92-002` with wrong workload, purpose, effect, source, lifecycle, target, or each unequal service version; every other purpose denied | `VT-94-023`; `SR-94-015`, `SR-94-032` |
| Transport authentication/replay | Alter each signed field and signature; wrong algorithm/issuer/audience; future, expired, or overlong lifetime; non-canonical bytes; claimed/derived effect mismatch; two concurrent consumers of one identifier; receiver restart; rollback then retry; and lost acknowledgement after commit | `SR-94-032`–`SR-94-034`; `VT-94-054`–`VT-94-068` |

## 10. Deterministic fixture catalog

**`PC-236-019` (Binding). Fixtures are generated from every `ACTION_DEFINITIONS` entry and both cell tables in `POLICY_SET`, never written by hand, and the generator is part of the contracts package.** For every allow cell/action the generator emits a positive fixture with the complete valid discriminated input and a negative per predicate/obligation binding; for explicit deny/not-applicable user cells it emits the required deny. The §9.3 families add cross-cutting negatives. Fixture identifiers include policy version, authority mode, action, actor role or service purpose, and variant; the catalog freezes with its version.

The property tests the implementation packet must supply, stated so that review can check them rather than the count:

1. **Single-fault denial.** For every positive fixture, derive the required-field set from its discriminated ordinary-user, bootstrap-user, or service input variant, action/cell, assurance variant, and evaluation phase. Removing, corrupting, or restamping any field or its field-level provenance entry in that set yields `deny`. Fields forbidden for that variant also deny when injected. Optional/conditional fields outside that set are not falsely required—for example fresh bindings only under `assurance.level=fresh`, `viewerProfile` only for Viewer cells, `capturedAtPrecheck` only at commit, bootstrap fields only for `space.create`, and service fields only in service mode.
2. **Deny is inert.** A deny decision carries no `cellRef`, no obligation other than `audit`, and no `capturedVersions`.
3. **Allow is complete.** An allow decision's `cellRef` names a cell whose every predicate holds on the input.
4. **Determinism.** The same canonical input yields byte-identical decisions, including `inputDigest`, across runs and across the API and worker adapters.
5. **Mapped and unmapped outcomes.** The bootstrap cell yields its exact allow with bootstrap `cellRef`, capture set, and transactional absence requirements; every §8.3 numbered Primary cell yields its exact approved allow/deny/not-applicable outcome; every other role denies under `p1`; the one §8.4 service cell may allow; and every other service purpose/effect denies.
6. **Digest immutability.** Each registry serialization hashes to its independently pinned release-history digest, each application tuple matches both, and the append-only guard is tested by changing an old cell, changing its registry digest, changing its history row, and observing failure in every case.
7. **Coverage.** Every protected route and job in the applications maps to exactly one `ActionCode`, and every `ActionCode` in `p1` is reached by at least one fixture (`VT-94-035`).
8. **Transport authenticity and one-use atomicity.** The canonical signed bytes are stable across producer and receiver; every transport-authentication negative above denies before data release; exactly one of two concurrent valid consumers commits; consumption survives receiver restart; rollback leaves the envelope retryable; and post-commit redelivery observes both the consumption row and material-effect record without duplicating the effect.

The future generated catalog must satisfy AC07 by iterating every §8.3 Primary cell/action—including explicit deny/not-applicable outcomes—and the §8.4 service cell plus cross-cutting negatives. This document defines that construction but does not claim the catalog or its evidence exists.

## 11. Policy logging and audit allowlist

**`PC-236-020` (Binding). A policy decision produces two kinds of record, and neither may carry anything outside its allowlist.**

The **security audit event** (`PolicyAuditEvent`, `SA-92-007`, `SR-94-063`) is a restricted security-evidence taxonomy, never a customer-history schema. Its exact common payload allowlist is: `eventId`, `occurredAt`, `decisionId`, `outcome`, `reasonClass` (internal), `policyVersion`, `policyDigest`, `inputSchemaVersion`, `actionCode`, `effectClass`, `authorityMode`, `capturedVersions`, `cellRef` on allow, `correlationId`, `sequence`, `previousEventDigest`, `eventDigest`, `audienceClass`, `sensitivityClass`, `retentionClass`, `deletionPolicyVersion`, and obligation names. Ordinary-user events may additionally carry opaque `accountSubjectId`, opaque `membershipId`, `role`, opaque acting `spaceId`, `resourceType`, and an opaque target reference only when the acting scope is authorized to retain it. Bootstrap-user events may additionally carry opaque `accountSubjectId` and a non-reversible bootstrap-attempt reference, but no membership, role, target, or candidate identifier. Service events may additionally carry `servicePurpose`, opaque acting `spaceId`, `resourceType`, and an authorized opaque target reference, but no user-session or membership facts. `sequence` is monotonic within the correlation/event stream; the two digest fields bind canonical adjacent events and are verified at write/read. The separately governed retention class and deletion-policy version determine disposition; neither is invented here. The mutation's own event carries any separately allowlisted safe semantic delta.

`audienceClass` is fixed to `restricted_security_evidence`; `sensitivityClass` is fixed to `authorization_metadata`. Access requires a least-privilege security/audit service identity and purpose, is itself audited, and is never granted merely by budget-space membership or ownership. Until an approved retention/deletion taxonomy supplies a valid `retentionClass` and `deletionPolicyVersion`, and `OQ-236-001` approves the internal reason vocabulary, the audit adapter fails closed and the implementation cannot ship. This binds the event shape to still-required governance sources rather than silently choosing them.

The **customer administrative-history event/view is a different dedicated safe schema** governed by CBD-72 §5.7 and current authorization. It may never be populated by projecting raw `PolicyAuditEvent` records. Internal reason classes, security-only versions/digests, integrity-chain fields, service/workload facts, cross-space target identifiers, and denied hidden-target references are categorically excluded (`SR-94-065`).

The **reliability telemetry line** is the existing `ReliabilityEvent` with `operation: "request"` or `"job"` and `outcome`, and nothing else: no reason class, no identifiers, no version (`AN-92-003`). Decision counts by reason class are an aggregate `healthCount` if operations need them, never a per-subject series.

The allowlist is enforced the way `reliabilityEvent()` enforces it: the type has no field for anything else, free-text fields are closed unions, and a runtime filter drops any key not on the list at the boundary where a logger receives a value it did not construct.

Prohibited in all three boundaries, restated so a reviewer can check the negative: financial content; resource field values; a hidden-resource signal; a cross-space target identifier in customer history; the session identifier/cookie/`sessionRef` or `delegationRef`; assurance evidence or an IdP token; provider secret/cursor/configuration; email, phone, or display name; free-text errors/stacks; and identifier-bearing request paths. A cross-space denial is retained only as restricted security evidence for the acting scope and uses a non-reversible attempt reference when the acting scope is not authorized to retain the target id; it is never projected to either space's customer history (`AUD-02`, `VT-94-033`).

## 12. Affected interfaces, migration, and compatibility

| Interface | What changes | Compatibility rule |
| --- | --- | --- |
| `packages/contracts` exports | New subpath `./authorization` | Additive; the existing `config`, `health`, `telemetry` subpaths are untouched |
| `TransportedPolicyDecision` and `AuthorizationTransportConsumption` | Canonically serialized Ed25519-signed service envelope around an exact `PolicyDecision`, plus same-transaction replay consumption | Enabled only with a generated local key pair and shared transactional replay relation; all non-local verification fails closed pending hosted custody |
| `apps/api` route registration | Every protected route declares authorization metadata; a build check fails on an undeclared route | Existing public routes (`health`, `docs`, `openapi.json`) are declared public explicitly, not by omission |
| CBD-246 data-access seam | Tenant-scoped statements take `AuthorizedContext`; mutation helpers take `AuthorizedEffect` | CBD-246 must not decide the tenant parameter from any other source; this is handoff `HO-236-02` |
| CBD-191 session | The session store must expose `sessionVersion` and an opaque `sessionRef` | The adapter reads; it never writes the session |
| CBD-190 identity contract | `assurance` section shape: `level`, `boundAction`, `boundSpaceId`, `expiresAt` | The local Cognito-shaped adapter must produce the same shape as the provider path; `OQ-236-005` |
| CBD-232 and CBD-233 | `space.create` is the sole action this record can authorize | Profile proposal/preview routes remain blocked until an approved CBD-22 source defines their cells and predicates in a new version |
| CBD-266 middleware | Two fail-closed hooks in one chain | Ordering fixed by `OQ-236-003` before either ships |
| Worker envelope (`RF-92-003`) | Carries operation/delegation/purpose locators and claimed versions/effect; `PolicyInput` receives only verified/reloaded facts under §4.2 | This document consumes the envelope and fixes decision-transport verification/consumption; it does not design the per-queue schema, retries, DLQ, inspection, or purge contract |

Migration is forward-only. There is no existing authorization path to migrate from: `apps/api` today exposes health and OpenAPI only, so the first protected route is the first consumer. Adding a role's cells is a new policy version and a minor deployment; changing a shipped cell's predicate is a new policy version and a `PC-236-011` event that Security reviews; changing the `PolicyInput` schema is a `schemaVersion` bump that both applications must pin in an exact supported tuple before deployment. Rollback is a redeploy of the prior application build whose exact version/digest/schema tuple still matches the immutable registry and release-history row.

## 13. Alternatives and why they lost

**Per-handler checks — rejected.** Each handler would call role and ownership helpers as it saw fit. This is the "coarse role check" `RK-94-003` rates Critical and the "alternate authorization paths" CBD-24 excludes. It also has no call-site inventory except by reading every handler.

**An external policy engine (OPA, Cedar, or a hosted equivalent) — rejected for the prototype.** It would add a runtime or provider under `PROVIDERS-LOCAL-001`, which authorizes no provider account or spend, and a policy language whose evaluation is not a TypeScript function the fixtures can run in `node --test`. The three `POLICY_SET` tables are closed and source-approved action by action and cell by cell; a general policy language buys expressiveness they do not need. If a later phase wants one, `decide` is the seam and an engine would evaluate the same versioned set.

**Database row-level security as the mechanism — rejected as the mechanism, retained as defense in depth.** RLS keys on the connection role and a session variable; it cannot see assurance, consent disclosure version, purpose, or obligations, and it cannot express `Own`, `Authorizer`, or a protected-action window. CBD-246's role-separated connections stand behind the policy as a second fence, not instead of it.

**Placing the core in `packages/budget-domain` — rejected.** §3 item 3.

**Placing the core in `apps/api` only — rejected.** §3 item 1; the worker would need a copy.

**A signed decision object across process boundaries — local transport selected, hosted custody deferred.** `RF-92-001` asks for a typed/signed decision contract. Inside one process the §6 runtime mutation seam—not the TypeScript brand alone—validates provenance and binding. Under `CBD236-SIGNING-KEY-001`, a developer environment generates its own local-only signing key, never shares it, never treats it as real custody, and regenerates it per environment so the transported-decision path is buildable and testable now. A receiver verifies the canonical signature, exact policy tuple, input digest, action/policy-derived-effect/target binding, audience, issuer, issue/expiry times, and atomically consumes a one-use decision identifier under §5.1 before trusting the object; failed, missing, replayed, or uncertain validation denies. No transported decision is trusted in any non-local environment until hosting decides real key custody under `RECOVERY-DEFER-001`. The worker may still independently re-evaluate current facts where its operation does not require transport.

## 14. Questions and recorded decisions

Each unresolved question names the authority that can answer it. `OQ-236-007` and `OQ-236-008` are retained for traceability but are closed by the cited Executive decisions; the implementation packet applies those rulings and may not reinterpret them.

| ID | Question | Disposition or reason pending | Authority or source |
| --- | --- | --- | --- |
| `OQ-236-001` | Is the §5.2 internal reason-class vocabulary accepted into the `PR-94-004` closed allowlist as the authorization class family? | `PR-94-004` is Product-owned and requires Product Owner approval of each closed allowlist | Product Owner; Security review of the internal classes |
| `OQ-236-002` | Which HTTP status and body carry the single external denial class on each surface, and are not-found and denied the same status? | `PR-94-003` response-equivalence is Security-owned and open | Security |
| `OQ-236-003` | Does the CBD-266 surface-record hook run before or after the policy hook, and which of the two writes the audit event for a request both would deny? | Two fail-closed hooks in one chain is a cross-package ordering decision; choosing silently would be selecting a side | Security, with CBD-266's author |
| `OQ-236-004` | What is the `PR-94-005` invalidation SLO value for a stale authorization version reaching a cache, job, or package? | `RF-92-001` names an invalidation objective; `PR-94-005` is Data Lifecycle-owned and open | Security and Data Lifecycle |
| `OQ-236-005` | Does the CBD-190 local adapter emit `assurance.level: fresh` with action/space binding for protected actions, or are those routes unavailable until provider activation? | The CBD-190 contract is a sibling packet in flight; `PROTOTYPE-SLICE-001` does not exercise archival/deletion | Architecture (CBD-190) and Security |
| `OQ-236-006` | What approved CBD-22 source and predicates authorize profile create/read/preferences, and is `space.create` confirmed as the sole membership-free cell? | CBD-82 expressly excludes the profile/preferences API and `AU-82-01` governs connection authority only; therefore `p1` denies those profile actions | Product Owner and Security |
| `OQ-236-007` — closed | When a decision must cross a process boundary, what key signs it and who holds that key? | `CBD236-SIGNING-KEY-001`: generate a local-only per-developer-environment key now so the transport path can be built and tested; the key is never shared or treated as real custody. No transported decision is trusted outside local until hosting decides real custody under `RECOVERY-DEFER-001` | Executive decision recorded September 12, 2026 |
| `OQ-236-008` — closed | Who approves a new policy version? | `CBD236-POLICY-APPROVAL-001`: a version is released only after Product Owner and Security sign-off, both cited in its append-only release-history row | Executive decision recorded September 12, 2026 |
| `OQ-236-009` | Is `SA-92-002` the only service purpose the prototype's worker exercises, and may `SA-92-003` recalculation stay denied until the manual-transaction increment? | The milestone names the schedule engine but the recalculation path is the next increment | Product Owner |
| `OQ-236-010` | Should `RF-92-001` be narrowed to the signed-contract and SLO items this record leaves open, or held open in full until implementation evidence exists? | Closing or narrowing an `RF-92-*` decision is a CBD-92 change | Product Owner; see §15 |

## 15. What this closes, and what it does not

`RF-92-001` names five things: a selected policy evaluation point, a typed and signed decision contract, a purpose/effect enforcement mechanism, a version propagation rule, and an invalidation SLO.

This record selects the evaluation point (`PC-236-001`, `PC-236-006`), types the decision contract (`PC-236-007`, `PC-236-008`), gives the purpose/effect mechanism for both authority modes (§4, §7.2, §8.4), states the version propagation rule (`PC-236-011`–`PC-236-015`), and applies the local transport and policy-release rulings that close `OQ-236-007` and `OQ-236-008`. It does not provide hosted signing-key custody, set the invalidation SLO (`OQ-236-004`), or supply the per-queue worker contract (`RF-92-003`). No transported decision is trusted outside local until hosting records custody. It is design, not evidence: `RG-94-003` closes only when the typed contract and cross-scope/stale/race/noninterference tests pass.

On the CBD-82 §13 precedent, `RF-92-001` should therefore be narrowed rather than closed when this record is approved: the local signed-transport path is now decided, while hosted key custody and an invalidation SLO still wait (`OQ-236-010`).

`FU-95-006` asked for an architecture decision record, a complete policy schema, a call-site inventory, deterministic fixtures, cross-service negative tests, and commit-time race tests. This record supplies the first two and the mechanism for the third (§7.1 step 3); the last three are code and follow.

## 16. Handoff to the implementation packet

| ID | Consumer | May rely on | Must not decide |
| --- | --- | --- | --- |
| `HO-236-01` | CBD-236 implementation packet | §3 layout; §4 schema; §5 output; §6 versioning; §8.3 user cells and §8.4 service cell; §9–§11 fixture/log rules; local transport and release approval rulings in §13–§14 | Any predicate, cell, obligation, or reason class not stated here; any answer to an unresolved `OQ-236-*`; non-local trust before hosted key custody; any release-history row without both required sign-offs |
| `HO-236-02` | CBD-246 data-access seam | That `AuthorizedContext` is the sole source of the tenant parameter and `AuthorizedEffect` the sole precondition of a mutation helper | A tenant parameter from a request, a default, or a connection role |
| `HO-236-03` | CBD-191 sessions | The `subject` section fields the adapter reads | Any authorization beyond carrying subject and session state (its own out-of-scope statement) |
| `HO-236-04` | CBD-190 identity contract | The `assurance` section shape | Whether an assurance authorizes anything by itself; it does not (`SR-94-001`) |
| `HO-236-05` | CBD-232, CBD-233, CBD-23 | `space.create` and its atomic sole-Primary obligation | Profile create/read/preference authority until `OQ-236-006` is answered by an approved source; any other creation-time authority |
| `HO-236-06` | CBD-266 | That the policy chain expects a surface decision with a uniform denial | The hook order, until `OQ-236-003` is answered |
| `HO-236-07` | Later role and matrix work under CBD-72 | That adding a role is a new policy version populated from an approved matrix row | Any cell value; those are CBD-72's |

## 17. Acceptance-criteria traceability

Each row names the section that delivers the criterion at the design level and what the implementation packet must add before the criterion can be called met. This document alone meets none of them; it is the contract they are met against.

| Criterion | Delivered here | Implementation evidence still required |
| --- | --- | --- |
| CBD-236-AC01 — one documented entry point; complete versioned input; explicit allow/deny, safe reason class, policy version, obligations | §2 `PC-236-001`; §4 four adapter-path input variants; §5; §8.3 bootstrap cell; §8.4 single service path | `decide()` export; exact-shape tests including bootstrap allow/deny; differential proof that all denials expose no internal class or step-up hint |
| CBD-236-AC02 — authentication, profile ownership, email/phone match, invitation possession, resource identifier, or client-asserted role alone never allows | §4.2; §8.1 profile actions explicitly unsupported; §9.1 | Six fixture families, each proving deny and no effect; approved CBD-22 source still required before any profile allow |
| CBD-236-AC03 — missing, malformed, unknown, inactive, revoked, expired, stale, cross-space, unsupported input denies with no customer-data effect | §2 `PC-236-003`; §6 complete equality/reload and bootstrap-absence rules; §9.2 | Nine fixture families with rollback/version/derived/notification/response assertions, including bootstrap collision and service-source races |
| CBD-236-AC04 — current CBD-4 Primary Owner actions map exactly to approved CBD-72 permissions; unsupported roles and actions deny | §2 `PC-236-005`; §8.3 complete Primary reconciliation; §8.4 separate service cell | `USER_CELLS` reviewed cell/action-by-cell/action against CBD-72 §4; property 5; no claim that prototype exercises all cells |
| CBD-236-AC05 — actor, membership, role, consent, scope, lifecycle, versions, assurance, and service authority are server-obtained or verified, never trusted from payloads | §4.1 fields; §4.2 exhaustive per-adapter producer matrix, internal effect derivation, and four discriminated variants; §6.1; §7 API/worker reloads; §8.4 | Assembler/workload tests for every matrix cell, envelope-locator-only tests, claimed/derived-effect mismatch tests, and discriminated property 1 |
| CBD-236-AC06 — policy versions immutable; decisions identify the version; deployment rejects a compatibility mismatch | §6 independent append-only history, exact application tuples, and required Product/Security approval references | Registry/history hash and approval-reference tests; deliberate old-cell/registry/history mutations fail; startup mismatch tests in both apps |
| CBD-236-AC07 — fixtures cover every applicable matrix cell plus wrong role, wrong space, wrong target, inactive lifecycle, stale version, assurance obligation | §9.3; §10 complete bootstrap/user/service iteration, discriminated single-fault rule, and transport/replay negatives | Generated `p1` catalog and eight properties, including bootstrap absence races, every enumerated bill/goal code, canonical-signature negatives, and concurrent/restart replay tests; this proposal does not claim they exist |
| CBD-236-AC08 — policy logs use a safe allowlist and reveal no financial content, hidden resource, credential, provider secret, or reusable session material | §11 restricted taxonomy, audience, retention/deletion binding, ordering/integrity, separate customer schema | Types/filters; access and integrity tests; negative per prohibited item; approved retention taxonomy required before ship |

## 18. Revision history

| Version | Date | Author | Change | Approval |
| --- | --- | --- | --- | --- |
| 0.4 (approval) | September 13, 2026 | Manager, in the merge lane | Product Owner approval recorded (PO-CONTRACT-APPROVALS-001). Status Proposed → Approved at the same version; no decision, identifier or contract text changed. | Approved. |
| 0.1 | September 12, 2026 | Claude with Alexander Wohlford as Product Owner | Initial complete proposal under `CBD236-ARCH-001`: entry point and placement (`PC-236-001`–`PC-236-006`), policy input schema with provenance and the space-creation exception (`PC-236-007`), decision output with closed reason classes and obligations (`PC-236-008`–`PC-236-010`), immutable versioning, startup compatibility guard, and the commit-time re-evaluation rule with the `AuthorizedEffect` token (`PC-236-011`–`PC-236-015`), the fail-closed API and worker chains (`PC-236-016`), the matrix adapter and policy version 1 cells (`PC-236-017`), the negative-case families (`PC-236-018`), the generated fixture catalog and property tests (`PC-236-019`), the audit and telemetry allowlists (`PC-236-020`), affected interfaces, rejected alternatives, ten open questions, and the `RF-92-001` disposition. No code. | Proposed; Security and Product review required |
| 0.2 | September 12, 2026 | Architecture correction under `CBD236-ARCH-002` | Reviewer: F1 → one `POLICY_SET` and exact `SA-92-002` cell (lines 257, 331–341); F2 → profile actions removed from allow and held unsupported (line 261); F3 → independently pinned append-only release history and exact application tuples (lines 205–215); F4 → deny has audit only and no step-up hint (lines 153, 175, 180); F5 → single-fault tests use discriminated variant/phase required fields (line 392); F6 → full AC04 scope separated from prototype evidence and evidence claims made future-tense (lines 38, 52, 345, 400). Security: SEC-236-001 → uniform no-hint denial/differential gate (lines 175, 180, 383); SEC-236-002 → complete mode-specific equality sets and reloads (lines 213–224); SEC-236-003/004 → all 44 Primary cells normalized with operation-specific codes and full binding restrictions (lines 277–329); SEC-236-005 → restricted audit taxonomy with audience, retention/deletion binding, order/integrity, and separate customer schema (lines 406–416); SEC-236-006 → runtime seam, inventories, private exports, worker binding, and least-privilege identities (lines 224, 249); SEC-236-007 → decision range corrected to `001`–`020` (line 7). `OQ-236-007/008` remain Executive-open with blocking consequences stated (lines 459–460). No implementation evidence claimed. | Proposed; repeat independent Review, Product, and Security review required |
| 0.3 | September 12, 2026 | Architecture correction under `CBD236-ARCH-003` | R1 → explicit bootstrap input variant, absence facts, bootstrap `cellRef`, capture set, commit reload/absence checks, fixture rule, and audit variant (lines 85, 100–101, 134, 140, 154–161, 223–232, 289, 405, 415). R2 → exact field-level provenance map and source validation for mixed-source sections (lines 85, 91–134). R3 → deterministic split between supported-action/unmapped-role and reserved-or-unknown action reasons (lines 170–176, 267, 279–284). R4 → all permission-3 bill and goal codes enumerated (line 296). `CBD236-SIGNING-KEY-001` → local Ed25519 envelope and fail-closed non-local boundary (lines 161, 257, 432, 455, 469, 478). `CBD236-POLICY-APPROVAL-001` → Product Owner and Security references required in each release row (lines 74, 211–215, 350, 470, 507). Secret-scanner false positives → credential-like prose rewritten in plain words and the long audit example split into explicit input variants (lines 267, 321, 415); the direct generic rule passes, while the Python wrapper's local mode is blocked by scanner installation/integrity verification in this worktree. No implementation evidence claimed. | Proposed; repeat independent Review, Product, and Security review required |
| 0.4 | September 12, 2026 | Architecture correction under `CBD236-ARCH-004` | R5 / `SEC-236-008` → four concrete API/worker variants and exhaustive leaf-producer matrix (lines 85–166), worker reload path (line 293), and `ACTION_DEFINITIONS`-owned effect derivation inside the sole `decide` entry point (lines 164, 247, 301, 312, 544). R6 / `SEC-236-009` → RFC 8785/domain-separated signed bytes, receiver-owned shared replay relation, retention, same-transaction one-use consumption, concurrency/restart/rollback/uncertain-result semantics, and separate material-effect idempotency (lines 192–196, 268, 293, 430, 445, 470, 493, 546). `SEC-236-010` → CBD-82 pin advanced to approved v0.2.1 with the prior condition satisfied (line 13). Manifest entry advanced to exact v0.4 review/publication conditions. No implementation evidence claimed. | Proposed; repeat independent Review, Product, and Security review required |
