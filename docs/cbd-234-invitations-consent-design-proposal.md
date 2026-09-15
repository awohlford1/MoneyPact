# Invitations, acceptance, and Primary transfer on the consent record — design proposal

| Field | Value |
| --- | --- |
| Status | **Proposed — architecture proposal for an Executive decision; nothing in this document is approved, no migration, policy cell, registry entry, or route exists because of it, and no CBD-73 gate closes because of it. The decision items are in §17** |
| Document version | 0.1.1 |
| Proposal identifiers | `IV-001` through `IV-031`; open questions `OQ-IV-001` through `OQ-IV-006`; packets `PK-1` through `PK-9` |
| Owner | Alexander Wohlford |
| Jira, as read on September 15, 2026 | Epic [CBD-8](https://awohlford.atlassian.net/browse/CBD-8); story [CBD-41](https://awohlford.atlassian.net/browse/CBD-41) with subtasks [CBD-274](https://awohlford.atlassian.net/browse/CBD-274), [CBD-275](https://awohlford.atlassian.net/browse/CBD-275), [CBD-276](https://awohlford.atlassian.net/browse/CBD-276); [CBD-280](https://awohlford.atlassian.net/browse/CBD-280) under CBD-42; [CBD-287](https://awohlford.atlassian.net/browse/CBD-287) under CBD-43; specification source [CBD-73](https://awohlford.atlassian.net/browse/CBD-73). The packet named [CBD-234](https://awohlford.atlassian.net/browse/CBD-234) and [CBD-235](https://awohlford.atlassian.net/browse/CBD-235); see §1.2 |
| Binding constraint | `PROTO-CONSENT-LANDING-SEC-001-RESULT` finding `SEC-F02` (and `SEC-F04`): the deferred activation-atomicity trigger in `packages/migrations/migrations/20260914T170000Z__create_budget_space_consent.sql` |
| Governing consent semantics | `CBD236-CONSENT-SEMANTICS-001` (Executive, September 14, 2026), items 1–6; `docs/cbd-236-consent-facts-proposal.md` v0.1 §4, §5, §10, `OQ-CF-001`–`OQ-CF-005` |
| Governing lifecycle | `docs/cbd-73-invitation-consent-lifecycle-specification.md` v1.0.4 — §3 invariants, §4 states and `TR-73-*`, §5 and §5.1, §6 rules 1–6, §7.2, §12 transfer, §13 `DR-73-*`, §14 `AE-73-*`, §15 `OI-73-*` |
| Governing permission model | `docs/cbd-72-collaboration-permission-model.md` v0.1.54 — §2, §4.3 rows 24–29, §6.1–§6.3, §8 |
| Governing authorization contract | `docs/cbd-236-authorization-policy-contract.md` (v0.9 by its revision history; the header cell still says 0.8, `OQ-IV-006`) — §4.4, §6.1, §8.1, §8.2, §8.5, §8.6, §9.4, §9.5, §12, `HO-236-07` |
| Governing rate-limit contract | `docs/cbd-266-rate-limit-parameter-registry-contract.md` v0.5 — §3, §4.7, §4.7.4, §5, §6 |
| Consumed contracts | `docs/cbd-231-budget-space-lifecycle-contract.md` v0.1; `docs/cbd-233-budget-creation-confirmation-contract.md` v0.1.1; `docs/cbd-190-identity-ceremony-and-mapping-contract.md` v0.4 §5.3, §6; `docs/cbd-191-session-and-revocation-contract.md` v0.3 (`CBD191-ZERO-MEMBERSHIP-001`); `docs/cbd-91-private-mvp-data-inventory.md` v1.0.5 `DI-91-005`, `DI-91-007`, `DI-91-054`, `DI-91-065` |
| Milestone | `PROTOTYPE-SLICE-001` and `PROVIDERS-LOCAL-001` (Executive, September 12, 2026) |
| Repository baseline | `12862d4` on `main` (policy `p3` released; consent landing PR #337 merged; container-image fix merged) |
| Written by | Architecture, assignment `PROTO-INVITATIONS-DESIGN-001`, September 15, 2026 |
| Last updated | September 15, 2026 |

> **Authority.** CBD-72 decides who may do what, CBD-73 decides what an invitation, a consent, and a transfer are, and CBD-236 decides how a fact reaches `decide`. This document changes none of them. It proposes how the second person enters a budget space in the local prototype — the invitation record, the acceptance ceremony over HTTP, the consent row that the acceptance commit writes, the Primary transfer as a consent-bearing membership change, the policy cells, registry kinds, rate-limit surfaces, and migrations that the implementation packets need — and it decomposes that into packets whose write scopes do not collide. Where this document appears to widen an approved source, the source wins and this document is wrong. Rules marked **Proposed-binding** bind the packets only when the §17 decision is recorded.

## 1. Purpose, the constraint, and limits

### 1.1 What this increment is

`PROTOTYPE-SLICE-001` proved one person, one space. The manual-account increment proved that person can record an expense. This increment lets that person invite a second person into the same space, lets the second person accept, lets the space show its members, and lets the Primary Owner hand primary ownership to the second person. Everything else CBD-73 specifies — inviter blocks, pair limiters, provider delivery, notification-only destinations, Viewer profiles, revocation and removal, decline-and-block — is either deferred with its uniform outcome preserved (§3) or is the next packet after this one. Nothing deferred here closes an `OI-73-*` gate; the §15 register of CBD-73 remains binding for Private-MVP.

### 1.2 Ticket keys: what the packet named and what Jira says

The task packet names CBD-234 as "the invitation ticket" and CBD-235 as "the acceptance ticket". Read live on September 15, 2026 through the credential loader, CBD-234 is *Reconcile concurrent and uncertain budget-creation outcomes* (subtask of CBD-23, eight criteria about the creation-operation state machine) and CBD-235 is *Implement and verify budget list, open, rename, and archive* (subtask of CBD-23, ten criteria, with ownership transfer and member administration explicitly out of its scope). Neither is an invitation ticket. The invitation work lives under epic CBD-8: story CBD-41 (twelve criteria) with subtasks CBD-274 (channel verification and account reconciliation), CBD-275 (atomic acceptance commit), CBD-276 (issuance and delivery controls); CBD-280 (ownership and membership protected actions, including Primary transfer); and CBD-287 (versioned disclosures and consent evidence). CBD-8 and CBD-73 are as the packet says.

This document therefore maps its packets to the live criteria of all ten issues (§16), treats CBD-41/274/275/276/280/287 as the governing acceptance criteria, and maps CBD-234 and CBD-235 criteria only where a criterion genuinely binds this increment. The file name keeps the packet's `cbd-234` prefix because that is the packet's allowed write scope; the Manager should route the document to its Jira home when the keys are corrected (§17 item 1). No Jira field was written.

### 1.3 The binding constraint, stated exactly

`SEC-F02` (Level 2, for the record, not a defect): `budget_space_membership_activation_requires_consent` is a `DEFERRABLE INITIALLY DEFERRED` `AFTER INSERT` constraint trigger on `budget_space_membership` that, at `COMMIT`, counts `budget_space_consent` rows with `state = 'current'` for the inserted `(budget_space_id, membership_id)` and raises `23514` unless the count is exactly one. Consequences the security result proved on a scratch database:

* (a) every future `INSERT` into `budget_space_membership` — invitation acceptance, Primary transfer, any worker job — must write a `current` consent row for that membership in the same transaction, in either order (probe T2: consent-before-membership commits);
* (b) the consent table's CHECK constraints are closed to `role = 'primary_owner'`, `source = 'self_disclosure'`, `disclosure_kind = 'primary_owner_self'`, and `budget_space_membership` is closed to `role = 'primary_owner'`, `status = 'active'`; every new path fails closed with `23514` until a migration widens them, and that migration must precede any such path;
* (c) superseding a consent must `UPDATE` the old row to `superseded` before `INSERT`ing the new `current` row, because `budget_space_consent_one_current_per_membership` is an immediate partial unique index;
* (d) existing memberships are never examined, so no space is stranded.

`SEC-F04` (Level 1): `budget_space_consent_subject_coherence` constrains `account_subject_id` to the membership's subject but not `recorded_by_subject_id`; a row recorded by another subject commits. The consent landing writes both from the same server fact; this document decides the rule for the two-party sources (`IV-013`).

This document satisfies (a) structurally: §8 and §10 write the consent row inside the same transaction as every membership insert and every role change, and §7 specifies the widening migration as `PK-2`, which every membership-writing packet depends on (§15).

### 1.4 What this document does not do

It ships no code, migration, cell, registry entry, or route. It does not amend CBD-72, CBD-73, CBD-236, CBD-266, CBD-233, CBD-232, CBD-231, CBD-212, or CBD-190; where it needs a clause of one of them to change, it says so in §14 and leaves the amendment to the owning package under `PO-CONTRACT-APPROVALS-001`. It does not approve any disclosure copy: the semantic content in §6 is proposed for the prototype phase only, exactly as `CF-236-002` was, and Private-MVP copy remains under `OI-73-004`. It does not close `OI-73-002`, `-003`, `-004`, `-008` (custody and rate evidence), `-009`, `-010`, `-011`, or `-012`.

## 2. Decision summary

The Executive is asked to decide the items in §17. In one paragraph: adopt the live CBD-8 tickets as the Jira home (1); invite only Collaborator and Co-owner in the prototype, with a simulated local delivery adapter and no provider (2, 3); implement the intended-recipient confirmation now, committing `TR-73-39` and `TR-73-13` in one transaction (4); one disclosure kind per role, the consent CHECKs widened to an explicit list, `recorded_by_subject_id` always the consenting subject, and a ceremony-correlation column on the consent row (5, 6, 7); answer `OQ-CF-002` as "no retroactive obligation" (8); land a local fresh-assurance step-up before the transfer packet (9); populate `p4` with the Co-owner and Collaborator columns for every exposed action plus the invitation, membership-read, and transfer cells (10, 11); project the rate-limit records named in §12, one of which needs a new pre-authentication set (12); defer the CBD-73 controls listed in §3 with their uniform outcomes preserved (13); and record the CBD-41-AC07 wording conflict for the Scrum role rather than resolving it here (14).

## 3. Prototype scope cut against CBD-73

`IV-001` (Proposed-binding). **This increment implements the CBD-73 transitions in the left column and defers the right column; a deferred transition keeps the customer-visible outcome CBD-73 assigns it, never a different one.**

| Implemented now | Transition | Deferred, with the outcome preserved |
| --- | --- | --- |
| Create real invitation (Primary Owner or Co-owner; Collaborator or Co-owner role) | `TR-73-01` | Viewer and Accountability Partner invitations (`role_not_permitted` at the route until their disclosure kinds and `p` cells exist) |
| Generate code and dispatch through the **simulated local delivery adapter** (§5.3) | `TR-73-02` | Provider delivery, `TR-73-03`/`TR-73-04` callbacks, `TR-73-19`; the adapter records `Pending` and never `Delivered`/`Failed` |
| Resend / replace, cancel, expire by timestamp | `TR-73-05`, `TR-73-06`, `TR-73-07` | The cause-neutral resend prompt `MSG-73-053` (no scheduler in the prototype) |
| Resolve code, verify invited channel, decline once, attach account, disclose, acceptance action | `TR-73-08`, `TR-73-09`, `TR-73-11`, `TR-73-10`, `TR-73-38` | Decline-and-block `TR-73-12`, inviter block `TR-73-29`, pair limiter §8.3, notification-only destination `TR-73-36`/`TR-73-37` (`OI-73-002`, `OI-73-010`) |
| Confirm or reject the accepting account, commit acceptance | `TR-73-39`, `TR-73-13` | — |
| Synthetic suppressed invitation for the two private states the prototype can produce: already-active member and self-invitation | `TR-73-15`, `TR-73-16`, `TR-73-17`, `TR-73-18` | Block and pair-limit suppression classes (`OI-73-010`); the record shape is the same so nothing is redesigned when they land |
| Invalid code presentation | `TR-73-14` | Abuse fingerprint feed to `FU-95-015` (recorded, not acted on) |
| Primary transfer: propose, recipient accept, Primary confirm, commit, decline, withdraw, expire/invalidate, deny | `TR-73-40`–`TR-73-47` | Closure of a prior Viewer profile or Partner state (no such state exists in the prototype) |
| Membership read for active members | CBD-72 row 1 | Revocation and removal `TR-73-30`–`TR-73-35` and the `RC-73-*` checklist: **the next packet**, not this one; §7 widens the membership status CHECK now so that packet needs no second widening |

Two CBD-73 mechanics are implemented exactly rather than simplified, because each is normative and each shapes the schema: the intended-recipient confirmation (`OI-73-001`, `IC-73-004`) and the authoritative-by-timestamp expiry (`IC-73-016`). The simulated delivery adapter is the CBD-190 local Cognito-shaped adapter pattern applied to `MSG-73-002`: it carries `FIDELITY_LABEL = "simulated"`, exists only under `PROVIDERS-LOCAL-001`, and must be replaced, not toggled, before any hosted environment (§5.3).

## 4. The invitation record and its states

`IV-002` (Proposed-binding). **`budget_space_invitation` is the physical `DR-73-01` record, budget-space scoped, one row per real or synthetic invitation, with authoritative state separate from the customer projection.** Its companion records are the code verifier (`DR-73-02`), the ceremony binding (`DR-73-03`), and the intended-recipient confirmation (`DR-73-13`). All four are `-- scope: budget-space` and gain `PRODUCTION_TABLE_CATALOG` rows in the same change (`PK-2`).

### 4.1 `budget_space_invitation`

| Column | Type and constraint | Meaning | Traced to |
| --- | --- | --- | --- |
| `invitation_id` | `uuid` PK, server-generated | Opaque identifier; the customer projection's identity is the predecessor/successor chain, not this id | `DR-73-01`; CBD-82 §3 opaque identifiers |
| `budget_space_id` | `uuid` NOT NULL FK `budget_space` DEFERRABLE INITIALLY DEFERRED | The one space | `IC-73-012` |
| `kind` | `text` CHECK IN (`'real'`, `'synthetic'`) | Real or synthetic suppressed record (§4.5 of CBD-73) | `DR-73-10` |
| `created_by_membership_id`, `created_by_subject_id` | `uuid` NOT NULL; composite FK `(budget_space_id, created_by_membership_id)` → `budget_space_membership` | The creating membership | `DR-73-01` "creating membership" |
| `required_permission` | `text` CHECK IN (`'24'`, `'26'`) | The exact CBD-72 permission the creation required; loss of it cancels the invitation (`TR-73-06` system path, rule 7) | `DR-73-01`; §4.4 rule 7 |
| `creating_authorization_version` | `integer` NOT NULL CHECK ≥ 1 | The creator's `authorization_version` at creation | `DR-73-01` |
| `channel_type` | `text` CHECK IN (`'email'`) | Only email in the prototype; `'sms'` is a later widening | `DR-73-01`; CBD-73 §2 |
| `destination_token` | `text` NOT NULL | The canonical, privacy-preserving normalized-destination token (HMAC over the lower-cased, trimmed address with the field-encryption key derivation of CBD-246); never the raw address | `DR-73-01`; §4.4 rule 4; `OI-73-010` for the eventual alias rule |
| `destination_ciphertext` | `bytea` NOT NULL | The raw address, envelope-encrypted with the existing `COBUDGET_FIELD_ENCRYPTION_*` provider, readable only by the delivery adapter and the masked-projection reader | `DR-73-02` custody boundary applied to the destination |
| `destination_masked` | `text` NOT NULL | The owner-visible masked form (`a***@example.com`) | CBD-72 §5.7 "masked invitation channel" |
| `proposed_role` | `text` CHECK IN (`'collaborator'`, `'co_owner'`) in this migration | The one role offered | `DR-73-01`; `IV-001` |
| `resource_scope` | `text` CHECK `'full'` | Viewer profiles are absent | CBD-73 §2 |
| `disclosure_kind`, `disclosure_version`, `disclosure_digest` | `text`, `integer` ≥ 1, `text` | The registry entry current at creation; acceptance against another version denies `stale_disclosure` | CBD-73 §6 rule 3; `CF-236-005` |
| `policy_version`, `policy_digest` | `text` NOT NULL | The tuple of the allow decision that created it | `PC-236-012` |
| `invitation_version` | `integer` NOT NULL DEFAULT 1 CHECK ≥ 1 | Fixed at 1 for a record; a replacement is a successor row (§4.3) | `DR-73-01`; `TR-73-05` |
| `state` | `text` CHECK IN (`'created'`, `'pending'`, `'awaiting_confirmation'`, `'accepted'`, `'declined'`, `'expired'`, `'superseded'`, `'cancelled'`, `'synthetic_created'`, `'synthetic_pending'`, `'synthetic_inactive'`) | Authoritative state; `delivered` and `failed` are absent by `IV-001` and are the first widening when a provider lands | CBD-73 §4.1 |
| `state_version` | `integer` NOT NULL DEFAULT 1 | Optimistic version for every transition | `IC-73-011` |
| `issued_at`, `expires_at` | `timestamptz` NOT NULL | Authoritative expiry; every ceremony step and commit requires server time strictly before it | `IC-73-016` |
| `projection_inactive_at` | `timestamptz` NOT NULL, immutable, equal to `expires_at` for a real record | The customer projection deadline | CBD-73 §4.5 |
| `projection_state` | `text` CHECK IN (`'pending'`, `'accepted'`, `'replaced'`, `'cancelled'`, `'no_longer_active'`) | The allowlisted inviter projection, separate from `state` | CBD-73 §4.5 items 1–3 |
| `private_terminal_cause` | `text` NULL CHECK IN (`'already_member'`, `'self_invitation'`, `'stale_after_membership_end'`, `'permission_lost'`, `'sibling_accepted'`) | Restricted; never projected | `DR-73-01`, `DR-73-10`; `AE-73-27` classes |
| `predecessor_invitation_id`, `successor_invitation_id` | `uuid` NULL FK self | The `TR-73-05` chain | `DR-73-01` |
| `candidate_subject_id` | `uuid` NULL FK `account_subject` | The durable candidate-account binding written by `TR-73-10`; invalidated (set NULL, with `state_version` bump) at membership end | `DR-73-01`; `IC-73-017` |
| `accepted_membership_id` | `uuid` NULL; composite FK to `budget_space_membership` | Set only by `TR-73-13` | `AE-73-13` receipt |
| `commit_idempotency_key`, `commit_request_digest`, `committed_response` | `text` NULL, `text` NULL, `jsonb` NULL | The `TR-73-13` idempotency receipt, in the CBD-233 `budget_creation_idempotency` shape | CBD-275-AC03/AC04 |
| `created_at`, `updated_at` | `timestamptz` | — | — |

Constraints and behaviour:

* **One dispatched real invitation per (space, destination token) at a time.** Partial unique index on `(budget_space_id, destination_token) WHERE kind = 'real' AND state IN ('created','pending','awaiting_confirmation')`; a second create for the same destination routes `TR-73-05` (§4.4 rule 4).
* **Identity columns are write-once**: a `BEFORE UPDATE` trigger in the shape of `forbid_budget_space_membership_identity_mutation` rejects changes to every column except `state`, `state_version`, `projection_state`, `private_terminal_cause`, `successor_invitation_id`, `candidate_subject_id`, `accepted_membership_id`, the three idempotency columns, and `updated_at`.
* **Transitions are closed**: the same trigger admits only the edges of CBD-73 §4.2 (plus the synthetic edges of `TR-73-16`/`TR-73-17`/`TR-73-18`), so an `accepted` row can never leave `accepted` and a `declined` row can never become `awaiting_confirmation`. This is the mechanical half of CBD-41-AC06; the application half is the state service in `PK-5`.
* **`REVOKE DELETE`** from `cobudget_api` and `cobudget_worker` (`IC-73-018` pattern).

### 4.2 `budget_space_invitation_code` (`DR-73-02`)

One row per dispatched real invitation: `invitation_id` (unique), `verifier_digest` (the one-way verifier: HMAC-SHA-256 over the raw bearer, keyed by the field-encryption provider and bound to `invitation_id`, `invitation_version`, and `destination_token`), `issued_at`, `expires_at` (equal to the invitation's), `disposition` CHECK IN (`'active'`, `'consumed'`, `'invalidated'`), `disposition_reason_class`, `disposition_at`, `abuse_fingerprint` (a non-reversible fingerprint of the raw value for `TR-73-14`, never the value). The raw bearer exists only in the simulated delivery outbox row (§5.3) and in the recipient's link. The code encodes nothing (`IC-73-002`). A `created` invitation has no row; `TR-73-02` inserts exactly one.

### 4.3 Resend and replacement

`IV-003` (Proposed-binding). **Resend and replacement follow `TR-73-05`: the predecessor becomes `superseded` with its code `invalidated`, and exactly one successor row is created through `TR-73-01` (or `TR-73-15`) with `predecessor_invitation_id` set, in one transaction.** The customer projection retires the predecessor as `replaced` immediately and shows the successor as `pending`; the inviter sees one request chain, not two records. This is also what CBD-276-AC04 requires ("replacement invalidates the prior code before the new version is deliverable; a concurrent race leaves exactly one usable version": the partial unique index of §4.1 and `SERIALIZABLE` isolation make the race lose).

**Reported cross-package conflict, not resolved here.** CBD-41-AC07 says "Resend preserves invitation identity and current disclosure when still valid; replacement invalidates the prior code and version before the new code becomes usable." Read literally, resend keeps the same record and replacement makes a new one. The approved specification's `TR-73-05` makes both a successor record. This document follows the approved specification and reports the wording to the Scrum role (§17 item 14); the projection chain gives the "preserved identity" the criterion is after, so the criterion's intent is met either way.

### 4.4 `budget_space_invitation_ceremony` (`DR-73-03`)

One row per `TR-73-08` resolution: `ceremony_id` PK; `budget_space_id`, `invitation_id`; `ceremony_secret_digest` (the digest of the opaque, one-time ceremony token the server sets as the `__Host-mp_invitation_ceremony` cookie, `HttpOnly`, `SameSite=Strict`; the token is never the reconciliation code); `is_current` with a partial unique index `(invitation_id) WHERE is_current` so at most one ceremony per invitation is current; `channel_proof_state` CHECK IN (`'none'`, `'challenged'`, `'proved'`, `'exhausted'`), `channel_challenge_digest`, `channel_attempts` CHECK ≤ the bounded attempt count, `channel_proved_at`; `attached_subject_id` NULL FK `account_subject`, `attached_session_ref`, `attached_at`; `primary_contact_match` NULL boolean (restricted evidence only, `IC-73-005`); `disclosure_kind`, `disclosure_version`, `disclosure_digest` as shown at step 5; `acceptance_action_at` NULL (the `TR-73-38` action); `accepted_disclosure_version` NULL (the version the person acted on, compared at commit); `state` CHECK IN (`'open'`, `'declined'`, `'accepted_pending_confirmation'`, `'consumed'`, `'invalidated'`); `expires_at` (its own, no later than the invitation's); `environment` (the CBD-232 §8.1 environment key, so a ceremony from another environment is unreadable). `REVOKE DELETE`.

The ceremony row is the invitee's subject-owned target for the subject-scoped cells of §11.3 once `attached_subject_id` is set: the assembler loads it by `(environment, attached_subject_id, ceremony_id)` exactly as the proposal store loads a proposal, and copies `attached_subject_id` and `environment` into `resource.owningSubjectId` and `resource.environmentId` (CBD-236 §4.4).

### 4.5 `budget_space_invitation_confirmation` (`DR-73-13`)

One row per `TR-73-38`: `confirmation_id` PK; `budget_space_id`, `invitation_id`, `ceremony_id`; `acceptor_subject_id`; `displayed_identity_version` (the display-identity value shown to the confirmer, §9); `binding_rule_id` = `'CBD-73-5.1'`, `binding_rule_version` = 1; `state` CHECK IN (`'requested'`, `'confirmed'`, `'rejected'`, `'expired'`); `expires_at`; `decided_by_membership_id`, `decided_by_subject_id`, `decided_at`, `decided_authorization_version`; `committed_consent_id` NULL FK `budget_space_consent` (set by `TR-73-13`). Retained as authority evidence under `IC-73-018`; `REVOKE DELETE`.

### 4.6 Transition table, as the prototype executes it

| CBD-73 | Actor and route (§5) | Precondition checks in the transaction | Effect | Audit (`AE-73-*`, §13) |
| --- | --- | --- | --- | --- |
| `TR-73-01` | Owner, `POST .../invitations` | `24.invite_nonowner` or `26.invite_coowner` allow; space `live`; destination canonicalized; proposed role admitted; no self-invitation; no active member with this subject (both otherwise route `TR-73-15`) | `created` row, then in the same transaction `TR-73-02` | `AE-73-01`; denial `AE-73-31` |
| `TR-73-02` | System, same transaction | `created`, no code row | One raw bearer generated, verifier stored, outbox row written (§5.3), state `pending`, `projection_state` `pending` | `AE-73-02` |
| `TR-73-05` | Owner, `POST .../invitations/{id}/replace` | Same permission as creation, current versions, predecessor projection active | Predecessor `superseded`, code `invalidated`, every current ceremony `invalidated`; successor through `TR-73-01`/`TR-73-15` | `AE-73-05` (+ successor's `AE-73-01`/`AE-73-02`); denial `AE-73-31` |
| `TR-73-06` | Owner, `DELETE .../invitations/{id}`; or system under rule 6/7 or sibling cancellation | Actor path: permission and versions current, projection active | Real: `cancelled`, code `invalidated`, ceremonies `invalidated`; synthetic: `synthetic_inactive`; actor path retires the projection as `cancelled`, system path leaves it `pending` until `TR-73-07` | `AE-73-06`; denial `AE-73-31` |
| `TR-73-07` | Any request that observes `now() >= expires_at` on an active record (there is no scheduler) | — | `expired` (or `synthetic_inactive`), projection `no_longer_active`, code `invalidated` | `AE-73-07` once |
| `TR-73-08` | Link holder, `POST /v1/invitations/resolve` (pre-authentication) | Verifier matches one `pending` real record; before expiry | Prior current ceremony `invalidated`; one new current ceremony; cookie set; response carries only `ceremonyId` and the ceremony-entry minimum (§7.1 item 2 of CBD-73) | `AE-73-08`; rate denial `AE-73-31` |
| `TR-73-09` | Link holder, `POST /v1/invitations/{ceremonyId}/verify-channel` | Current ceremony; the simulated adapter's challenge code (§5.3) matches within bounded attempts | `channel_proof_state` `proved` | `AE-73-09` per attempt |
| `TR-73-11` | Verified controller, `POST /v1/invitations/{ceremonyId}/decline` (no account needed) | Proof `proved`; before expiry | Invitation `declined`, code `invalidated`, ceremony `declined`; projection stays `pending` until `TR-73-07` | `AE-73-11` (restricted) |
| `TR-73-10` | Authenticated invitee, `POST /v1/invitations/{ceremonyId}/attach` | Proof `proved`; live session; subject active with one active profile (`CBD190-PROFILE-ATOMIC-001`); not already an active member (else `TR-73-06` privately, `already_member`); invitation issued after this subject's latest membership end in the space (`IC-73-017`) | `attached_subject_id`, `attached_session_ref`, `primary_contact_match` (restricted), invitation `candidate_subject_id` | `AE-73-10`; private `AE-73-06` |
| Disclose | Authenticated invitee, `GET /v1/invitations/{ceremonyId}` | Attached; current | Returns the full §6 disclosure for `proposed_role` with kind/version, the two-way statement, the §5.1 item 4 confirmation notice, and the unselected accept/decline choice | none (read) |
| `TR-73-38` | Authenticated invitee, `POST /v1/invitations/{ceremonyId}/accept` with `acknowledgedDisclosure { kind, version }` | Attached; proof current; before expiry; claim equals the registry's current entry for the kind **and** the invitation's stored version (else `stale_disclosure`, nothing written); no active/stale membership (recheck) | Ceremony `accepted_pending_confirmation`, `acceptance_action_at`; invitation `awaiting_confirmation`; one `confirmation` row `requested` with its own expiry; **no consent row yet** (there is no membership to reference; the ceremony and confirmation rows are the pending, non-authorizing evidence CBD-73 requires) | `AE-73-32 confirmation_requested`, `AE-73-30` owner notice |
| `TR-73-39` + `TR-73-13` | Owner holding the exact creating permission, `POST .../invitations/{id}/confirm` with `confirmationIdempotencyKey`; or `.../reject` | §8 | Confirm: §8 acceptance transaction. Reject: confirmation `rejected`, invitation `cancelled`, code `invalidated`, ceremony `invalidated`; projection `cancelled` | `AE-73-32 confirmation_confirmed` + `AE-73-13` + `AE-73-30`; or `AE-73-32 confirmation_rejected` + `AE-73-06` + `AE-73-30` |
| `TR-73-14` | Anyone, `POST /v1/invitations/resolve` with an unknown, malformed, terminal, or expired code | — | No state change except the `TR-73-07` materialization of an expired active record; uniform `MSG-73-003` envelope | `AE-73-14` (nullable global envelope for unknown values) |
| `TR-73-15`–`TR-73-18` | System inside `TR-73-01`/`TR-73-05`; owner cancel | Already-active member or self-invitation | `synthetic_created` → `synthetic_pending` in the same transaction (the "equivalence schedule" is immediate in the prototype), no code, no outbox; projection identical to real | `AE-73-01` customer-safe + `AE-73-27` restricted |

## 5. The acceptance ceremony over HTTP, and the identity path

### 5.1 Routes

`IV-004` (Proposed-binding). **The invitation surface is these routes and no others; each carries the CBD-236 action in §11 and the CBD-266 registration in §12.**

| Route | Actor | Authorization | Notes |
| --- | --- | --- | --- |
| `POST /v1/budget-spaces/{budgetSpaceId}/invitations` | Owner | `24.invite_nonowner` (Collaborator) or `26.invite_coowner` (Co-owner), selected server-side from the body's `proposedRole` before `decide` | Body: `{ channel: "email", destination, proposedRole, idempotencyKey }`; response: the customer projection only |
| `GET /v1/budget-spaces/{budgetSpaceId}/invitations` | Owner | `24.view_invitations` (new, §11.2) | Projection list; real and synthetic indistinguishable |
| `POST /v1/budget-spaces/{budgetSpaceId}/invitations/{invitationId}/replace` | Owner | `24.replace_invitation` or `26.invite_coowner` per the record's `required_permission` | `TR-73-05`; `24.resend_invitation` is the same transition and route with `mode: "resend"` (`OQ-IV-002`) |
| `DELETE /v1/budget-spaces/{budgetSpaceId}/invitations/{invitationId}` | Owner | `24.revoke_nonowner` or `26.invite_coowner` per `required_permission` | `TR-73-06` actor path |
| `POST /v1/budget-spaces/{budgetSpaceId}/invitations/{invitationId}/confirm` | Owner | `24.confirm_acceptance` or `26.confirm_acceptance` (new, §11.2) | `TR-73-39` confirm + `TR-73-13`; idempotent on `confirmationIdempotencyKey` |
| `POST /v1/budget-spaces/{budgetSpaceId}/invitations/{invitationId}/reject` | Owner | same codes as confirm | `TR-73-39` reject |
| `GET /v1/budget-spaces/{budgetSpaceId}/members` | Any active member | `1.view_members` (new, §11.2) | Display identity, role, joined-at; never contact, personal state, or other-space data |
| `POST /v1/invitations/resolve` | Link holder | none (pre-authentication ceremony surface, `authorization_metadata_id` null with reason, like `/v1/identity/begin`) | `TR-73-08`/`TR-73-14`; sets the ceremony cookie |
| `POST /v1/invitations/{ceremonyId}/verify-channel` | Link holder | none (ceremony cookie) | `TR-73-09` |
| `POST /v1/invitations/{ceremonyId}/decline` | Verified controller | none (ceremony cookie); works with or without a session | `TR-73-11` |
| `POST /v1/invitations/{ceremonyId}/attach` | Authenticated invitee | `invitation.attach` (subject-self, §11.3) plus the ceremony cookie | `TR-73-10` |
| `GET /v1/invitations/{ceremonyId}` | Authenticated invitee | `invitation.read_ceremony` (subject-target) | The disclosure surface |
| `POST /v1/invitations/{ceremonyId}/accept` | Authenticated invitee | `invitation.accept` (subject-target) | `TR-73-38` |

The pre-authentication trio carries no `@Authorize` decision, exactly as the identity ceremony routes do today (`apps/api/src/authorization/http.ts` lists them as ceremony surfaces), and each is registered with an explicit reason. They grant nothing: the only effects are a ceremony row, a proof state, and a decline.

### 5.2 The ceremony as a fixed partial order

CBD-73 §5 is enforced server-side by the ceremony row's state, never by the client: `attach` requires `channel_proof_state = 'proved'`; the disclosure read and `accept` require `attached_subject_id`; `accept` requires the disclosure claim; `confirm` requires a `requested` confirmation. A request out of order denies with the uniform envelope and changes nothing. A new `resolve` for the same invitation invalidates the previous ceremony (§4.4 rule and `TR-73-08`), so a leaked link cannot ride an in-progress ceremony.

### 5.3 The simulated local delivery adapter

`IV-005` (Proposed-binding). **Under `PROVIDERS-LOCAL-001` the prototype has no email provider. `TR-73-02` writes the raw bearer to `budget_space_invitation_outbox` (identity scope, envelope-encrypted, `custody_deadline` = the invitation expiry) and a local-only delivery adapter, labelled `FIDELITY_LABEL = "simulated"` like the CBD-190 local adapter, renders the link and the channel-verification challenge on a developer-only surface (`GET /v1/local/invitation-deliveries`, present only when `COBUDGET_IDENTITY_PROVIDER=local`, registered as a bounded local surface, refused at startup in any other configuration).** The channel challenge is a six-digit code the same adapter "delivers" to the same surface, so `TR-73-09` is exercised end to end with the real bounded-attempt logic. The outbox row is tombstoned when the code is consumed or invalidated or at the custody deadline, whichever is first (`DR-73-02`). This is a tolerated absence of provider delivery for a synthetic-identity prototype, not a delivery design; the provider adapter, callbacks, and the `Delivered`/`Failed` widening are a later packet under `OI-73-008` custody evidence.

### 5.4 The invitee who has no account yet

`IV-006` (Proposed-binding). **An invitee without an account runs the ordinary CBD-190 ceremony and returns to the invitation; nothing about the invitation creates, names, or pre-fills an account.** Sequence: resolve → verify channel → (optional decline) → the ceremony surface offers "Sign in or create your MoneyPact account" → `POST /v1/identity/begin` with `ceremony: "sign_in"` and a `returnTo` of the ceremony page (the CBD-190 challenge already binds a return location; the invitation ceremony id is carried only in the `__Host-mp_invitation_ceremony` cookie, never in the identity challenge) → the local chooser creates or selects a local identity → CBD-190 commits subject, active profile, binding, and hand-off atomically (`CBD190-PROFILE-ATOMIC-001`) → CBD-191 issues the session → the browser returns to the ceremony page → `attach` binds the session subject to the ceremony. Because `CBD191-ZERO-MEMBERSHIP-001` keeps a subject with zero memberships authenticated, the invitee's session is ordinary from the first moment; `membership.list_own` shows nothing until `TR-73-13` commits. An existing account with a different primary contact attaches the same way (CBD-73-AC17, CBD-274-AC01/AC02): the ceremony compares nothing but records `primary_contact_match` as restricted evidence, and the disclosure surface shows nothing of that account's other spaces. Account switch (`CBD-190` §5.4) invalidates the ceremony binding (`attached_subject_id` cleared, ceremony `invalidated`), and the person resolves the link again.

## 6. Disclosure kinds, texts, and the two-way statement

`IV-007` (Proposed-binding). **One disclosure kind per role and per ceremony, each dense from version 1 in `config/consent-disclosure-registry.json`, each with its approved text under `docs/consent-disclosures/`.** A role's permitted actions and restrictions (CBD-73 §7.2 item 2) differ per role, and the registry pins text, so a per-role kind is the only shape under which "the version the person saw" is one digest. The kinds this increment registers:

| Kind | Version | Ceremony | Content file |
| --- | --- | --- | --- |
| `invitation_collaborator` | 1 | `TR-73-38` for a Collaborator invitation | `docs/consent-disclosures/invitation-collaborator.v1.json` |
| `invitation_co_owner` | 1 | `TR-73-38` for a Co-owner invitation | `docs/consent-disclosures/invitation-co-owner.v1.json` |
| `primary_transfer_recipient` | 1 | `TR-73-41` | `docs/consent-disclosures/primary-transfer-recipient.v1.json` |
| `primary_transfer_outgoing` | 1 | `TR-73-42` | `docs/consent-disclosures/primary-transfer-outgoing.v1.json` |

`invitation_viewer`, `invitation_accountability_partner`, and `membership_change` are named here so the CHECK list in §7 can carry them, but no text is registered and no route offers them in this increment (the startup guard requires only the kinds the running routes need).

**Semantic content of `invitation_collaborator` v1** (restating CBD-73 §7.2 for the prototype; items 5 and 9 omitted as in `CF-236-002` because alerts and destinations do not exist; item 8's choice is the surface's, not the text's):

| Item | Content | CBD-73 §7.2 |
| --- | --- | --- |
| 1 | The budget space by name and the inviting member's display identity (§9) | 1 |
| 2 | The role Collaborator, in approved terminology: an equal financial contributor and full-budget planning participant; may create and edit plans, targets, categories, manual accounts and manual transactions, and read every shared financial record; may not administer members, invitations, ownership, shared settings, another person's bank connection, or the space's lifecycle (CBD-72 §2.2) | 2 |
| 3 | What the person will see: the approved full shared financial scope of this space; no actual financial data is shown before acceptance | 3 |
| 4 | The two-way view: existing members will see the person's display identity, role, and attributed activity; personal settings, personal alert state, and other-space memberships remain private. **Before anything is shared, the inviting owner will see the person's display identity and must confirm the acceptance** (CBD-73 §5.1 item 4) | 4; §5.1 |
| 6 | Leaving and removal: the person may leave at any time without anyone's approval; the Primary Owner or a Co-owner may remove them; nothing here can remove or demote the Primary Owner; contributed records stay in the space attributed to them | 6 |
| 7 | Accepting activates the role immediately once the owner confirms; no payment, financial, legal, or bank-account authority is created; nothing moves money | 7 |
| 8 | Accepting or declining is the person's explicit choice, presented without a default; declining ends only this invitation | 8 |

`invitation_co_owner` v1 differs in item 2 (day-to-day administration including inviting and removing non-owner members and administering shared settings; cannot remove or demote the Primary Owner, transfer primary ownership, or delete or archive the space) and item 6 (only the Primary Owner may remove a Co-owner, through a protected action). `primary_transfer_recipient` v1 states, per CBD-72 §6.2 step 2 and `TR-73-40`: full financial and administrative access, the protected Primary powers, that the prior role ends, that no bank-connection authority moves, that the outgoing Primary becomes a Co-owner, and that as sole Primary the person's only exits will be transfer and archival. `primary_transfer_outgoing` v1 states, per `TR-73-42` "explicit named consequences": the named recipient becomes sole Primary, the person becomes a Co-owner and loses the Primary-only powers including inviting Co-owners, existing Co-owners are unchanged, connection authority does not move, and every invitation the person created under permission 26 is cancelled at commit.

Each file follows the `primary-owner-self.v1.json` shape (`kind`, `version`, `heading`, `items[]`, `acknowledgement`), the acknowledgement sentence names the role and the space ("I have read the items above and I agree to join this budget space as a Collaborator"), and `approved_by` in the registry cites the §17 decision. Copy labels must say the record proves an explicit product action and not that agreement was free or voluntary (CBD-287-AC06; `RI-93-016`; CBD-73 §6 rule 5).

## 7. The widening migration and the new tables

`IV-008` (Proposed-binding). **`PK-2` lands three forward-only migrations in this order, and no packet inserts a membership or a non-self consent row until `M1` is on `main`.** All three follow `config/migrations.json`: `timestamptz` only, no transaction control, `-- scope:` headers, catalog rows in the same change, `npm run check:migrations` and the live `db:reset / db:migrate / db:verify` proof in the gate.

### 7.1 `M1` — `widen_membership_and_consent_for_invitations`

* `budget_space_membership.role` CHECK → `IN ('primary_owner', 'co_owner', 'collaborator', 'viewer', 'accountability_partner')`; `status` CHECK → `IN ('active', 'revoked', 'removed')`; new columns `ended_at timestamptz NULL`, `ended_reason_class text NULL`, `ended_by_event_id uuid NULL`, with `CHECK ((status = 'active') = (ended_at IS NULL))` (the `DR-73-09` half this increment needs so the revocation packet needs no second widening); new partial unique index `budget_space_membership_one_active_per_subject ON (budget_space_id, account_subject_id) WHERE status = 'active'` (CBD-72 §2.1 one active role per person per space); `budget_space.primary_ownership_version integer NOT NULL DEFAULT 1 CHECK ≥ 1`, incremented by `TR-73-43`, which is the datastore source of `ApiUserCapturedVersions.primaryOwnershipVersion` (the assembler emits no such column today, `OQ-IV-004`). The inline CHECKs carry PostgreSQL's generated names (`budget_space_membership_role_check`, `budget_space_membership_status_check`); the migration drops and re-adds them by those names and `db:verify` proves the new definitions. `ALTER TABLE ... DROP CONSTRAINT` is not a destructive pattern under `config/migrations.json`, so no contract-step header is needed.
* `budget_space_consent.role` CHECK → the same five roles; `source` CHECK → `IN ('self_disclosure', 'invitation_acceptance', 'membership_change', 'primary_transfer')`; `disclosure_kind` CHECK → `IN ('primary_owner_self', 'invitation_collaborator', 'invitation_co_owner', 'invitation_viewer', 'invitation_accountability_partner', 'membership_change', 'primary_transfer_recipient', 'primary_transfer_outgoing')`; `resource_scope` stays `'full'`; new column `source_ceremony_id uuid NULL` (the `DR-73-04` "ceremony correlation", answering the first half of `OQ-CF-005`, `IV-014`); `budget_space_consent_subject_matches_membership()` replaced (`CREATE OR REPLACE FUNCTION`) to also require `NEW.recorded_by_subject_id = NEW.account_subject_id` (`IV-013`, closing `SEC-F04`).
* Every trigger, index, and `REVOKE` of `20260914T170000Z` is untouched; the migration writes, alters, and synthesizes no row; there is no backfill and nothing to backfill.
* The consent landing deleted the interim derivation and the test that pinned the CBD-231 CHECK literals; `PK-2` greps for any surviving pin of `role = 'primary_owner'` or `status = 'active'` in tests and reports it before widening.

### 7.2 `M2` — `create_budget_space_invitation`

`budget_space_invitation`, `budget_space_invitation_code`, `budget_space_invitation_ceremony`, `budget_space_invitation_confirmation` (§4), `budget_space_invitation_outbox` (identity scope; §5.3), and `budget_space_lifecycle_audit` (§13), with their triggers, partial unique indexes, `REVOKE DELETE`, and table comments citing the `DR-73-*` rows. The account-subject and membership foreign keys are `DEFERRABLE INITIALLY DEFERRED` (CBD-231 §3.2 pattern).

### 7.3 `M3` — `create_budget_space_primary_transfer`

`budget_space_primary_transfer` (`DR-73-12`; §10) and `account_lifecycle_notice` (identity scope; §13), with catalog rows.

## 8. The acceptance transaction (`TR-73-39` confirm plus `TR-73-13`)

`IV-009` (Proposed-binding). **The confirming owner's request runs one `SERIALIZABLE` transaction that writes the confirmation, the membership, the consent row, the invitation and code terminal states, the audit group, and the notice enqueue rows, or nothing.** Under CBD-236 `PC-236-014` the route prechecks `24.confirm_acceptance` (or `26.`), discharges nothing (no protected obligation), and inside the transaction reloads every authority source, re-evaluates, and only then applies the effect through the runtime mutation seam. Ordering inside the transaction is free with respect to the deferred triggers (`SEC-F02` (a), probe T2); the order below is chosen so that every denial happens before the first write.

1. Look up `commit_idempotency_key` for this invitation scoped by the acting subject; an equal digest returns `committed_response`; an unequal digest denies `idempotency_key_reused` (CBD-233 pattern; CBD-275-AC04).
2. `SELECT ... FOR UPDATE` the invitation; require `state = 'awaiting_confirmation'`, `now() < expires_at`; the confirmation row `requested` with `now() < confirmation.expires_at`; the ceremony `accepted_pending_confirmation` and `is_current`, `channel_proof_state = 'proved'`, `attached_subject_id = confirmation.acceptor_subject_id`.
3. Disclosure: `ceremony.accepted_disclosure_version = invitation.disclosure_version` and the registry's current entry for `invitation.disclosure_kind` still has that version and digest; otherwise deny `stale_disclosure` (`TR-73-13` "acceptance against a stale disclosure version is denied at commit"; CBD-41-AC02; CBD-274-AC04). Nothing has been written.
4. Inviter authority: the commit-time `decide` for the confirm action carries the confirmer's reloaded membership, consent, and `authorization_version`; `required_permission` of the invitation equals the cell's permission.
5. Invitee eligibility: `account_subject` active; exactly one active `financial_profile` (its `profile_id` is what `budget_space_membership.profile_id` must carry, since the identity foreign key of `20260913T100100Z` requires the pair); no active membership for this subject in this space (the new partial unique index also enforces it); invitation `issued_at` after the subject's latest `ended_at` in this space (`IC-73-017`).
6. Role cardinality: a Co-owner invitation adds a Co-owner (multiple permitted); never a second Primary (the CBD-231 index).
7. **Insert the membership**: `membership_id` server-allocated; `budget_space_id`; `profile_id`, `account_subject_id` from step 5; `role = invitation.proposed_role`; `status = 'active'`; `authorization_version = 1`; `created_by_subject_id = confirmer`.
8. **Insert the consent row**: `consent_id` server-allocated; `membership_id` from step 7; `account_subject_id` **and** `recorded_by_subject_id` = the invitee (`IV-013`); `role = proposed_role`; `resource_scope = 'full'`; `source = 'invitation_acceptance'`; `source_record_id = invitation_id`; `source_record_version = invitation_version`; `source_ceremony_id = ceremony_id`; `disclosure_kind`, `disclosure_version`, `disclosure_digest` from the invitation, re-verified in step 3; `policy_version`, `policy_digest` from the confirm allow decision; `state = 'current'`; `assurance_ref` NULL (no protected obligation); `recorded_at = now()`; `supersedes_consent_id` NULL. `acknowledgedDisclosure` from the invitee's `accept` request was used only in the equality check at `TR-73-38` and again here; the recorded values come from the registry and the invitation, never from a request (`CF-236-005`).
9. Confirmation `confirmed` with `decided_by_*` and `committed_consent_id`; invitation `accepted`, `accepted_membership_id`, `projection_state = 'accepted'`; code `consumed`; ceremony `consumed`; every enumerable same-space sibling (`candidate_subject_id` = the invitee, active) `cancelled` with cause `sibling_accepted` (§4.4 rule 4 of CBD-73).
10. Audit group (§13): one `AE-73-32 confirmation_confirmed`, one `AE-73-13` transition receipt referencing the membership, consent, code, and confirmation rows, one `AE-73-06` per sibling, one `AE-73-30` enqueue for the invitee's `MSG-73-015` notice; the `PolicyAuditEvent` of the allow decision in the same commit (`PC-236-014` step 5).
11. Notice rows (§13): the invitee's mandatory in-app `MSG-73-015`; existing members' `MSG-73-019`.
12. Store the idempotency receipt; `COMMIT`. At commit the deferred triggers prove exactly one `current` consent for the new membership, subject coherence including `recorded_by`, and the identity foreign keys.

A rejection (`TR-73-39` reject) is the same route family without steps 5–8 and 10's `AE-73-13`; the acceptor's pending evidence closes as non-authorizing history by the ceremony's `invalidated` state and the confirmation's `rejected` state, and the acceptor receives the uniform `MSG-73-052` (CBD-73 §5.1 item 6: never who or why).

**Why the commit is inside the owner's request and not a worker.** CBD-73 makes `TR-73-13` a system transition on a current confirmation; putting it in the confirming transaction gives CBD-41-AC04 and CBD-275-AC01/AC02 their atomicity for free, keeps `apps/worker` without any membership path (so `SEC-F02`'s worker clause stays moot), and the reserved-unit and audit machinery already exists on the API side. A later worker-driven commit (for example after a provider callback) would use the same `PK-5` application function on the worker's transaction client and would need the parity mirror; nothing in the schema forbids it.

**Failure behaviour.** Every denial before step 7 writes nothing; `SEC-F03`'s note (inserts before the disclosure check) does not recur because step 3 precedes the first insert. A failure after step 7 rolls the whole transaction back (CBD-275-AC02). Two concurrent confirms serialize on the `FOR UPDATE` lock: the second sees `accepted` and returns the receipt if its key matches or denies `retryable_conflict`/`stale_version` otherwise (CBD-275-AC03).

## 9. Display identity (`DI-91-065`)

`IV-010` (Proposed-binding). **The prototype needs a safe display identity in three places — the disclosure's item 1, the confirmation prompt, and the members list — and no column exists for it today.** `account_subject` and `financial_profile` carry no display name (the CBD-212 comment only forbids deriving `profile_id` from one). Proposal: `financial_profile.display_name text NULL CHECK (char_length(display_name) BETWEEN 1 AND 80)` added in `M1` (identity scope, subject-owned, the `DI-91-065` class), set at first sign-in from the provider's name claim where present and otherwise from a subject-chosen value on the local chooser, editable only by the subject through a later profile route (`profile.update` is not a cell; the prototype sets it once at the ceremony). Until a value exists, surfaces show the neutral label "A MoneyPact member" and never the contact. This is a CBD-212 amendment for its owner (§14); §17 item 15 asks for the ruling.

## 10. Primary transfer as a consent-bearing membership change

`IV-011` (Proposed-binding). **The transfer is the CBD-73 §12 workflow over `budget_space_primary_transfer`; the commit `TR-73-43` runs inside whichever of `TR-73-41` or `TR-73-42` completes the pair, in one transaction that updates both memberships, supersedes both consent rows with new `primary_transfer` rows, moves `primary_owner_membership_id`, and bumps both `authorization_version`s and `primary_ownership_version`.**

### 10.1 `budget_space_primary_transfer` (`DR-73-12`)

`transfer_id` PK; `budget_space_id`; `proposer_membership_id` (the current Primary), `recipient_membership_id`, both composite FKs; `proposer_authorization_version`, `recipient_authorization_version`, `primary_ownership_version` captured at proposal; `recipient_disclosure_kind/version/digest` (`primary_transfer_recipient`), `outgoing_disclosure_kind/version/digest` (`primary_transfer_outgoing`); `state` CHECK IN (`'proposed'`, `'recipient_accepted'`, `'primary_confirmed'`, `'ready'`, `'committed'`, `'declined'`, `'withdrawn'`, `'expired'`, `'invalidated'`); `state_version`; `expires_at`; `recipient_accepted_at`, `recipient_accepted_version`; `primary_confirmed_at`, `primary_confirmed_version`, `primary_assurance_ref`; `committed_at`, `recipient_consent_id`, `outgoing_consent_id` (set at commit); `terminal_event_id`; `policy_version`, `policy_digest`. Partial unique index `(budget_space_id) WHERE state IN ('proposed','recipient_accepted','primary_confirmed','ready')` — one live workflow per space. Write-once identity columns; closed transitions; `REVOKE DELETE`.

### 10.2 Routes and cells

| Route | Actor | Cell (§11) | CBD-73 |
| --- | --- | --- | --- |
| `POST /v1/budget-spaces/{id}/primary-transfers` | Primary | `29.propose_primary_transfer` (mutate, Primary; new) | `TR-73-40` |
| `POST .../primary-transfers/{transferId}/accept` | Recipient (Co-owner or Collaborator in this increment) | `29.accept_primary_transfer` (mutate; Co-owner and Collaborator columns Allow) | `TR-73-41` |
| `POST .../primary-transfers/{transferId}/decline` | Recipient | `29.decline_primary_transfer` | `TR-73-44` |
| `POST .../primary-transfers/{transferId}/confirm` | Primary | `29.transfer_primary_ownership` (**protected**, `fresh_assurance`, existing `p1` code) | `TR-73-42`, and `TR-73-43` when this completes the pair |
| `POST .../primary-transfers/{transferId}/withdraw` | Primary | `29.withdraw_primary_transfer` (mutate, Primary) | `TR-73-45` |
| `GET .../primary-transfers/{transferId}` | Either party | `29.view_primary_transfer` (read; Primary, Co-owner, Collaborator) | status |

Ineligible or stale targets (self, a pending invitee, an ended member, a stale version) deny at `propose` without a workflow row (`TR-73-47`); a version change after proposal routes `TR-73-46` at the next step.

### 10.3 The commit transaction (`TR-73-43`)

Inside the completing request's `SERIALIZABLE` transaction, after its own precheck and commit-time `decide`:

1. `FOR UPDATE` the transfer, both memberships, and the space; require `state` about to become `ready`, both parties `active`, the proposer still the space's `primary_owner_membership_id`, both `authorization_version`s and `primary_ownership_version` equal to the captured values (else `TR-73-46` invalidate), server time before `expires_at`, and for the Primary's leg `assurance.level = 'fresh'` bound to `29.transfer_primary_ownership` and this space (§10.4).
2. Both disclosures still current in the registry at the captured versions (else `stale_disclosure`, nothing written).
3. `UPDATE` the recipient's current consent row → `superseded` (and the former Primary's → `superseded`), setting `ended_at`, `ended_reason_class = 'primary_transfer'`, `ended_by_event_id` (the `AE-73-25` id) — the `UPDATE`-then-`INSERT` order `SEC-F02` (c) requires.
4. `UPDATE` the former Primary's membership: `role = 'co_owner'`, `authorization_version + 1`. Then `UPDATE` the recipient's membership: `role = 'primary_owner'`, `authorization_version + 1` (this order keeps `budget_space_membership_one_active_primary_owner` satisfied at every statement). Then `UPDATE budget_space SET primary_owner_membership_id = recipient, primary_ownership_version = primary_ownership_version + 1`; the deferred `check_budget_space_creation_invariants` trigger proves at commit that the new reference is an active `primary_owner`.
5. `INSERT` the recipient's consent row: `role = 'primary_owner'`, `source = 'primary_transfer'`, `source_record_id = transfer_id`, `source_record_version = state_version` at acceptance, `disclosure_kind = 'primary_transfer_recipient'`, `supersedes_consent_id` = their prior row, `account_subject_id = recorded_by_subject_id` = the recipient, `assurance_ref` NULL, `state = 'current'`. `INSERT` the former Primary's row: `role = 'co_owner'`, `source = 'primary_transfer'`, `disclosure_kind = 'primary_transfer_outgoing'`, `supersedes_consent_id` = their `self_disclosure` row, both subject columns = the former Primary, `assurance_ref` = the fresh-assurance evidence reference, `state = 'current'`.
6. Cancel every active invitation whose `required_permission = '26'` and `created_by_membership_id` = the former Primary (`TR-73-06` system path, cause `permission_lost`), one `AE-73-06` each.
7. Transfer `committed`, `recipient_consent_id`, `outgoing_consent_id`, `committed_at`; `AE-73-25 transfer_committed` linking both consent rows, both membership versions, and the space version; two `AE-73-30` enqueues; the two `MSG-73-042` notice rows; the `PolicyAuditEvent`; idempotency receipt; `COMMIT`.

No membership is inserted, so the activation trigger does not fire; the pair of consent rows is nevertheless written because `CBD236-CONSENT-SEMANTICS-001` item 2 says transfer adds rows of the same shape, and because after step 4 each member's only `current` row would otherwise name the wrong role. The partial unique index makes step 5 impossible without step 3. `PC-236-015` is satisfied by step 4's version bumps, which also make every in-flight decision for either member deny `stale_version` at its own commit.

### 10.4 Fresh assurance is a prerequisite, not a detail

`IV-012` (Proposed-binding). **`29.transfer_primary_ownership` is a protected action; `decide` emits `fresh_assurance` and denies `assurance_required` unless `assurance.level = 'fresh'` with `boundAction`, `boundSpaceId`, `expiresAt` (evaluate.ts:293). The prototype's fact source emits only `assurance.level: "session"` (apps/api/src/sessions/fact-source.ts:55), so today the confirm route cannot allow, and CBD-236 `OQ-236-005` is still open.** The transfer packet (`PK-7`) therefore depends on a step-up packet (`PK-4`): a `step_up` ceremony kind in CBD-190's local adapter (the enum today is `register`, `verify`, `sign_in`, `enroll_factor`, `account_switch`; widening it is a CBD-190 amendment and an identity-scope migration), bound at `begin` to `{ action, spaceId }`, whose successful callback lets CBD-191 stamp the session with a fresh-assurance record valid for `COBUDGET_SESSION_FRESH_ASSURANCE_WINDOW_SECONDS` (already configured, 300 s in the inventory fixture), which the fact source then emits as `assurance.{level: "fresh", boundAction, boundSpaceId, expiresAt}` from `idp_evidence`. The design of that record belongs to the CBD-190/CBD-191 owners; this document only fixes the dependency and the shape `decide` already requires.

## 11. Policy version 4: the cells

`IV-015` (Proposed-binding). **`p4` is built from the `p3` tables byte-identical, appends the rows below, supersedes the five `p1` definitions named in §11.1, adds two resource types, and changes no evaluator, reason class, obligation kind, or input variant.** It follows the `p2`/`p3` discipline exactly: `policy/v4.ts`, registry entry, digest pinned as a test literal, `P4_NEGATIVE_FIXTURES` per §11.5, release only through `docs/cbd-236-p4-release-step.md` after Product Owner and Security sign-off (`CBD236-POLICY-APPROVAL-001`). Every cell value below is CBD-72's where a row exists (`HO-236-07`); where CBD-72 has no row, the table says so and §17 asks for the approval.

### 11.1 Superseded definitions and new resource types

`ResourceType` gains `"invitation"` (space-owned, `budget_space_invitation`) and `"invitation_ceremony"` (subject-owned, `budget_space_invitation_ceremony`); `schemaVersion` stays 1, as it did when `p2` added `proposal`. The `p1` definitions `24.invite_nonowner`, `24.resend_invitation`, `24.replace_invitation`, `24.revoke_nonowner`, and `26.invite_coowner` change `resourceType` from `membership` to `invitation` (an invitation is not a membership row; for create the target is the server-allocated candidate row, the `manual_account.create_manual_account` pattern). `24.remove_nonowner`, `25.*`, `26.assign_coowner`, `27.*`, `28.*` keep `membership` and are not exercised in this increment. Their `p1` entries are untouched.

### 11.2 New space-bound cells (permission keys are CBD-72 rows)

| Cell | Action code | Effect | Target | Primary Owner | Co-owner | Collaborator | Viewer, Partner | Obligations | Source |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 24 | `24.view_invitations` | read | `space` | Read | Read | absent | absent | `audit`, `bind_cache_key` | CBD-72 row 24 ("invitation ... resend/replacement ... notify safely and audit" presupposes the owner sees the projection); the read of the customer projection under §4.5 of CBD-73 |
| 24 | `24.confirm_acceptance` | mutate | `invitation` | Allow | Allow | absent | absent | `audit`, `invalidate`, `recheck_at_commit` | CBD-73 §5.1 item 2: "whoever currently holds the exact permission TR-73-01 required" |
| 26 | `26.confirm_acceptance` | mutate | `invitation` | Allow | absent | absent | absent | same | same, for a Co-owner invitation |
| 1 | `1.view_members` | read | `space` | Read | Read | Read | absent (Scoped/Read for Viewer and Partner are not mapped in this increment) | `audit`, `bind_cache_key` | CBD-72 row 1 "member identity and role are disclosed only when relevant to accessible content or interaction" and CBD-73 §7.2 item 4 (the two-way view promises exactly this) |
| 29 | `29.propose_primary_transfer` | mutate | `membership` (the recipient's) | Primary | absent | absent | absent | `audit`, `recheck_at_commit` | CBD-72 §6.2 step 1; `TR-73-40` |
| 29 | `29.accept_primary_transfer` | mutate | `membership` (own) | absent | Allow | Allow | absent | `audit`, `recheck_at_commit` | CBD-72 §6.2 step 3 "any other active Co-owner, Collaborator, Viewer, or Accountability Partner"; Viewer and Partner columns follow when their roles are mapped |
| 29 | `29.decline_primary_transfer` | mutate | `membership` (own) | absent | Allow | Allow | absent | `audit` | `TR-73-44` |
| 29 | `29.withdraw_primary_transfer` | mutate | `membership` | Primary | absent | absent | absent | `audit` | `TR-73-45` |
| 29 | `29.view_primary_transfer` | read | `membership` | Read | Read | Read | absent | `audit`, `bind_cache_key` | status read for the two parties |
| 29 | `29.transfer_primary_ownership` | protected | `membership` | Primary (`p1`, unchanged) | Deny | Deny | Deny | `fresh_assurance`, `confirm`, `audit`, `invalidate`, `recheck_at_commit` | CBD-72 row 29; the confirm leg |

`24.invite_nonowner`, `24.replace_invitation`, `24.resend_invitation`, `24.revoke_nonowner` gain a **Co-owner Allow** column (CBD-72 row 24: Primary Owner Allow, Co-owner Allow); `26.invite_coowner` stays Primary-only (row 26).

### 11.3 New subject-scoped cells (permission key `subject`, role `acting_subject`)

| Cell | Action code | Kind | Effect | Obligations | Binding |
| --- | --- | --- | --- | --- | --- |
| subject | `invitation.attach` | Subject-self | mutate | `audit`, `recheck_at_commit` | `TR-73-10`: the ceremony is located by the ceremony cookie, not by a policy target, because before attachment no subject owns it; the handler proves `channel_proof_state = 'proved'` and writes `attached_subject_id` = the session subject |
| subject | `invitation.read_ceremony` | Subject-target (`invitation_ceremony`) | read | `audit`, `bind_cache_key` | the disclosure surface; `owningSubjectId` = `attached_subject_id`, `environmentId` = the row's environment, `owningSpaceId` none (a ceremony is subject-owned until commit) |
| subject | `invitation.accept` | Subject-target (`invitation_ceremony`) | mutate | `audit`, `recheck_at_commit` | `TR-73-38`; the row's `state_version` is the captured `targetVersion` |

Decline (`TR-73-11`) is deliberately not a cell: it must work without an account (CBD-73 §8.1 item 1), so it is a pre-authentication ceremony surface like `resolve`.

### 11.4 Non-owner columns for every action the prototype exposes

The second person can do nothing until their role has cells. `p4` therefore maps the **Co-owner** and **Collaborator** columns for every action code a route exposes at baseline or in the manual-account increment, with CBD-72's values:

| Action codes | CBD-72 row | Co-owner | Collaborator | Notes |
| --- | --- | --- | --- | --- |
| `1.view_space` | 1 | Read | Read | as row 1 |
| `2a.create_plan`, `2a.edit_plan`, `2a.edit_target` | 2a | Allow | Allow | — |
| `4.create_category`, `4.edit_category`, `4.archive_category`, `4.restore_category` | 4 | Allow | Allow | — |
| `9.add_manual_transaction`, `9.edit_manual_transaction`, `9.remove_manual_transaction`, `9.restore_manual_transaction` | 9 | Allow | Allow | — |
| `14.view_accounts_balances_transactions`, `14.view_progress_detail` | 14 | Read | Read | — |
| `15.view_planning_and_reports` | 15 | Read | Read | — |
| `manual_account.create_manual_account`, `edit_`, `archive_`, `restore_` | none (`OQ-236-011`) | Allow | Allow | **No CBD-72 row exists.** Proposed by analogy with row 9 (a manual account is the container of a manual transaction) for Product Owner approval inside the `p4` approval; the row still belongs in CBD-72 |

Viewer and Accountability Partner columns stay absent in `p4`: their reads carry `mask`/`label_partial_view` obligations and profile predicates that no route discharges yet, and no invitation for them exists (`IV-001`).

### 11.5 Negative families

`P4_NEGATIVE_FIXTURES` emits, per cell: wrong role (each unmapped role → `role_not_permitted`, including Viewer and Partner for every §11.4 row and Collaborator for every owner row); wrong space and wrong target (`scope_mismatch`); target absent (`input_invalid`); archived space for every mutation (`lifecycle_blocked`); stale `targetVersion`, `authorizationVersion`, `primaryOwnershipVersion`, and `consentDisclosureVersion` (`stale_version`); consent `superseded`/`ended` (`consent_not_current`); for `29.transfer_primary_ownership` `assurance.level = "session"` (`assurance_required`) and a present-but-misbound or expired fresh assurance, bound to another action or space (`assurance_insufficient`, matching contract §5.2 and `evaluate.ts`); for the subject cells the §9.4 families of CBD-236 (another subject, wrong environment, forbidden sections, worker adapter, space-bound shape); a `p4` code under `p3` (`policy_version_unsupported` through `decide`, `input_unsupported` in a `p3` input); every provenance leaf restamped (`input_invalid`). The generators are version-parameterized like `accountNegativeFixtures(version)`.

## 12. Rate-limit surfaces and records

`IV-016` (Proposed-binding). **Every new route is registered in `config/rate-limit/registrations.json` against a closed catalog row and an approved record; the records below are projections of the approved §4.7 sets except one, which needs an Executive approval in the shape of `CBD266-IDENTITY-RECORDS-001`.**

| Registration | Surface | Record | Basis |
| --- | --- | --- | --- |
| `api:POST:/v1/budget-spaces/{budgetSpaceId}/invitations` | `surf-266-invitation-create` | `rlp-266-invitation-create-v1` | `proto-mutation-v1` values projected onto the exact surface ("a stricter mutation row in the section 5 catalog") |
| `api:POST:/v1/budget-spaces/{budgetSpaceId}/invitations/{invitationId}/replace` | `surf-266-invitation-resend` | `rlp-266-invitation-resend-v1` | same |
| `api:DELETE:/v1/budget-spaces/{budgetSpaceId}/invitations/{invitationId}` | `surf-266-invitation-cancel` | `rlp-266-invitation-cancel-v1` | same |
| `api:GET:/v1/budget-spaces/{budgetSpaceId}/invitations` (+ `HEAD`) | `surf-266-invitation-inspect` | `rlp-266-invitation-inspect-v1` | `proto-authenticated-read-v1` values |
| `api:POST:.../invitations/{invitationId}/confirm`, `.../reject` | `surf-266-invitation-create` | `rlp-266-invitation-create-v1` | the confirmation is owner-side invitation administration; same pool as create |
| `api:GET:/v1/budget-spaces/{budgetSpaceId}/members` (+ `HEAD`) | `surf-266-budget-read` | `rlp-266-authenticated-read-v1` | existing record |
| `api:POST:/v1/invitations/resolve`, `api:POST:/v1/invitations/{ceremonyId}/verify-channel`, `api:POST:/v1/invitations/{ceremonyId}/decline` | `surf-266-invitation-accept` | **`rlp-266-invitation-ceremony-v1` (new set `proto-invitation-ceremony-v1`)** | pre-authentication; `phase: pre_authentication`, components `[privacy_network_cohort_v1, exact_surface_id]`, the `proto-identity-ceremony-v1` values (sliding 60,000 ms, threshold 12, burst 3, ceiling 15), `attackable_dimensions: [privacy_network_cohort_v1]`, `independent_recovery_surface_id: null`; needs an Executive decision because §4.7 approves no pre-authentication set outside identity |
| `api:POST:/v1/invitations/{ceremonyId}/attach`, `api:POST:/v1/invitations/{ceremonyId}/accept` | `surf-266-budget-mutation` | `rlp-266-mutation-v1` | authenticated, verified-actor keyed; `surf-266-invitation-accept` cannot host a second `ordinary`-stage record (§4.7.4), so the authenticated half of the ceremony counts on the actor's mutation pool; `OQ-IV-003` records the classification question for the CBD-266 owner |
| `api:GET:/v1/invitations/{ceremonyId}` (+ `HEAD`) | `surf-266-budget-read` | `rlp-266-authenticated-read-v1` | same reasoning |
| `api:POST:.../primary-transfers`, `.../accept`, `.../decline`, `.../withdraw` | `surf-266-protected-action` | `rlp-266-protected-action-v1` | `proto-mutation-v1` values projected |
| `api:POST:.../primary-transfers/{transferId}/confirm` | `surf-266-protected-action` | `rlp-266-protected-action-v1` | the protected leg; the fresh-assurance step-up's own ceremony routes stay on `surf-266-authentication` (`PK-4`) |
| `api:GET:.../primary-transfers/{transferId}` (+ `HEAD`) | `surf-266-budget-read` | `rlp-266-authenticated-read-v1` | — |
| `api:GET:/v1/local/invitation-deliveries` | `surf-266-operations-query` | `rlp-266-local-delivery-v1` | `proto-authenticated-read-v1` values; local-only; refused at startup outside the local provider |

The CBD-73 §8.3 pair-scoped limit (`RI-93-010C`, `PR-94-002`, `OI-73-010`) is not a `surf-266` record: it is keyed by inviter plus privacy-preserving recipient token and produces the synthetic lifecycle, not a rate denial. It is deferred (`IV-001`); CBD-276-AC05 and CBD-41-AC11 are therefore only partially met in this increment (§16). Reserved units: none of the new routes touches the bootstrap reservations; `CL-F01`'s refund rule (an effect that commits nothing refunds its unit) applies to `stale_disclosure` on `accept` and `confirm` exactly as it does on `/confirm` today, and the API packet adds the two codes to `REFUNDABLE_EFFECT_DENIALS` with the matching parity-table rows (`SEC-F01`).

## 13. Audit and notices in the prototype

`IV-017` (Proposed-binding). **`budget_space_lifecycle_audit` (budget-space scope) holds the `AE-73-*` events with the CBD-72 §9 envelope and a closed allowlisted payload; the `PolicyAuditEvent` allowlist of CBD-236 §11 is unchanged.** Columns: `event_id`, `budget_space_id`, `event_code` CHECK IN the `AE-73-01`…`AE-73-32` set plus the subtype column for `AE-73-25`/`AE-73-32`, `occurred_at`, `actor_subject_id` NULL, `acting_membership_id` NULL, `target_type`, `target_id`, `result`, `reason_class`, `policy_version`, `policy_digest`, `correlation_id`, `audience` CHECK IN (`'customer'`, `'restricted'`), `payload jsonb` (allowlisted keys only; never a raw destination, code, bearer, or another member's personal state). `AE-73-14` for unknown values uses a nullable `budget_space_id` and therefore lives in a sibling identity-scope table `invitation_security_event`. This answers `OQ-CF-003` for this increment: the `budget.created` audit keeps its `consent_id` reference, and the invitation and transfer receipts carry theirs in the `AE-73-13`/`AE-73-25` payloads; a dedicated `consent_recorded` class is not allocated.

`account_lifecycle_notice` (identity scope; `DR-73-11`): `notice_id`, `account_subject_id`, `budget_space_id` NULL, `message_code` (`MSG-73-015`, `-019`, `-042`, `-050`, `-052`), `event_correlation_id`, `created_at`, `read_at` NULL. Rows are written in the causing transaction (the `AE-73-30` enqueue); there is no external delivery in the prototype and no delivery is ever an authorization or commit dependency (CBD-280-AC06). Rendering the in-app list is `PK-8`'s smallest page.

## 14. Affected interfaces, migration, and compatibility

| Interface | Change | Compatibility rule | Who amends |
| --- | --- | --- | --- |
| `packages/migrations` | `M1`–`M3` (§7) | Forward-only, additive, no backfill; `M1` first | `PK-2` under the §17 decision |
| `packages/data-access` catalog | Nine new rows (§7.2, §7.3) | Catalog test in the same change | `PK-2` |
| `packages/contracts/src/authorization` | `p4` (§11); `ResourceType` + 2; five superseded definitions | New immutable version; `p1`–`p3` untouched; release by `CBD236-POLICY-APPROVAL-001` | `PK-1`, then the Manager applies the release step |
| `docs/cbd-236-authorization-policy-contract.md` | §8.7 `p4`, §9.6 negatives, §12 row, `HO-236-10` | Contract amendment; header version cell to be corrected (`OQ-IV-006`) | CBD-236 owner |
| `config/consent-disclosure-registry.json`, `docs/consent-disclosures/` | Four kinds at version 1 (§6) | Append-only, digest-pinned; the build guard's `TEXT_REF_PATTERN` already admits the path | `PK-3` |
| `apps/api/src/budget-creation/consent-registry.ts` | Required-kinds set grows by the kinds the invitation and transfer routes need | Startup fails closed on a missing kind | `PK-3` |
| CBD-190 / CBD-191 | `step_up` ceremony kind; fresh-assurance session record; fact source emits `fresh` | Amendments to both contracts (`OQ-236-005`) | `PK-4`; contract owners |
| CBD-212 | `financial_profile.display_name` (§9) | Additive | CBD-212 owner |
| `config/rate-limit/registrations.json`, `records.json`, `approvals.json` | §12 | One approved record per (surface, stage); the new pre-authentication set needs its decision | `PK-6`, `PK-7`; Executive for the new set |
| `apps/api/src/authorization/http.ts` | Ceremony-surface list + three invitation routes; `REFUNDABLE_EFFECT_DENIALS` + `stale_disclosure` for the two new effects | Outside the byte-parity set | `PK-6` |
| `apps/worker` | No membership path; no ordinary cell; parity literals only from the `p4` release step | `SEC-F02` worker clause stays moot | Release step |
| CBD-73 §13 `DR-73-*` mapping | Physical records named for `DR-73-01/02/03/04/11/12/13` | CBD-73 owner records the mapping under `OI-73-003`; not source approval | CBD-73 owner |
| CBD-233 / CBD-232 | none new; the pending `acknowledgedDisclosure`/`stale_disclosure` amendments remain routed as `CBD236-CONSENT-SEMANTICS-001` item 6 directs | — | owners |
| `apps/web` | Invitation, ceremony, members, transfer, notices pages; API client | Additive | `PK-8` |

Rollback of any packet is a redeploy of the previous build; `M1` leaves every existing row valid under the widened CHECKs, so no data migration is reversed.

## 15. Decomposition into implementation packets

`IV-018` (Proposed-binding). **Nine packets, each with a write scope that no other packet touches, in the dependency order below; `PK-1` and `PK-2` may run in parallel, `PK-3` and `PK-4` may run in parallel with them, `PK-5` needs `PK-2` merged, `PK-6` needs `PK-1` released and `PK-3`, `PK-5` merged, `PK-7` needs `PK-4` and `PK-6` merged, `PK-8` needs `PK-6` (and `PK-7` for its transfer pages), `PK-9` closes.**

| Packet | Role | Write scope (exclusive) | Gate | Delivers | Live criteria (see §16) |
| --- | --- | --- | --- | --- | --- |
| `PK-1` contracts `p4` | implementation | `packages/contracts/src/authorization/policy/v4.ts`, `registry.ts`, `fixtures/index.ts`, `input.ts` (`ResourceType` only), contracts tests; `docs/cbd-236-p4-release-step.md` (new); `docs/cbd-236-authorization-policy-contract.md` §8.7/§9.6/§12/§16 (proposed revision row) | `npm run check`; doc gate | §11 cells, digest, negatives, release step; registered not released | CBD-41-AC01, CBD-276-AC01, CBD-8-AC03, CBD-8-AC05, CBD-42 (context) |
| `PK-2` migrations and catalog | implementation | `packages/migrations/migrations/<M1,M2,M3>.sql`, `packages/data-access/src/catalog.ts` (delimited block), `packages/migrations/README.md` | `npm run check:migrations`; `db:reset/migrate/verify` live proof; scratch probes that a membership insert without consent still fails, that `M1` admits `collaborator`, that `recorded_by` inequality fails, that two live transfers per space fail | §7 | CBD-287-AC01, CBD-287-AC05, CBD-41-AC06 (mechanical half), CBD-8-AC11, `INV-01` |
| `PK-3` disclosure kinds | implementation (guard role only if `scripts/check-consent-disclosure-registry.mjs` needs a rule change) | `config/consent-disclosure-registry.json`, `docs/consent-disclosures/invitation-collaborator.v1.json`, `invitation-co-owner.v1.json`, `primary-transfer-recipient.v1.json`, `primary-transfer-outgoing.v1.json`, `apps/api/src/budget-creation/consent-registry.ts` required-kinds list and its test | `npm run check`; deliberate-violation runs of both guards per kind | §6 | CBD-41-AC02, CBD-287-AC02, CBD-287-AC06, CBD-73-AC03, CBD-73-AC13 (semantic) |
| `PK-4` fresh-assurance step-up | implementation | `apps/api/src/identity/**` (`step_up` ceremony), `packages/sessions/src/**` (assurance record), `apps/api/src/sessions/fact-source.ts`, one identity-scope migration widening the ceremony enum, `config/rate-limit/registrations.json` rows for the step-up routes only, `docs/cbd-190-*.md` and `docs/cbd-191-*.md` proposed revision rows | `npm run check`; live proof that `decide` allows a protected action only inside the window and only for the bound action/space | §10.4 | CBD-280-AC01 (sessions), CBD-235-AC03 (assurance shape, for its owner), CBD-8-AC03 |
| `PK-5` budget-application invitations | implementation | `packages/budget-application/src/invitations/**` (new: state service, ceremony, disclosure binding, acceptance plan), `packages/budget-application/src/persistence/invitation-store.ts`, `membership-store.ts`, `lifecycle-audit-store.ts`, `notice-store.ts`, their unit and `*.live.test.ts` | `npm run check`; live tests: full ceremony, §8 transaction, injected failure at every boundary, two concurrent confirms, replay, stale disclosure, already-member, expiry by timestamp, every prohibited transition | §4, §5.2, §8 | CBD-41-AC03/04/05/06/07, CBD-274-AC01/03/05, CBD-275-AC01–AC05, CBD-276-AC02/04/06, CBD-73-AC01/02/04/05/12/15/16/17, CBD-8-AC04, CBD-234-AC03/AC07 (pattern reuse) |
| `PK-6` API invitations and members | implementation | `apps/api/src/invitations/**` (new), `apps/api/src/budget-spaces/http.ts` (members route only), `apps/api/src/local/**` (delivery surface), `apps/api/src/authorization/http.ts` (ceremony list, refund set), `config/rate-limit/registrations.json`, `records.json`, `approvals.json` (invitation rows), `apps/api/src/rate-limit/inventory.ts` fixtures if needed, `apps/api` tests | `npm run check`; inventory and registry guards; process-level e2e of the ceremony | §5, §12 (invitation rows), §13 wiring | CBD-41-AC01/03/09 (read fence), CBD-41-AC11 (uniform outcomes only), CBD-274-AC02/AC04, CBD-275-AC06, CBD-276-AC01/AC03/AC05 (uniformity only), CBD-235-AC01, CBD-234-AC06 (pattern), CBD-8-AC02/AC06 (members list fields), CBD-73-AC08 (no-op), CBD-73-AC11 (notices as rows) |
| `PK-7` Primary transfer | implementation | `packages/budget-application/src/primary-transfer/**`, `persistence/primary-transfer-store.ts`, `apps/api/src/primary-transfer/**`, the transfer rows of `config/rate-limit/registrations.json`/`records.json`, tests | `npm run check`; live proof of §10.3 including concurrent transfer vs. invitation confirm, stale version, fresh-assurance absence | §10 | CBD-280-AC01/02/05/06, CBD-41-AC10, CBD-8-AC07 (version bump), CBD-287-AC03/AC04/AC05, CBD-73 §12 rows |
| `PK-8` web | implementation | `apps/web/src/app/(app)/**` new routes (invite, invitations list, members, ceremony pages under `(public)/invitation/**`, transfer, notices), `apps/web/src/api/**` new clients, `apps/web/tests/**` | `npm run check`; real-Chrome journey; axe | the surfaces | CBD-41-AC12, CBD-274-AC04/AC06, CBD-287-AC02, CBD-280-AC04 (copy of exits), CBD-235-AC09 (pattern), CBD-73-AC03/AC13 (presentation) |
| `PK-9` QA | qa | `scripts/prototype-e2e.mjs`, `scripts/prototype-qa-criteria.mjs`, `scripts/prototype-qa-browser.mjs`, `scripts/prototype-browser-walkthrough.mjs` | the four scripts on a fresh scratch database | criterion scripts per §16 | CBD-8-AC02/AC12, CBD-41-AC06, CBD-275-AC02/AC03, CBD-280-AC05 |

Shared surfaces stay single-writer: no packet edits `.github/workflows/ci.yml`, root `package.json`, `AGENTS.md`, `CLAUDE.md`, `scripts/check-doc-*.py`, or `scripts/check-ci-contract.mjs`. `PK-1` is the only packet that touches `packages/contracts/src/authorization`, and `config/authorization-policy-release-history.json` is written only by the Manager applying the release step. `config/rate-limit/*.json` is touched by `PK-4`, `PK-6`, and `PK-7` in sequence, never concurrently. The reviewer and security roles verify `PK-2`, `PK-5`, `PK-6`, and `PK-7` before merge; `PK-1` needs the `p4` Product Owner approval and Security fixture review before its release step.

## 16. Traceability: live acceptance criteria to packets

Read live on September 15, 2026 through the credential loader (`customfield_10066` on every issue below; the description bodies agree). "Not this increment" names the later packet or the gate; "not applicable" means the criterion governs work outside invitation, acceptance, membership read, and transfer.

| Criterion | Packet(s) | Status in this increment |
| --- | --- | --- |
| CBD-41-AC01 authorized creation | `PK-1`, `PK-6` | met by the `p4` cells and the uniform denial with `AE-73-31` |
| CBD-41-AC02 disclosure binding | `PK-3`, `PK-5` | met; stale/mismatched version denies `stale_disclosure` at `TR-73-38` and at commit |
| CBD-41-AC03 channel proof | `PK-5`, `PK-6` | met with the simulated channel challenge; provider proof deferred |
| CBD-41-AC04 atomic acceptance | `PK-5` | met (§8); injected-failure suite |
| CBD-41-AC05 single use and replay | `PK-5` | met for link replay and concurrent commit; provider-callback replay not this increment |
| CBD-41-AC06 state machine | `PK-2`, `PK-5`, `PK-9` | met for the implemented states; `delivered`, `revoked`, `removed` transitions in the revocation and provider packets |
| CBD-41-AC07 resend and replacement | `PK-5` | met per `TR-73-05`; wording conflict reported (§4.3) |
| CBD-41-AC08 decline and block | `PK-5` (decline once) | partial: decline-and-block deferred (`OI-73-002`, `OI-73-010`) |
| CBD-41-AC09 revocation and removal | — | not this increment (next packet); the fence exists today through `PC-236-014` |
| CBD-41-AC10 ownership safety | `PK-7` | met for transfer and one-Primary; archival and Co-owner removal not this increment |
| CBD-41-AC11 enumeration and abuse controls | `PK-6` | partial: uniform outcomes met; pair-scoped limit deferred (`OI-73-010`) |
| CBD-41-AC12 accessibility and copy | `PK-8` | met for the built surfaces; exact copy remains `OI-73-004` |
| CBD-274-AC01 | `PK-5` | met |
| CBD-274-AC02 | `PK-6` | met (disclosure surface exposes nothing of the account) |
| CBD-274-AC03 | `PK-5`, `PK-6` | met for every listed code class the prototype can produce; "blocked" and "revoked" classes appear when their packets land, using the same uniform `MSG-73-003` |
| CBD-274-AC04 | `PK-6`, `PK-8` | met |
| CBD-274-AC05 | `PK-5` | met (ceremony state is the only resume point) |
| CBD-274-AC06 | `PK-8` | met for the built surfaces |
| CBD-275-AC01–AC06 | `PK-5` (AC01–AC05), `PK-6` (AC06) | met |
| CBD-276-AC01 | `PK-1`, `PK-6` | met |
| CBD-276-AC02 | `PK-2`, `PK-5` | met |
| CBD-276-AC03 | `PK-6` | partial: unknown/known/self/already-member uniform; blocked and rate-limited classes deferred |
| CBD-276-AC04 | `PK-5` | met |
| CBD-276-AC05 | — | not this increment (`OI-73-010`) |
| CBD-276-AC06 | `PK-5`, `PK-6` | met by `budget_space_lifecycle_audit` allowlist |
| CBD-280-AC01, AC02, AC05, AC06 | `PK-7`, `PK-4` | met |
| CBD-280-AC03 Co-owner removal | — | not this increment (revocation/removal packet) |
| CBD-280-AC04 sole Primary cannot leave; archive | `PK-8` (copy of the two exits) | partial: the sole-Primary denial `TR-73-33` and archival belong to the revocation packet and CBD-235 |
| CBD-287-AC01 | `PK-2` | met (the `budget_space_consent` row already carries every field; Viewer profile columns deferred with Viewer) |
| CBD-287-AC02 | `PK-3`, `PK-8` | met |
| CBD-287-AC03 | `PK-5`, `PK-7` | met |
| CBD-287-AC04 | `PK-7` | met for transfer; role-change expansion/reduction (`TR-73-20`–`TR-73-28`) not this increment |
| CBD-287-AC05 | `PK-2` | met by `source` and `disclosure_kind`; export and Viewer-profile sources later |
| CBD-287-AC06 | `PK-3` | met |
| CBD-8-AC01 | this document, `PK-1`–`PK-9` | met at the planning level once the packets are ticketed |
| CBD-8-AC02 budget isolation | `PK-9` | partial: tests for the roles and states this increment creates |
| CBD-8-AC03 default deny | `PK-1`, `PK-4` | met |
| CBD-8-AC04 invitation safety | `PK-5`, `PK-6` | met |
| CBD-8-AC05 deterministic roles | `PK-1`, `PK-2` | partial: five roles exist in the schema; two are invitable and mapped |
| CBD-8-AC06 scope and masking | — | not this increment (Viewer and Partner) |
| CBD-8-AC07 revocation | `PK-7` (version bump on transfer) | partial; revocation packet |
| CBD-8-AC08 personal state | `PK-6` (notices readable by the subject only) | partial |
| CBD-8-AC09 non-authority | — | not applicable (alerts and comments) |
| CBD-8-AC10 audit separation | `PK-6` (`audience` column; restricted vs customer) | partial; `OI-73-011` |
| CBD-8-AC11 concurrency and recovery | `PK-5`, `PK-7`, `PK-9` | met for the implemented transitions |
| CBD-8-AC12 release evidence | `PK-9` | not this increment (Private-MVP gate) |
| CBD-73-AC01 state model | `PK-2`, `PK-5` | met for the implemented set; `Delivered`/`Failed` deferred |
| CBD-73-AC02 creation record | `PK-2` | met |
| CBD-73-AC03 pre-acceptance disclosure | `PK-3`, `PK-8` | met (alerts item stated as absent) |
| CBD-73-AC04 acceptance and confirmation | `PK-5`, `PK-6` | met |
| CBD-73-AC05 resend/replace invalidation | `PK-5` | met; `MSG-73-053` prompt deferred |
| CBD-73-AC06, AC07 expansion and reduction | — | not this increment |
| CBD-73-AC08, AC09, AC10 revocation and removal | — | not this increment (status CHECK widened now) |
| CBD-73-AC11 events and notices | `PK-5`, `PK-6` | met as rows; delivery deferred |
| CBD-73-AC12 lifecycle rows | §4.6, `PK-5` | met for the implemented rows |
| CBD-73-AC13 voluntary copy | `PK-3`, `PK-8` | semantic only; copy under `OI-73-004` |
| CBD-73-AC14 test inventory | `PK-9` | partial: wrong recipient/space, invalid/expired/reused code, stale session, unauthorized change, cross-space; revoked consent and queued alert later |
| CBD-73-AC15, AC16, AC17 | `PK-5`, `PK-6` | met |
| CBD-234-AC01, AC02, AC04, AC05, AC08 | — | not applicable (budget-creation reconciliation; `PROTO-CONSENT-LANDING-001` and CBD-233 own them) |
| CBD-234-AC03 duplicate-intent gating | `PK-5` | pattern reused for a second confirm while the first is in flight (§8 step 1 and the `FOR UPDATE` lock); the criterion itself is CBD-233's |
| CBD-234-AC06 subject-scoped status reads | `PK-6` | pattern reused for `invitation.read_ceremony`; the criterion itself is CBD-233's |
| CBD-234-AC07 idempotent reconciliation | `PK-5` | pattern reused (`commit_idempotency_key`); the criterion itself is CBD-233's |
| CBD-235-AC01 list/open by current membership | `PK-6` | met for the members list and unchanged for `membership.list_own` |
| CBD-235-AC04 archive preserves memberships and consent evidence | `PK-2` | constraint carried: `M1` gives archival nothing to delete; the criterion is CBD-235's |
| CBD-235-AC02, AC03, AC05–AC10 | — | not applicable (list, rename, archive) |

## 17. Decisions for the Executive

Each item is numbered, states the choice, and carries a recommendation. Nothing is decided by this document.

1. **Jira home.** The packet named CBD-234 and CBD-235; the live tickets for this work are CBD-41 (with CBD-274, CBD-275, CBD-276), CBD-280, and CBD-287 under epic CBD-8. *Recommendation:* adopt those keys for `PK-1`–`PK-9`; treat CBD-234 and CBD-235 as not this increment; have the Scrum role check whether CBD-41's subtasks need a fourth subtask for the members list and a fifth for the local delivery adapter.
2. **Invitable roles in the prototype.** Collaborator and Co-owner only; Viewer and Accountability Partner deferred until their masking obligations and disclosure kinds exist. *Recommendation:* approve.
3. **Local delivery.** A simulated, `FIDELITY_LABEL`-marked local delivery adapter and developer-only delivery surface (§5.3); no provider, no `Delivered`/`Failed` states. *Recommendation:* approve as a tolerated absence of delivery for the local prototype, replaced before any hosted environment; `OI-73-008` custody evidence unchanged.
4. **Intended-recipient confirmation now.** Implement `TR-73-38`/`TR-73-39` and commit `TR-73-13` inside the confirming owner's transaction (§8). *Recommendation:* approve; it is normative (`OI-73-001` closed) and it is what makes CBD-41-AC04 atomic without a worker.
5. **Disclosure kinds per role.** Four kinds at version 1 (§6), semantic content approved for the prototype phase only; `disclosure_kind` CHECK widened to the explicit list including the three not yet registered; each future kind is one migration. *Recommendation:* approve, with Private-MVP copy under `OI-73-004`.
6. **`recorded_by_subject_id` rule (`SEC-F04`).** For every source, `recorded_by_subject_id` equals `account_subject_id`: the consent row evidences the consenting person's explicit action, and the other party's action lives on the confirmation or transfer record. The trigger is tightened to enforce it. *Recommendation:* approve.
7. **Ceremony correlation on the consent row (`OQ-CF-005`, first half).** A nullable `source_ceremony_id` column, set for `invitation_acceptance`; the pure-reduction half of `OQ-CF-005` stays open for the revocation packet. *Recommendation:* approve.
8. **`OQ-CF-002`: what a new disclosure version obliges existing rows to do.** Nothing. A new version of any kind changes no existing row's version, digest, or state; existing memberships stay `current`; re-consent is required only by a role or scope expansion (`TR-73-21`) or a transfer, each of which writes a new row against the then-current version; a text change that alters what a role *is* is a CBD-72 change and reaches members as an expansion proposal, not as a registry bump. *Recommendation:* approve; record it in the CBD-73 §6 mapping and in the registry file's comment.
9. **Fresh assurance before transfer (`OQ-236-005`).** Land a local step-up (`PK-4`) that lets the fact source emit `assurance.level = "fresh"` bound to action and space; the transfer packet is blocked until it merges. *Recommendation:* approve; the alternative — a transfer without fresh assurance — would require editing `p1`'s protected cell, which `PC-236-011` forbids.
10. **`p4` scope.** The cells of §11: owner invitation cells with a Co-owner column, confirmation and members cells, the transfer cells, three subject-scoped invitee cells, and Co-owner and Collaborator columns for every action the prototype exposes; Viewer and Partner absent. *Recommendation:* approve for the Product Owner's `p4` approval and Security fixture review under `CBD236-POLICY-APPROVAL-001`.
11. **Manual-account cells for non-owners (`OQ-236-011`).** CBD-72 has no manual-account row; `p4` proposes Allow for Co-owner and Collaborator by analogy with row 9. *Recommendation:* approve inside the `p4` approval and route the CBD-72 row to its owner; if the Product Owner declines, `p4` ships without those two columns and the second person cannot manage accounts until CBD-72 decides.
12. **Rate-limit records.** Project `rlp-266-invitation-{create,resend,cancel,inspect}-v1`, `rlp-266-protected-action-v1`, and `rlp-266-local-delivery-v1` from the approved class sets; approve the new pre-authentication set `proto-invitation-ceremony-v1` for `surf-266-invitation-accept` with the `proto-identity-ceremony-v1` values. *Recommendation:* approve the projections as within `CBD266-PROTOTYPE-DEFAULTS-001` and record the new set as `CBD266-INVITATION-RECORDS-001`, prototype-only.
13. **Deferred CBD-73 controls.** Inviter block, pair limiter, block and limit suppression classes, notification-only destination, decline-and-block, provider callbacks, the `MSG-73-053` prompt, Viewer profiles, revocation and removal. Every deferred control keeps CBD-73's uniform customer outcome, and none of `OI-73-002`, `-009`, `-010`, `-012` closes. *Recommendation:* approve the deferral for the prototype and ticket the revocation/removal packet next, since `M1` already carries its statuses.
14. **CBD-41-AC07 wording.** The criterion reads as if resend keeps the record; `TR-73-05` makes resend a successor record. *Recommendation:* the approved specification controls; the Scrum role proposes an AC07 wording aligned with `TR-73-05` for the Product Owner, under the user's authorization for that Jira change.
15. **Display identity.** `financial_profile.display_name` as the `DI-91-065` value (§9), a CBD-212 amendment. *Recommendation:* approve; the alternative of a per-membership label would show one person under different names in different spaces, which CBD-73 §7.2 item 4's two-way statement does not describe.
16. **Audit and notices.** `budget_space_lifecycle_audit` with an `audience` column for the `AE-73-*` events, and `account_lifecycle_notice` rows written atomically with no delivery (§13); no `consent_recorded` class (`OQ-CF-003`). *Recommendation:* approve; `OI-73-011` storage, integrity, and retention evidence remains open.

## 18. Open questions

| ID | Question | Why pending | Authority |
| --- | --- | --- | --- |
| `OQ-IV-001` | Is `1.view_members` correctly sourced from CBD-72 row 1, or does the members list need its own CBD-72 row? | Row 1 speaks of identity and role "when relevant to accessible content"; a members page is administration-adjacent | Product Owner (CBD-72) |
| `OQ-IV-002` | Should resend (`24.resend_invitation`) and replace (`24.replace_invitation`) share one route with a mode, or be two routes? | Both are `TR-73-05`; two codes exist in `p1` | Architecture with the API packet; no policy consequence |
| `OQ-IV-003` | Is the authenticated half of the ceremony (`attach`, disclosure read, `accept`) correctly counted on the budget mutation and read pools, given that `surf-266-invitation-accept` can hold only one `ordinary`-stage record? | §4.7.4 forbids two ordinary records on one surface; the alternative is a stage-owning ceremony record | CBD-266 owner; Security |
| `OQ-IV-004` | The assembler emits no `primaryOwnershipVersion` from a column today; `M1` adds `budget_space.primary_ownership_version`. Which packet wires it into `budget-facts.ts`, and does the captured set's equality rule already cover it? | `ApiUserCapturedVersions` names it; the source is undefined at baseline | `PK-6`, with a reviewer check of `evaluate.ts` |
| `OQ-IV-005` | May the Co-owner's `26.confirm_acceptance` row be absent (only the Primary confirms a Co-owner invitation), or should any current holder of permission 26 confirm? | Permission 26 is Primary-only, so the row collapses to Primary; recorded for completeness | Product Owner |
| `OQ-IV-006` | `docs/cbd-236-authorization-policy-contract.md`'s header says version 0.8 while its revision history ends at 0.9 (the `p3` release). | A freshness pin against the header would read 0.8 | CBD-236 owner; one-line correction |

## 19. Alternatives and why they lost

**Write the invitee's consent row at `TR-73-38` with a placeholder membership.** Rejected: `budget_space_consent.membership_id` is a composite foreign key to a real membership, and a pending membership row would be a membership that confers nothing — exactly the `IC-73-001` state CBD-73 forbids the schema to have. The ceremony and confirmation rows are the pending evidence.

**Commit `TR-73-13` from a worker job after confirmation.** Rejected for the prototype: it adds a worker membership path (`SEC-F02` (a) for the worker, the byte-parity mirror, a job registration) for no atomicity gain; the application function is reusable when a provider callback needs it.

**Skip the intended-recipient confirmation in the prototype.** Rejected: `OI-73-001` is closed by Product decision and the confirmation shapes the schema (`awaiting_confirmation`, `DR-73-13`); adding it later would be a second migration and a changed ceremony.

**One `invitation` disclosure kind parameterized by role.** Rejected: the registry pins one text per version; a role parameter would make "the version the person saw" ambiguous and the digest meaningless.

**Drop the CHECK constraints on `disclosure_kind` and trust the registry.** Rejected: the CHECK is the fail-closed half; the registry guard is the other half. A kind reaching the database that the registry does not know is a bug the CHECK should catch.

**Map Viewer and Accountability Partner in `p4` now.** Rejected: their cells carry `mask` and `label_partial_view` obligations and profile predicates that no route discharges; mapping them would be allow-without-masking.

**A per-membership display label instead of a profile display name.** Rejected (§17 item 15).

## 20. Acceptance-criteria traceability for this packet

| Criterion | Where it is met |
| --- | --- |
| `INV-01` — every membership insert path writes its consent row in the same transaction, and the CHECK widening migration is specified before any such path | §1.3 (the constraint, exactly); §7.1 `M1` first, with `IV-008` forbidding any membership-writing packet before it; §8 step 8 (acceptance) and §10.3 steps 3–5 (transfer, UPDATE-then-INSERT); §15 dependency order (`PK-5` and `PK-7` after `PK-2`) |
| `INV-02` — the acceptance criteria of CBD-234, CBD-235, CBD-8 and CBD-73 are read live and each is mapped to a packet | §1.2 (the live read and the key discrepancy); §16 (every criterion of the ten issues, including the six live CBD-8 children the packet did not name, mapped to a packet or marked not this increment / not applicable with the reason) |
| `INV-03` — the p4 cells, registry kinds and rate-limit surfaces are enumerated so the following packets need no discovery; the Executive decision items are numbered with recommendations | §11 (cells, superseded definitions, resource types, negatives); §6 (kinds, versions, files, content); §12 (every registration with surface and record); §17 (sixteen numbered items, each with a recommendation) |
| `INV-04` — doc gate passes; the document is marked proposed; PR opened | Status line above; the gate lines are in the pull request body |

## 21. Revision history

| Version | Date | Change |
| --- | --- | --- |
| 0.1.1 | September 15, 2026 | Documentation corrections approved under `EXEC-FOLLOWUPS-003`: §11.5 negative family for a present-but-misbound or expired fresh assurance corrected from `assurance_required` to `assurance_insufficient`, matching contract §5.2 and `evaluate.ts` (`P5-F3`); the consumed-contract row updated to `docs/cbd-190-identity-ceremony-and-mapping-contract.md` v0.4 and `docs/cbd-191-session-and-revocation-contract.md` v0.3 (`AMEND-F11`). No cell, digest, or design decision changed. |
| 0.1 | September 15, 2026 | Initial proposal: scope cut, invitation record and states, ceremony over HTTP with the simulated delivery adapter and the no-account identity path, disclosure kinds, widening migration and new tables, the acceptance transaction, display identity, Primary transfer as a consent-bearing change with the fresh-assurance prerequisite, `p4` cells, rate-limit registrations, audit and notices, packets, traceability, decision items |
