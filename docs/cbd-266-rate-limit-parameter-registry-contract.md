# CBD-266 - Rate-limit parameter and surface-registry contract

| Field | Value |
| --- | --- |
| Status | **Proposed v0.1 - Product Owner approval of every parameter record, implementation, Security/Reliability review, and negative-test evidence pending** |
| Document version | 0.1 |
| Jira subtask | [CBD-266](https://cobudget.atlassian.net/browse/CBD-266) |
| Parent | [CBD-123](https://cobudget.atlassian.net/browse/CBD-123) |
| Repository baseline | `ce49e3dd6f795073132d82f4c077b9365045a0e7` |
| Related contract | CBD-236 proposed v0.4, especially section 7 and `OQ-236-003` |
| Last updated | September 13, 2026 |

## 1. Purpose, authority, and delivery boundary

This document specifies the checked-in parameter-record schema, closed surface
catalog, route/job registration contract, fail-closed enforcement sequence,
anti-lockout invariants, build guard, and required negative fixtures for
CBD-266. It is the architecture contract for later implementation in
`packages/contracts`, `apps/api`, and `apps/worker`; this document ships no code
and is not runtime or test evidence.

The controlling rules are CBD-92 `RL-92-001`, `RL-92-002`, and `RL-92-007`;
CBD-92 section 3.3 `EP-92-001` through `EP-92-015`; CBD-103 `TD-103-013` and
`OI-103-003`; and CBD-94 `SR-94-037`, `ME-94-010`, and `PR-94-002`. CBD-236
proposed v0.4 supplies the adjacent authorization boundary. Its policy proposal
is not ratified by this document; section 8 records the compatible ordering
decision requested by `OQ-236-003`.

`RL-92-007`, `OI-103-003`, and `PR-94-002` leave concrete values to each
surface's own story and accountable approval. Consequently:

- this contract approves no parameter record and supplies no guessed ceiling;
- a structurally valid record whose approval is `pending`, `rejected`, expired,
  revoked, for another digest, or otherwise unverifiable is not approved; and
- a bounded surface without one current approved record cannot execute.

The approved CBD-236 public exceptions for health and OpenAPI discovery are
registered explicitly in the same inventory. They are not silently treated as
`RL-92-001` bounded surfaces and do not create a general public exemption.

## 2. Binding design decisions

| ID | Decision |
| --- | --- |
| `RC-266-001` | There is one canonical parameter-record registry. Each approved record is immutable and binds exactly one `surface_id` to its complete parameter set and canonical digest. |
| `RC-266-002` | There is one executable-surface inventory assembled from API route and worker job declarations. Every discovered route and job must have exactly one registration. Omission is both a build failure and a runtime denial. |
| `RC-266-003` | Every non-public registration references one closed catalog surface and one exact parameter record. A catalog entry is classification, not permission to execute. |
| `RC-266-004` | Parameter validation has structural, semantic, approval, and referential phases. No phase defaults a missing or invalid value. Every failure is closed. |
| `RC-266-005` | A counter decision is atomic for the complete key and record version. Store timeout, inconsistency, unknown outcome, or unsupported record version denies the effect; there is no in-memory fallback. |
| `RC-266-006` | API and worker adapters use the same registry types, validator, decision vocabulary, and canonical digest rules. Framework metadata is an adapter input, never a second policy registry. |
| `RC-266-007` | Rate denial changes no protected state. It emits no remaining-quota hint and uses the response/timing class later approved under `PR-94-003`. |
| `RC-266-008` | One enforcement-outcome coordinator owns a denied invocation's audit append. It records the earliest decisive gate and whether later gates were not evaluated; hooks do not emit competing denial records. |
| `RC-266-009` | Public exceptions are exact registrations for `GET /health`, `GET /docs`, and `GET /openapi.json`. Adding another public route requires explicit authority; omission never implies exemption. |
| `RC-266-010` | Concrete parameter values and Product Owner approval remain open per surface. This proposal cannot transition any record to `approved`. |

## 3. Canonical identities and closed vocabularies

Identifiers are opaque stable ASCII strings. Renaming a method, path, job type,
or surface never retargets an existing registration: it adds a new identity and
retires the old one. Canonical JSON uses UTF-8, lexicographically ordered object
keys, preserved array order, JSON integers, and no insignificant whitespace.

| Name | Closed values or format |
| --- | --- |
| `SurfaceId` | `surf-266-` followed by lowercase letters, digits, and hyphens |
| `ParameterRecordId` | `rlp-266-` followed by lowercase letters, digits, and hyphens, then `-v` and a positive integer |
| `RegistrationId` | `api:` + uppercase method + `:` + normalized path, or `job:` + consumer + `:` + job type + `:` + schema version |
| `executor_kind` | `api_route`, `worker_job` |
| `control_kind` | `bounded`, `public_exception` |
| `approval.status` | `pending`, `approved`, `rejected`, `revoked`, `expired` |
| `store.failure_mode` | exactly `deny` |
| `exhaustion.state_effect` | exactly `none` |
| `registration.lifecycle` | `active`, `retired` |

Paths use one leading slash, no query string, no trailing slash except `/`, and
framework parameters normalized as `{name}`. API identity is method plus
normalized path; two handlers with that identity are a duplicate. Job identity
is consumer name, stable job type, and envelope schema version; queue name alone
is not an identity because one queue may carry several bounded job types.

## 4. Checked-in parameter-record schema

### 4.1 Logical record

Every key below is required. “Required” means the key must be present even when
its approval state permits a nullable approval-evidence value. A validator must
reject omission rather than supply a default.

| Field | Type and invariant |
| --- | --- |
| `schema_version` | Literal `1`. Unknown versions reject. |
| `record_id` | Unique `ParameterRecordId`. Never reused for changed content. |
| `surface_id` | One `bounded` catalog `SurfaceId`; exactly one active record may be approved for it in a release set. |
| `window` | Object with required positive integer `duration_ms`, required `kind` (`fixed` or `sliding`), and required UTC `anchor` (`request_time` for sliding; an RFC 3339 instant for fixed). |
| `threshold` | Required positive integer maximum accepted units inside the window before burst allowance. |
| `burst` | Object with required nonnegative integer `additional_units`, required positive integer `refill_units`, and required positive integer `refill_interval_ms`. Zero additional units is explicit no-burst behavior. |
| `safe_counting_key` | Object defined in section 4.2. It names derivation, phase, components, version, normalization, rotation behavior, and privacy proof. Raw credentials, locators, contact details, and unverified subject claims are forbidden. |
| `counter_store` | Object with required store binding, namespace, atomic operation, consistency model, region, TTL, clock source, and literal `failure_mode: "deny"`. TTL must cover the window and burst-refill horizon. |
| `quota` | Object with required `unit`, positive integer `ceiling`, `scope`, `reset`, and optional resource dimensions expressed as a required array (empty when none). It covers request quota and any resource/concurrency ceiling required by the surface. |
| `anti_lockout_rule` | Object defined in section 4.3. It is required even when the record proves that no subject-bound dimension exists. |
| `capacity_basis` | Object with required source/evidence locator, measurement timestamp, sustained capacity, peak assumption, headroom, failure budget, workload assumptions, and reviewer role. Estimates must be labeled estimates. |
| `product_owner_approval` | Object defined in section 4.4. Presence is not approval. |
| `source_requirements` | Nonempty array containing the applicable `RL-92-*`, `EP-92-*`, `SR-94-*`, and story/decision identifiers. |
| `created_at` | RFC 3339 UTC instant. |
| `supersedes_record_id` | Required nullable prior record identity. A changed value creates a new record and points backward. |
| `record_digest` | Lowercase SHA-256 of canonical JSON with this field omitted and `product_owner_approval.candidate_digest` included. |

### 4.2 Safe counting key

`safe_counting_key` has these required fields:

| Field | Invariant |
| --- | --- |
| `phase` | `pre_authentication`, `post_authentication`, `service`, or `compound`. |
| `components` | Nonempty ordered list from an implementation-defined closed catalog whose entries declare trust source and cardinality. |
| `derivation_version` | Immutable algorithm/version identifier; no secret value appears in the registry. |
| `normalization` | Exact normalization identifier applied before keyed derivation. |
| `rotation_behavior` | Overlap and invalidation behavior for a derivation-key change. Rotation cannot erase counters early and permit a burst bypass. |
| `privacy_basis` | Explanation proving the key does not assert an unverified subject fact or create cross-subject/cross-space correlation beyond the approved security purpose. |
| `subject_bound_after_authentication` | Boolean; if true, the validator requires `phase` to be `post_authentication` or `compound` and requires an independent recovery path. |

Pre-authentication components may use caller-controlled and
infrastructure-derived facts, such as a privacy-preserving network cohort and a
server-issued ceremony identifier, only after Security approves their exact
catalog definitions. Claimed email, phone, account ID, invitation destination,
provider account, budget ID, or other existence-bearing locator cannot be a
pre-authentication counter component. Post-authentication subject dimensions
come only from verified server context, never a request field.

### 4.3 Anti-lockout rule

`anti_lockout_rule` has these required fields:

| Field | Invariant |
| --- | --- |
| `attackable_dimensions` | Array of dimensions an unauthenticated or lesser-authority caller can exhaust; empty requires an explicit proof in `rationale`. |
| `victim_bound_dimensions` | Array of subject, recipient, connection, package, space, or lifecycle dimensions; empty when none. |
| `independent_recovery_surface_id` | Nullable bounded surface. Required when a victim-bound dimension can be exhausted. It must use an independently exhaustible pool and counting key. |
| `pool_isolation` | Explanation and test locator proving ordinary traffic and attacker-controlled dimensions cannot consume the recovery pool. |
| `exhaustion_state_effect` | Literal `none`; reaching the ceiling cannot mutate session, invitation, connection, export, or lifecycle state. |
| `reset_authority` | Closed operational actor/purpose allowed to restore counter service; it cannot grant the protected product effect. |
| `notification_behavior` | Uniform, content-safe behavior; cannot confirm subject/resource existence or reveal remaining quota. |
| `rationale` | Surface-specific non-weaponization argument. |
| `verification_cases` | Nonempty fixture-ID array including attacker exhaustion and legitimate independent recovery where applicable. |

An operational counter reset is not an application bypass. If counter state is
unavailable or ambiguous, the surface remains denied while operators restore
the approved store. Public readiness may report the dependency unavailable
without exposing a protected route.

### 4.4 Product Owner approval

`product_owner_approval` has all of these required keys:

| Field | Type and rule |
| --- | --- |
| `status` | Closed approval status. Every record introduced by this document is `pending`. |
| `approval_id` | Nullable durable approval-record ID; required non-null only for `approved`, `rejected`, or `revoked`. |
| `approved_by_actor_id` | Nullable authenticated Product Owner identity; non-null only when supported by the cited approval. |
| `decided_at` | Nullable RFC 3339 UTC instant; non-null for a decided status. |
| `candidate_digest` | Required lowercase SHA-256 of the candidate parameter content bound by the requested decision. |
| `conditions` | Required array, empty only when the approval record says there are no conditions. |
| `expires_at` | Required nullable RFC 3339 UTC instant. Null is valid only when the approval explicitly has no expiry. |

Runtime considers the approval current only when it can resolve the durable
approval, authenticate the Product Owner decision, match `candidate_digest` to
the parameter record, satisfy all conditions, and prove the decision is neither
revoked nor expired. Silence, document status, merge, deployment, or a present
object never changes `pending` to `approved`.

`candidate_digest` is calculated from canonical JSON containing
`schema_version`, `record_id`, `surface_id`, `window`, `threshold`, `burst`,
`safe_counting_key`, `counter_store`, `quota`, `anti_lockout_rule`,
`capacity_basis`, `source_requirements`, `created_at`, and
`supersedes_record_id`. It excludes the approval object and `record_digest`, so
the approving decision can bind the candidate without a digest cycle.

### 4.5 Normative JSON Schema shape

The implementation must check in a machine-executable schema equivalent to the
following shape and add the semantic checks in section 4.6. Abbreviated reusable
subschemas do not relax the required-field lists.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://schemas.cobudget.local/rate-limit/parameter-record-v1.json",
  "type": "object",
  "additionalProperties": false,
  "required": [
    "schema_version", "record_id", "surface_id", "window", "threshold",
    "burst", "safe_counting_key", "counter_store", "quota",
    "anti_lockout_rule", "capacity_basis", "product_owner_approval",
    "source_requirements", "created_at", "supersedes_record_id",
    "record_digest"
  ],
  "properties": {
    "schema_version": { "const": 1 },
    "record_id": { "type": "string", "pattern": "^rlp-266-[a-z0-9-]+-v[1-9][0-9]*$" },
    "surface_id": { "type": "string", "pattern": "^surf-266-[a-z0-9-]+$" },
    "window": {
      "type": "object", "additionalProperties": false,
      "required": ["duration_ms", "kind", "anchor"],
      "properties": {
        "duration_ms": { "type": "integer", "minimum": 1 },
        "kind": { "enum": ["fixed", "sliding"] },
        "anchor": { "type": "string", "minLength": 1 }
      }
    },
    "threshold": { "type": "integer", "minimum": 1 },
    "burst": {
      "type": "object", "additionalProperties": false,
      "required": ["additional_units", "refill_units", "refill_interval_ms"],
      "properties": {
        "additional_units": { "type": "integer", "minimum": 0 },
        "refill_units": { "type": "integer", "minimum": 1 },
        "refill_interval_ms": { "type": "integer", "minimum": 1 }
      }
    },
    "safe_counting_key": { "$ref": "#/$defs/safeCountingKey" },
    "counter_store": { "$ref": "#/$defs/counterStore" },
    "quota": { "$ref": "#/$defs/quota" },
    "anti_lockout_rule": { "$ref": "#/$defs/antiLockout" },
    "capacity_basis": { "$ref": "#/$defs/capacityBasis" },
    "product_owner_approval": { "$ref": "#/$defs/productOwnerApproval" },
    "source_requirements": { "type": "array", "minItems": 1, "uniqueItems": true, "items": { "type": "string", "minLength": 1 } },
    "created_at": { "type": "string", "format": "date-time" },
    "supersedes_record_id": { "type": ["string", "null"] },
    "record_digest": { "type": "string", "pattern": "^[a-f0-9]{64}$" }
  },
  "$defs": {
    "safeCountingKey": {
      "type": "object", "additionalProperties": false,
      "required": ["phase", "components", "derivation_version", "normalization", "rotation_behavior", "privacy_basis", "subject_bound_after_authentication"],
      "properties": {
        "phase": { "enum": ["pre_authentication", "post_authentication", "service", "compound"] },
        "components": { "type": "array", "minItems": 1, "items": { "type": "string", "minLength": 1 } },
        "derivation_version": { "type": "string", "minLength": 1 },
        "normalization": { "type": "string", "minLength": 1 },
        "rotation_behavior": { "type": "string", "minLength": 1 },
        "privacy_basis": { "type": "string", "minLength": 1 },
        "subject_bound_after_authentication": { "type": "boolean" }
      }
    },
    "counterStore": {
      "type": "object", "additionalProperties": false,
      "required": ["binding", "namespace", "atomic_operation", "consistency", "region", "ttl_ms", "clock_source", "failure_mode"],
      "properties": {
        "binding": { "type": "string", "minLength": 1 },
        "namespace": { "type": "string", "minLength": 1 },
        "atomic_operation": { "type": "string", "minLength": 1 },
        "consistency": { "type": "string", "minLength": 1 },
        "region": { "type": "string", "minLength": 1 },
        "ttl_ms": { "type": "integer", "minimum": 1 },
        "clock_source": { "type": "string", "minLength": 1 },
        "failure_mode": { "const": "deny" }
      }
    },
    "quota": {
      "type": "object", "additionalProperties": false,
      "required": ["unit", "ceiling", "scope", "reset", "resource_dimensions"],
      "properties": {
        "unit": { "type": "string", "minLength": 1 },
        "ceiling": { "type": "integer", "minimum": 1 },
        "scope": { "type": "string", "minLength": 1 },
        "reset": { "type": "string", "minLength": 1 },
        "resource_dimensions": { "type": "array", "uniqueItems": true, "items": { "type": "string", "minLength": 1 } }
      }
    },
    "antiLockout": {
      "type": "object", "additionalProperties": false,
      "required": ["attackable_dimensions", "victim_bound_dimensions", "independent_recovery_surface_id", "pool_isolation", "exhaustion_state_effect", "reset_authority", "notification_behavior", "rationale", "verification_cases"],
      "properties": {
        "attackable_dimensions": { "type": "array", "uniqueItems": true, "items": { "type": "string", "minLength": 1 } },
        "victim_bound_dimensions": { "type": "array", "uniqueItems": true, "items": { "type": "string", "minLength": 1 } },
        "independent_recovery_surface_id": { "type": ["string", "null"] },
        "pool_isolation": { "type": "string", "minLength": 1 },
        "exhaustion_state_effect": { "const": "none" },
        "reset_authority": { "type": "string", "minLength": 1 },
        "notification_behavior": { "type": "string", "minLength": 1 },
        "rationale": { "type": "string", "minLength": 1 },
        "verification_cases": { "type": "array", "minItems": 1, "uniqueItems": true, "items": { "type": "string", "minLength": 1 } }
      }
    },
    "capacityBasis": {
      "type": "object", "additionalProperties": false,
      "required": ["evidence_locator", "measured_at", "sustained_capacity", "peak_assumption", "headroom", "failure_budget", "workload_assumptions", "reviewer_role"],
      "properties": {
        "evidence_locator": { "type": "string", "minLength": 1 },
        "measured_at": { "type": "string", "format": "date-time" },
        "sustained_capacity": { "type": "string", "minLength": 1 },
        "peak_assumption": { "type": "string", "minLength": 1 },
        "headroom": { "type": "string", "minLength": 1 },
        "failure_budget": { "type": "string", "minLength": 1 },
        "workload_assumptions": { "type": "array", "minItems": 1, "items": { "type": "string", "minLength": 1 } },
        "reviewer_role": { "type": "string", "minLength": 1 }
      }
    },
    "productOwnerApproval": {
      "type": "object", "additionalProperties": false,
      "required": ["status", "approval_id", "approved_by_actor_id", "decided_at", "candidate_digest", "conditions", "expires_at"],
      "properties": {
        "status": { "enum": ["pending", "approved", "rejected", "revoked", "expired"] },
        "approval_id": { "type": ["string", "null"] },
        "approved_by_actor_id": { "type": ["string", "null"] },
        "decided_at": { "type": ["string", "null"], "format": "date-time" },
        "candidate_digest": { "type": "string", "pattern": "^[a-f0-9]{64}$" },
        "conditions": { "type": "array", "items": { "type": "string", "minLength": 1 } },
        "expires_at": { "type": ["string", "null"], "format": "date-time" }
      }
    }
  }
}
```

The executable schema must fully declare types/properties for every referenced
subschema; the compact excerpt above is a contract illustration, not permission
to ship unconstrained objects.

### 4.6 Validator algorithm and missing-field proof

Validation returns all deterministic diagnostics, sorted by record ID and JSON
pointer, but never returns a partially accepted registry.

1. Parse without duplicate object keys.
2. Validate the exact structural schema and reject every missing required field,
   unknown field, wrong type, invalid format, and unsupported schema version.
3. Validate semantics: positive durations/ceilings, fixed/sliding anchor match,
   TTL coverage, safe-key phase, recovery-pool requirements, exact fail-closed
   literals, and self-consistent capacity units.
4. Validate references: unique record IDs/digests; known bounded surface; valid
   supersession chain; no cycle; at most one current approved record per surface.
5. Validate approval evidence and candidate digest. Pending or unverifiable
   records remain loadable for review but are absent from the runtime-approved
   index.
6. Canonically digest the accepted release set. API, worker, build check, and
   audit events pin that same release-set digest.

`FX-266-SCHEMA-MISSING-FIELD` is a table-driven negative suite. It starts with
one structurally complete pending record and, once per test, deletes each top-
level required field and each nested required field. Every variant must return
`record_schema_invalid` with the exact missing JSON pointer and must not enter
the approved index. This proves the CBD-266-AC01 missing-field requirement; a
single hand-picked omitted field is insufficient.

## 5. Surface catalog

The catalog below is the closed classification target for executable business
surfaces. It covers all CBD-92 section 3.3 entry points, including paths not
enumerated as examples in `RL-92-001`; the latter still fail closed instead of
becoming unbounded. A route/job registration may use only one row. If one
handler performs operations from different rows, it must be split or select a
single stricter separately approved surface before protected lookup.

| Surface ID | Entry point | Surface class |
| --- | --- | --- |
| `surf-266-registration` | `EP-92-001` | Registration ceremony |
| `surf-266-authentication` | `EP-92-001` | Authentication ceremony |
| `surf-266-recovery` | `EP-92-001` | Account/session recovery |
| `surf-266-session` | `EP-92-001` | Session refresh, logout, revocation, management |
| `surf-266-invitation-create` | `EP-92-002` | Invitation creation |
| `surf-266-invitation-resend` | `EP-92-002` | Invitation resend |
| `surf-266-invitation-cancel` | `EP-92-002` | Invitation cancellation |
| `surf-266-invitation-inspect` | `EP-92-002` | Invitation inspection |
| `surf-266-invitation-accept` | `EP-92-002` | Invitation acceptance |
| `surf-266-budget-read` | `EP-92-003` | General budget-space read |
| `surf-266-budget-mutation` | `EP-92-003` | General budget-space mutation |
| `surf-266-protected-action` | `EP-92-004` | Ownership, role, or other protected action |
| `surf-266-protected-lifecycle` | `EP-92-004` | Protected archive, restore, recovery, or deletion action |
| `surf-266-provider-redirect` | `EP-92-005` | Provider consent/link redirect |
| `surf-266-provider-callback` | `EP-92-005` | Provider callback or link lifecycle |
| `surf-266-provider-webhook` | `EP-92-006` | Provider webhook |
| `surf-266-queue-control` | `EP-92-007` | Scheduler, publish/consume, retry, dead-letter, or redrive control |
| `surf-266-search` | `EP-92-008` | Search |
| `surf-266-report` | `EP-92-008` | Report calculation/render |
| `surf-266-derived-read` | `EP-92-008` | Cache or derived-data read |
| `surf-266-derived-rebuild` | `EP-92-008` | Cache/index/report rebuild |
| `surf-266-alert-evaluation` | `EP-92-009` | Alert evaluation |
| `surf-266-alert-state` | `EP-92-009` | Recipient instance/state action |
| `surf-266-delivery-request` | `EP-92-010` | Email, push, or SMS delivery request |
| `surf-266-delivery-callback` | `EP-92-010` | Delivery-provider callback |
| `surf-266-export-request` | `EP-92-011` | Export request |
| `surf-266-export-generation` | `EP-92-011` | Export generation |
| `surf-266-export-download` | `EP-92-011` | Package lookup or download |
| `surf-266-operations-query` | `EP-92-012` | Support, diagnostics, log, analytics, or audit query |
| `surf-266-backup-recovery` | `EP-92-013` | Backup, key recovery, restore, or return to service |
| `surf-266-lifecycle-orchestration` | `EP-92-014` | Lifecycle issue, orchestration, retry, restoration, or completion |
| `surf-266-secret-read` | `EP-92-015` | Secret/key read |
| `surf-266-secret-rotate` | `EP-92-015` | Secret/key rotation |
| `surf-266-secret-revoke-recover` | `EP-92-015` | Secret/key revocation or recovery |

This document establishes the classes, not their value records. The initial
parameter registry is therefore empty and every bounded row is
`OPEN-266-VALUES`: its own story must add a complete pending record, obtain the
Product Owner decision bound to its digest, and only then publish an approved
release set. An empty registry is a valid review artifact and an unusable
runtime release set; all bounded execution denies.

## 6. Executable-surface registration

### 6.1 Registration record

Every registration contains all fields below and rejects unknown fields:

| Field | Rule |
| --- | --- |
| `registration_id` | Canonical API or job identity from section 3. |
| `executor_kind` | `api_route` or `worker_job`. |
| `source_locator` | Repository-relative source file plus exported declaration symbol; generated output alone is insufficient. |
| `surface_id` | Exactly one catalog row, or one exact public exception from section 6.2. |
| `parameter_record_id` | Required for a bounded surface; null only for a named public exception. |
| `registration_lifecycle` | `active` or `retired`; retired registrations cannot satisfy discovered execution. |
| `introduced_by` | Jira/story ID that owns the route/job and parameter values. |
| `authorization_metadata_id` | Required nullable sibling declaration. Protected surfaces must bind the CBD-236 metadata identity; pre-authentication ceremonies and public exceptions use null with an explicit reason. |

The registration is declared through one shared helper at the point the route
or consumer is installed. The helper validates metadata before returning an
executable handler. A decorator, queue subscription, dynamic route, retry
consumer, scheduler callback, or plugin installation that bypasses the helper
is an unregistered executable surface and must be discovered as such by the
build check.

### 6.2 Current baseline inventory

At baseline `ce49e3d`, `apps/api` exposes only health and Swagger/OpenAPI
discovery, and `apps/worker` installs no job consumer. These entries make that
baseline explicit; they are observations for implementation planning, not
proof that the future build guard exists.

| Registration ID | Surface | Control | Authority/state |
| --- | --- | --- | --- |
| `api:GET:/health` | `surf-266-public-health` | `public_exception` | Exact CBD-236 section 7 public health exception; must still be declared |
| `api:GET:/docs` | `surf-266-public-docs` | `public_exception` | Exact CBD-236 section 7 OpenAPI exception; JSON document only at this baseline |
| `api:GET:/openapi.json` | `surf-266-public-openapi-json` | `public_exception` | Exact CBD-236 section 7 OpenAPI exception |

Zero worker jobs is a count, not a wildcard registration. The first scheduler,
consumer, retry, dead-letter, or redrive handler must add its own registration
and approved parameter record before it can start.

### 6.3 Build check

The future `check-rate-limit-surfaces` command must run after compilation and
before packaging. It independently enumerates framework routes and installed
worker consumers, then compares them to the canonical registrations and
approved parameter index. It prints these sorted sections even when empty:

1. `UNREGISTERED_API_ROUTES` - discovered method/path identities with source
   locators and no active registration;
2. `UNREGISTERED_WORKER_JOBS` - discovered consumer/job/schema identities with
   source locators and no active registration;
3. `UNKNOWN_SURFACES` - registrations referencing no closed catalog row;
4. `MISSING_OR_UNAPPROVED_PARAMETER_RECORDS` - bounded registrations whose
   record is absent, invalid, pending, rejected, revoked, expired, digest-
   mismatched, or condition-unsatisfied;
5. `DUPLICATE_REGISTRATIONS` - identities or active surface-record bindings
   that are ambiguous; and
6. `STALE_REGISTRATIONS` - active registrations with no discovered executable
   surface, preventing a hand-maintained inventory from drifting away from code.

Any nonempty section exits nonzero. Diagnostics include identity and source
locator but never counting-key material, subject facts, request data, or
credentials. The final success line includes counts for API routes, jobs,
bounded surfaces, public exceptions, approved records, and the release-set
digest.

`FX-266-UNREGISTERED-API-ROUTE` installs a new test-only route through the
framework without the registration helper. The runtime request must deny before
the handler sentinel runs, and the build check must list its canonical identity
under `UNREGISTERED_API_ROUTES` and fail. `FX-266-UNREGISTERED-WORKER-JOB` does
the same for a test-only consumer and proves terminal denial before its effect
sentinel. Both fixtures are restored before the passing gate. A unit test that
calls only the validator does not satisfy this discovery requirement.

## 7. Fail-closed counter decision

The shared decision input is `{ registrationId, surfaceId, parameterRecordId,
releaseSetDigest, verifiedContext, requestOrJobUnit }`. The adapter may supply
only verified context available at that point in the chain. The result is a
closed union:

| Result | Meaning |
| --- | --- |
| `allow` | Atomic store decision accepted this unit under the exact approved record and returns only internal counter provenance. |
| `deny_exhausted` | Approved ceiling is exhausted. No protected effect runs. |
| `deny_unregistered` | No active exact registration exists. |
| `deny_policy_unavailable` | Record absent/unapproved/invalid/stale, digest unsupported, reference broken, or approval unverifiable. |
| `deny_counter_unavailable` | Counter read/write/expiry/clock result is failed, timed out, inconsistent, or uncertain. |
| `deny_input_invalid` | Adapter input, safe-key component, unit, or binding is missing or malformed. |

Only `allow` can enter the next gate. No catch block, development mode, health
flag, store fallback, gateway default, or retry converts a deny/exception into
allow. The decision discloses no remaining count. API serialization uses the
single external denial contract and timing tolerance eventually approved under
`PR-94-003`; worker denial reaches the bounded terminal state and audit path
required by `RL-92-006` rather than retrying without bound.

The counter store performs one atomic consume against the exact canonical key,
record ID, and release-set digest. It must not split the threshold, burst,
resource ceiling, or concurrency decision into races. A changed parameter
record has a new identity and namespace migration rule; deploy order must keep
old readers and writers from treating the new namespace as an empty reset.

## 8. Ordering with CBD-236 and audit ownership

This section resolves the architectural question raised as CBD-236
`OQ-236-003`. It does not approve CBD-236 v0.4 or its policy values.

### 8.1 API order

For a protected API route the sequence is:

1. resolve the session as CBD-191/CBD-236 require;
2. resolve the exact route registration and enforce its current approved
   surface parameter record;
3. resolve CBD-236 route authorization metadata;
4. assemble verified policy context and evaluate authorization;
5. invoke the handler; and
6. perform the CBD-236 commit-time recheck before mutation.

The surface hook runs before the authorization-metadata/policy hook because an
unregistered or unapproved surface is not entitled to spend protected lookup,
policy-evaluation, or handler capacity. That ordering also ensures a new route
fails closed at the first route-specific control and cannot accidentally become
reachable while authorization metadata is being added. Session resolution
remains first for protected routes so post-authentication counting keys can use
only verified server context. On registration/authentication/recovery routes,
which cannot require an existing session, surface enforcement runs before the
identity ceremony and uses only approved pre-authentication key components.

### 8.2 Worker order

The worker authenticates the producer/workload and structurally validates the
complete envelope first, because ordinary envelope values cannot be trusted as
counting keys or authority facts. It then resolves the job registration and
surface decision before reloading protected facts and invoking the CBD-236
policy decision. An unregistered or unapproved job reaches its bounded terminal
state without executing the consumer effect.

### 8.3 A request that two gates would deny

The API/worker enforcement-outcome coordinator, not either hook in isolation,
owns the one `SA-92-007` audit append. It records:

- invocation correlation, registration identity, surface/record/release-set
  versions, executor kind, earliest decisive gate and safe reason class;
- the CBD-236 policy tuple/reason only when that decision was actually reached;
  otherwise `authorization_evaluation: not_run`; and
- outcome, timestamp, service build, and content-free counter-store evidence.

If test preconditions establish that both gates would deny, the runtime still
records the surface denial as primary because it runs first; it does not execute
the later policy merely to discover or log a second denial. Doing so would spend
protected work, create timing differences, and risk turning authorization into
an oracle. The build check may report both static defects independently. No
second audit event is emitted by CBD-236, and no audit field records protected
content, raw counting keys, subject existence, remaining quota, or secret data.

This closes `OQ-236-003` for the CBD-266 implementation handoff: **surface first
after the prerequisite identity/envelope validation; one adapter-owned audit of
the earliest decisive gate**.

## 9. Anti-lockout invariants and verification

| ID | Binding invariant | Required future evidence |
| --- | --- | --- |
| `AL-266-001` | A pre-authentication surface never counts solely by claimed subject, destination, invitation, connection, package, or resource identity. | Safe-key component review and existent/nonexistent equivalence fixtures |
| `AL-266-002` | A post-authentication subject counter uses server-resolved identity and is compounded with a surface-appropriate caller/infrastructure or session dimension where the approval specifies it. | Forged request-field fixture and authenticated-context fixture |
| `AL-266-003` | A victim-bound ceiling has an independently keyed, independently budgeted recovery path that ordinary and attacker-controlled traffic cannot exhaust. | `FX-266-LOCKOUT-RECOVERY` exhausts the attackable pool and completes the independent recovery decision |
| `AL-266-004` | Ceiling exhaustion, missing approval, and store failure mutate no protected state and do not invalidate a legitimate session, invitation, connection, export, or lifecycle workflow. | Before/after persistence snapshot with effect sentinel |
| `AL-266-005` | Response status/body/class/headers/length/`Retry-After`/timing do not vary by target existence, eligibility, or authorization; remaining-quota headers are absent. | `VT-94-066` / `PR-94-003` evidence; still open |
| `AL-266-006` | Counter reset/failover/race cannot bypass a ceiling or merge unrelated subjects, spaces, connections, or purposes. | `VT-94-068` concurrency, failover, and rotation fixtures |
| `AL-266-007` | Background retries, concurrency, provider quota, and resource exhaustion are bounded and end explicitly without silent drop. | `RL-92-006`, `VT-94-065` through `VT-94-068`, per-queue evidence |
| `AL-266-008` | Operational restoration repairs the counter service only; it cannot authorize or execute the protected product action. | Privilege-boundary and recovery runbook review |

No parameter record may be approved until its anti-lockout rule identifies the
exact applicable fixture IDs and their evidence plan. `ME-94-010` additionally
requires Architecture, Security, Reliability, and Product review of concrete
values, safe keys, distributed counters, timing tolerance, anti-lockout design,
and capacity basis.

## 10. Placement, interfaces, migration, and compatibility

| Owner | Required implementation artifact | Compatibility rule |
| --- | --- | --- |
| `packages/contracts` | Parameter/registration types, complete JSON Schema, validator, canonical serializer/digest, closed surface catalog, approval projection, decision union, test fixtures | New additive export subpath; API and worker pin one exact supported schema/release digest |
| `apps/api` | Registration helper, discovery adapter, enforcement hook, response adapter, outcome coordinator, negative route fixture | Existing public endpoints become explicit registrations before default-deny is enabled; no handler-local bypass |
| `apps/worker` | Job registration helper, consumer discovery, enforcement adapter, terminal denial, outcome coordinator, negative job fixture | Startup with zero consumers is valid; any installed consumer requires an approved bounded registration |
| Build tooling | `check-rate-limit-surfaces` discovery/join command and fixture tests | Must enumerate compiled executable surfaces rather than trusting only hand-authored registry rows |
| Surface stories | Concrete pending records, capacity evidence, review, and Product Owner decisions | One immutable version per changed record; this document creates none |

Migration is forward-only:

1. land shared contracts, validator, catalog, and negative fixtures;
2. declare the three exact public baseline routes and prove discovery parity;
3. install default-deny hooks while bounded registry remains empty;
4. add each business route/job together with its complete parameter record and
   approval request;
5. include a record in the runtime-approved release set only after its exact
   digest has current Product Owner approval and all conditions are satisfied;
6. deploy API and worker builds that pin the same supported release-set digest.

Rollback uses the previous application build plus its exact immutable registry
release. Reusing an old application with a new registry, editing a record in
place, or clearing a namespace to recover capacity is forbidden. If a rollback
record's approval has expired or been revoked, the affected surface stays
denied; rollback is not authority to revive it.

## 11. Alternatives and tradeoffs

| Alternative | Disposition and tradeoff |
| --- | --- |
| One global limiter | Rejected by `RL-92-002`; cheap enumeration and expensive work have different abuse/capacity profiles. |
| Gateway-only configuration | Rejected as authority. A gateway may enforce an approved projection, but vendor defaults do not provide route/job completeness, worker coverage, safe-key proof, approval binding, or application-level negative fixtures. |
| Hand-maintained route spreadsheet | Rejected. It cannot prove parity with framework-installed routes and consumers. Declarations plus independent discovery make drift mechanically visible. |
| Authorization before rate control | Rejected for route-specific gates. It spends protected lookup and policy capacity for a surface that may not be approved and weakens fail-closed route introduction. Prerequisite session/producer verification still runs first where needed for safe inputs. |
| Evaluate every denying gate and audit all reasons | Rejected. It adds work and timing/state probes after a decisive denial. The coordinator records one primary denial and static checks report independent defects. |
| In-process fallback when the counter store fails | Rejected. Replica-local counters cannot enforce the distributed ceiling and make reset/race bypass likely. Availability loss is visible denial, not unbounded execution. |
| A permanent operator bypass | Rejected. It turns reliability recovery into product authority. Operators may restore the counter service, not grant the protected effect. |

## 12. Open items and release gates

| ID | Open item | Owner / unblock condition |
| --- | --- | --- |
| `OPEN-266-VALUES` | Concrete window, threshold, burst, key, store, quota, anti-lockout, and capacity values for every catalog surface | Each surface story; Reliability and Architecture/Security evidence under `ME-94-010` |
| `OPEN-266-APPROVALS` | Product Owner approval for every exact record digest | Product Owner; **all are pending and none is granted by this document** |
| `OPEN-266-RESPONSE` | Uniform external status/body/header/timing and `Retry-After` contract | Security-owned `PR-94-003` |
| `OPEN-266-KEY-CATALOG` | Exact safe key-component catalog, keyed derivation, secret custody, normalization, and rotation behavior | Security/Architecture implementation review |
| `OPEN-266-STORE` | Concrete distributed counter store and measured capacity evidence | Reliability/Architecture; no external provider activation follows from this proposal |
| `OPEN-266-IMPLEMENTATION` | Shared package, API/worker adapters, guard, and fixtures | Manager-routed Implementation and Guard assignments |
| `OPEN-266-REVIEWS` | Independent Architecture/Review, Security, Reliability, and QA dispositions | Applicable specialist assignments against exact candidate revisions |

`RG-94-005` remains blocked for affected surfaces until concrete records,
approvals, implementation, and `VT-94-065` through `VT-94-068` evidence exist.
Neither merging this proposal nor passing documentation gates releases a
bounded surface.

## 13. Acceptance-criteria traceability

| CBD-266 criterion | Contract evidence | Delivery status |
| --- | --- | --- |
| `CBD-266-AC01` | Sections 4.1-4.5 require window, threshold, burst, safe counting key, counter store, quota, anti-lockout rule, capacity basis, and Product Owner approval in every record. Section 4.6 defines the exhaustive missing-field fixture. | **Architecture contract delivered; executable validator and fixture pending because this assignment permits no code.** |
| `CBD-266-AC02` | Sections 5 and 6 define the closed catalog, exact route/job registration, current baseline inventory, discovery-based build output, and nonzero failure rules. | **Architecture contract delivered; route/job declarations and build check pending implementation.** |
| `CBD-266-AC03` | Sections 7-9 define default denial for missing/unapproved records, API/worker ordering, no-effect behavior, and both unregistered route and job negative fixtures. | **Architecture contract delivered; middleware and negative execution/build evidence pending implementation.** |
| `CBD-266-AC04` | Section 14 defines completion evidence fields and fixture identities. | **Partially applicable now: proposal PR/commit can be recorded; merge SHA and implementation run IDs cannot exist before Manager integration and later code work.** |

## 14. Required completion evidence

The final CBD-266 completion record must name:

- architecture proposal PR and merge SHA;
- implementation and guard PRs and merge SHAs;
- exact registry release-set digest and every approved parameter-record digest;
- Product Owner approval IDs for every enabled surface;
- CI/build/QA/Security/Reliability run IDs against the exact candidate;
- `FX-266-SCHEMA-MISSING-FIELD`, `FX-266-UNREGISTERED-API-ROUTE`,
  `FX-266-UNREGISTERED-WORKER-JOB`, and `FX-266-LOCKOUT-RECOVERY` results;
- `VT-94-065` through `VT-94-068` and applicable `ME-94-010` evidence; and
- the discovered API route/job counts and zero-item diagnostic sections from
  the passing build check.

A PR URL without its merge SHA, a wrapper exit code without the guard's own
verdict, or a fixture name without its observed fail-then-pass run ID is not
completion evidence. The Architecture proposal itself does not certify Jira
Done.

## 15. Source-to-decision crosswalk

| Source | Applied here |
| --- | --- |
| CBD-92 `RL-92-001` | Closed bounded-surface catalog, absent-surface denial, explicit coverage of named ceremonies/actions/jobs |
| CBD-92 `RL-92-002` | Per-surface records; global limiter rejected |
| CBD-92 `RL-92-007` | Concrete values and verification left to surface stories and CBD-94 evidence |
| CBD-92 section 3.3 `EP-92-001`-`EP-92-015` | Every entry-point family maps to at least one closed surface class |
| CBD-103 `TD-103-013` | Per-surface edge enforcement, uniform denial, no remaining-quota headers |
| CBD-103 `OI-103-003` | No bounded surface releases until `PR-94-002` concrete values exist |
| CBD-94 `SR-94-037` | Complete schema includes values, store/consistency, quotas/resource dimensions, approval, and capacity basis |
| CBD-94 `ME-94-010` | Required review/evidence package for values, keys, distributed counter, response/timing, anti-lockout, and capacity |
| CBD-94 `PR-94-002` | Product Owner decision remains open per exact record digest |
| CBD-236 v0.4 section 7 / `OQ-236-003` | Surface gate precedes authorization metadata/policy after prerequisite verification; one coordinator audits the earliest decisive denial |

## 16. Change history

| Version | Date | Change |
| --- | --- | --- |
| 0.1 | September 13, 2026 | Initial Architecture proposal for CBD-266; no parameter value or Product Owner approval granted |
