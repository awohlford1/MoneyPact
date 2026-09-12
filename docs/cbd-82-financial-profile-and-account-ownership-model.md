# CBD-82 — Financial Profile and Linked-Account Ownership Model

| Field | Value |
| --- | --- |
| Status | **Draft v0.2 — Product Owner review and approval required. Physical schema, provider evidence, and tests remain gated by `OI-82-001` and `OI-82-002`** |
| Document version | 0.2 |
| Owner | Alexander Wohlford |
| Jira | [CBD-82](https://cobudget.atlassian.net/browse/CBD-82) |
| Parent | [CBD-22](https://cobudget.atlassian.net/browse/CBD-22) |
| Governing account model | CBD-92 v1.0.1 `CA-92-001`–`CA-92-013`. **v0.2 correction:** v0.1 stated the set ended at `CA-92-012`; `CA-92-013` governs membership loss and subject loss and was missing. See the traceability discrepancy register |
| Governing permission model | CBD-72 v0.1.54 — §2.1, §2.2, §5.3, §6 |
| Data inventory | CBD-91 v1.0.5 — `DI-91-013`, `DI-91-046`, `EG-91-012`, `EG-91-021`, and §7.2 |
| Abuse and coercion analysis | CBD-93 v1.1.2 — `AB-93-019`, `AB-93-045`, and the §13 joint-projection coverage gap |
| Risk and verification registers | CBD-94 v1.0.4; CBD-95 v1.0.7 package manifest |
| Connection and provenance boundary | CBD-107 v1.0 — `FC-107-*` connection contracts and its `CA-92-013` dependency |
| Period and cadence model | CBD-67 v1.3; CBD-71 v1.1.3 — the schedule that future routing attributes into |
| Architecture decision closed | `RF-92-006`, in part; see §13 |
| Scenario catalog | `docs/cbd-82-account-lifecycle-scenario-catalog.md` |
| Traceability | `docs/cbd-82-acceptance-criteria-traceability.md` |
| Mechanical audit | `python3 scripts/audit-cbd-82.py` |
| Last updated | September 12, 2026 |

> **Authority.** CBD-92 `CA-92-*` decides the model and CBD-72 decides the permissions. This document makes both implementable: it names entities, identifiers, cardinalities, states, and outcomes so that a sibling task can build and test the boundary without making a product decision. Where it appears to change a governing rule, the governing source wins and this document is wrong.

## 1. Purpose and contract

`RF-92-006` records that the `CA-92-*` account model and the `PA-92-*` deletion semantics are established while the concrete schema and executable contracts are not. This document supplies the missing half that is decidable now: the logical model. It does not select a database, define physical tables, or choose a provider.

The test it must pass is the one `RF-92-006` states. No single identifier, event, connection, normalization decision, link actor, confirmation, lifecycle event, restoration, or stale link may grant, correlate, route, retain, restore, or terminate authority in another profile or another space. Every rule below exists to make one of those impossible.

## 2. Scope and authority

In scope: logical entities and their fields; identifiers and their stability; cardinality and uniqueness; the authority matrix; the account-to-space link contract; canonicalization and joint projection; lifecycle states and the outcome matrix; prohibitions; retention and audit obligations.

Out of scope: physical schema and migrations, the profile and preferences API, provider synchronization, and user interface. Those are sibling CBD-22 tasks and consume this document rather than revising it.

Two domains exist and neither is subordinate. **`EG-91-021` is answered here:** the financial profile is the authoritative steward of connections, canonical accounts, and provenance; the budget space is the authoritative steward of its own overlays and visibility. Neither reads the other's private state, and the account-to-space link is the only bridge. That answer is not new — it is `CA-92-001` and `CA-92-005` read together — but `EG-91-021` asked for it to be stated as a single decision, and §5 states it.

## 3. Logical entities

| ID | Entity | Authoritative domain | Identifier | Lifecycle states | Notes |
| --- | --- | --- | --- | --- | --- |
| `EN-82-01` | Account subject | Identity | Opaque, stable, never reused | `active` -> `deletion requested` -> `deleted` | The authenticated person. A later account reusing a contact identifier is a different subject (`PA-92-007`) |
| `EN-82-02` | Financial profile | Profile | Opaque; one active per subject | `absent` -> `active` -> `deleted` | The authority domain for everything below it. No selector, transfer, merge, split, nesting, or sharing exists |
| `EN-82-03` | Provider connection | Profile | Opaque, profile-scoped | `pending authorization` -> `active` -> `degraded` -> `repair required` -> `disconnected` -> `revoked` | Carries its own consent, secret reference, cursor, revocation state, repair state, and lifecycle. Exactly one authorizer |
| `EN-82-04` | Connection observation | Profile | Opaque, connection-scoped | `recorded` -> `superseded` -> `purged` | The immutable provider-supplied record. Never edited; corrections arrive as later observations |
| `EN-82-05` | Profile-local canonical account | Profile | Opaque, profile-scoped | `active` -> `superseded by merge` -> `restored by split` -> `deleted` | The normalized account. Belongs to exactly one profile and never spans profiles |
| `EN-82-06` | Provenance edge | Profile | Composite of account and connection | `active` -> `detached` -> `purged` | Reversible. Records which connection contributed which observations to which canonical account, and on what basis |
| `EN-82-07` | Account-to-space link | Shared boundary | Opaque; versioned | `proposed` -> `active` -> `superseded` -> `removed` | Binds exactly one canonical account, one contributing subject, and one budget space. The only bridge between domains |
| `EN-82-08` | Budget-scoped joint projection | Budget space | Opaque, space-scoped; versioned | `proposed` -> `active` -> `dissolved` | References two or more current links for presentation and duplicate prevention in one space only |
| `EN-82-09` | Projection source reference | Budget space | Composite of projection and link | `active` -> `removed` | Reversible. Removing one leaves the others intact |
| `EN-82-10` | Non-association decision | Budget space | Opaque, space-scoped | `recorded` -> `superseded by new evidence` | Records a rejected association bound to the exact evidence version that was rejected |
| `EN-82-11` | Space-local account overlay | Budget space | Composite of link and space | `active` -> `frozen by archival` -> `removed` | Alias, classification, and other space-specific presentation. Never alters a provider fact |
| `EN-82-12` | Joint-association proposal | Budget space | Opaque; versioned; expiring | `open` -> `confirmed` / `declined` / `expired` -> `committed` / `failed` | Carries every contributor, version, candidate, disclosure version, and expiry for a `CA-92-010` ceremony |

Identifiers are opaque and stable. None encodes a provider identifier, an account number, a subject, or a space, because an identifier that encodes its context becomes a correlation channel across the boundary this model exists to hold.

### 3.1 Field-level logical schema and retention inventory

This inventory is the field-level half of the logical schema and the field half of the retention record, stated once so the two cannot drift apart. Every retained field carries a purpose, an audience, a sensitivity class, and either a retention rule or a named gate, as `DR-82-01` requires. A field that cannot be given all four is not persisted.

Sensitivity uses the CBD-91 §2.1 classes `S0` Public, `S1` Internal, `S2` Sensitive, `S3` Restricted, and `S4` Secret. Audience uses the CBD-72 role vocabulary: Primary Owner, Co-owner, Collaborator, Viewer, and Accountability Partner. "Profile subject" means the authenticated person the profile belongs to. "Space" means the members of a linked budget space, each at their permitted role, and never implies more than the safe representation `LK-82-04` grants.

Completeness is claimed at the logical level only: these are the fields the twelve entities of §3 retain. Physical columns, indexes, and derived storage remain unmade under `OI-82-001`, and any field added there inherits this same four-part obligation.

| ID | Entity | Field | Purpose | Audience | Sensitivity | Retention rule or named gate |
| --- | --- | --- | --- | --- | --- | --- |
| `FD-82-001` | `EN-82-01` | Subject identifier | Stable opaque reference to the authenticated person | System; profile subject | `S2` | Life of the subject; a content-free tombstone survives deletion under `PA-92-006` |
| `FD-82-002` | `EN-82-01` | Deletion state and tombstone | Prevent identifier reuse and prove a deletion occurred without retaining its content | System; auditor | `S2` | Survives deletion by design; per-class disposition gated by `EG-91-001` and `OI-82-003` |
| `FD-82-003` | `EN-82-02` | Profile identifier | Stable opaque reference to the one active profile | System; profile subject | `S2` | Life of the profile; removed with the subject under `PA-92-006` |
| `FD-82-004` | `EN-82-02` | Subject reference | Bind the profile to exactly one subject, enforcing `CD-82-01` | System | `S2` | With the profile |
| `FD-82-005` | `EN-82-02` | Profile created at | Establish ordering for first-use and audit reconstruction | System; auditor | `S1` | With the profile |
| `FD-82-006` | `EN-82-03` | Connection identifier | Stable opaque reference to one provider connection | System; profile subject | `S2` | Life of the connection; retained after disconnect under `DR-82-04` |
| `FD-82-007` | `EN-82-03` | Profile reference | Bind the connection to exactly one profile, enforcing `CD-82-02` | System | `S2` | With the connection |
| `FD-82-008` | `EN-82-03` | Authorizer reference | Name the single individual authorizer, fixed for life under `AU-82-02` | System; profile subject | `S3` | With the connection; never rewritten by transfer, role change, or membership loss |
| `FD-82-009` | `EN-82-03` | Provider reference | Identify which provider the connection speaks to | System; profile subject | `S3` | With the connection |
| `FD-82-010` | `EN-82-03` | Secret reference | Locate provider credential material held in the secret store | System only; never a space, export, audit payload, or notice | `S4` | Destroyed on revocation as supported; never projected under `DR-82-02` |
| `FD-82-011` | `EN-82-03` | Synchronization cursor | Resume provider synchronization without refetching history | System only | `S3` | Discarded on disconnect; never projected under `DR-82-02` |
| `FD-82-012` | `EN-82-03` | Consent record and version | Prove what the authorizer agreed to and when | System; profile subject; auditor | `S3` | Retained as evidence of authorization; period gated by `EG-91-001` |
| `FD-82-013` | `EN-82-03` | Connection lifecycle state | Drive `OC-82-03` and the §8.3 connection state machine | System; profile subject; space sees only the derived not-syncing marker | `S2` | With the connection |
| `FD-82-014` | `EN-82-03` | Repair state | Route reauthorization without exposing the failure to a space | System; profile subject | `S3` | Cleared on successful repair; never projected under `AU-82-01` |
| `FD-82-015` | `EN-82-03` | Revocation record | Prove revocation was requested, delivered, or lost, feeding `DS-82-04` | System; profile subject; auditor | `S2` | Retained after revocation as audit evidence under `DR-82-04` |
| `FD-82-016` | `EN-82-03` | Last successful synchronization at | Establish staleness for the not-syncing marker | System; space as a coarse freshness signal | `S2` | With the connection |
| `FD-82-017` | `EN-82-04` | Observation identifier | Stable reference to one immutable provider record | System | `S3` | With the observation under `DR-82-04` |
| `FD-82-018` | `EN-82-04` | Connection reference | Bind the observation to exactly one connection, enforcing `CD-82-04` | System | `S3` | With the observation |
| `FD-82-019` | `EN-82-04` | Normalized provider payload | The provider-supplied financial facts the canonical account derives from | System; space only through the safe representation | `S3` | Retained under CBD-91 §7.2; period gated by `OI-82-003` |
| `FD-82-020` | `EN-82-04` | Observed at and received at | Distinguish provider time from arrival time so `CR-82-04` can reject a stale observation deterministically | System; auditor | `S3` | With the observation |
| `FD-82-021` | `EN-82-04` | Supersedes reference | Chain a correction to the observation it corrects without editing either | System; auditor | `S3` | With the observation |
| `FD-82-022` | `EN-82-05` | Canonical account identifier | Stable profile-scoped reference to the normalized account | System; profile subject; space through a link | `S3` | Life of the account |
| `FD-82-023` | `EN-82-05` | Profile reference | Bind the account to exactly one profile, enforcing `CD-82-05` | System | `S3` | With the account |
| `FD-82-024` | `EN-82-05` | Normalized institution | Present and group the account | Profile subject; space through a link | `S3` | With the account |
| `FD-82-025` | `EN-82-05` | Display label | Name the account for its holder and, through a link, a space | Profile subject; space through a link | `S3` | With the account |
| `FD-82-026` | `EN-82-05` | Masked account identifier | Let a person recognize their own account without exposing a full number | Profile subject; space through a link | `S3` | With the account; the unmasked number is never retained |
| `FD-82-027` | `EN-82-05` | Account type | Drive classification and routing | Profile subject; space through a link | `S3` | With the account |
| `FD-82-028` | `EN-82-05` | Currency | Prevent incorrect aggregation | Profile subject; space through a link | `S3` | With the account |
| `FD-82-029` | `EN-82-05` | Current balance | Present the account and compute derived values | Profile subject; space through a link | `S3` | Current value only; history follows CBD-91 §7.2 |
| `FD-82-030` | `EN-82-05` | Account lifecycle state | Drive merge, split, and deletion behavior | System; profile subject | `S2` | With the account |
| `FD-82-031` | `EN-82-06` | Account and connection references | The composite key proving which connection contributed to which account, enforcing `CD-82-06` | System; profile subject; never a space under `AU-82-04` | `S3` | Permitted immutable provenance; never promised removable under `DR-82-03` |
| `FD-82-032` | `EN-82-06` | Association basis | Record whether reliable provider identity or explicit confirmation established the edge, so `AS-82-03` can reverse it | System; profile subject; auditor | `S3` | With the edge |
| `FD-82-033` | `EN-82-06` | Established at and detached at | Make canonicalization and its reversal reconstructable | System; auditor | `S3` | With the edge |
| `FD-82-034` | `EN-82-07` | Link identifier | Stable reference to the one bridge between domains | System; contributing subject; space | `S2` | Life of the link; retained after removal as audit evidence |
| `FD-82-035` | `EN-82-07` | Account reference | Name the one canonical account the link exposes | System; contributing subject | `S3` | With the link |
| `FD-82-036` | `EN-82-07` | Contributing subject reference | Attribute the contribution and enforce `AU-82-03` and `CD-82-11` | System; space as attribution | `S3` | With the link; retained after removal to attribute history |
| `FD-82-037` | `EN-82-07` | Space reference | Bind the link to exactly one budget space, enforcing `CD-82-07` | System | `S2` | With the link |
| `FD-82-038` | `EN-82-07` | Link version | Resolve every read, route, and derived value under `LK-82-03` and settle concurrency under `LC-82-04` | System; auditor | `S2` | With the link; superseded versions retained for audit |
| `FD-82-039` | `EN-82-07` | Disclosure version acknowledged | Prove what the contributor was shown before consenting under `LK-82-02` | System; contributing subject; auditor | `S2` | Retained as consent evidence; period gated by `EG-91-001` |
| `FD-82-040` | `EN-82-07` | Link state | Drive the §8.3 link state machine and fail closed under `LK-82-05` | System; space | `S2` | With the link |
| `FD-82-041` | `EN-82-07` | Created at and removed at | Bound the window in which the space was entitled to see the account | System; auditor | `S2` | With the link |
| `FD-82-042` | `EN-82-08` | Projection identifier | Stable space-scoped reference to one joint projection | System; space | `S2` | Life of the projection |
| `FD-82-043` | `EN-82-08` | Space reference | Bind the projection to exactly one space, enforcing `CD-82-09` | System | `S2` | With the projection |
| `FD-82-044` | `EN-82-08` | Projection version and state | Settle concurrent commits and drive automatic dissolution under `CD-82-10` | System; auditor | `S2` | With the projection |
| `FD-82-045` | `EN-82-08` | Formed at and dissolved at | Make deduplication history reconstructable | System; auditor | `S2` | With the projection |
| `FD-82-046` | `EN-82-09` | Projection and link references | The composite key making each source removable without disturbing the others | System; space | `S2` | With the source reference |
| `FD-82-047` | `EN-82-09` | Added at and removed at | Attribute a deduplication change to a moment | System; auditor | `S2` | With the source reference |
| `FD-82-048` | `EN-82-10` | Non-association decision identifier | Stable space-scoped reference to a refusal | System; space | `S2` | Retained so the same stale signal cannot recreate the association; period gated by `OI-82-003` |
| `FD-82-049` | `EN-82-10` | Space reference | Confine the decision to one space, enforcing `CD-82-12` | System | `S2` | With the decision |
| `FD-82-050` | `EN-82-10` | Candidate set | Record exactly what was refused | System; auditor; never another contributor under `PB-82-07` | `S3` | With the decision |
| `FD-82-051` | `EN-82-10` | Rejected evidence version | Bind the refusal to the evidence version so `AS-82-08` can tell new evidence from a replay | System; auditor | `S3` | With the decision |
| `FD-82-052` | `EN-82-10` | Recorded at | Order the refusal against later evidence | System; auditor | `S2` | With the decision |
| `FD-82-053` | `EN-82-11` | Overlay identifier | Stable reference to space-local presentation | System; space | `S2` | With the overlay |
| `FD-82-054` | `EN-82-11` | Link and space references | Confine the overlay to one link in one space | System | `S2` | With the overlay |
| `FD-82-055` | `EN-82-11` | Alias and classification | Let a space name and categorize an account without altering a provider fact | Space at permitted role | `S3` | Frozen on archival; removed with the space under CBD-91 §7.2 |
| `FD-82-056` | `EN-82-11` | Updated at and editing member | Attribute an overlay change | System; space; auditor | `S3` | With the overlay |
| `FD-82-057` | `EN-82-12` | Proposal identifier | Stable reference to one `CA-92-010` ceremony | System; contributors | `S2` | Until commit, decline, or expiry, then retained as audit evidence |
| `FD-82-058` | `EN-82-12` | Space reference | Confine the ceremony to one space | System | `S2` | With the proposal |
| `FD-82-059` | `EN-82-12` | Contributor set | Name every subject whose confirmation is required under `AS-82-05` | System; each contributor sees only their own obligation | `S3` | With the proposal |
| `FD-82-060` | `EN-82-12` | Candidate set and source versions | Bind the ceremony to exact links and versions so `AS-82-06` can recheck at commit | System; auditor | `S3` | With the proposal |
| `FD-82-061` | `EN-82-12` | Disclosure version | Prove what each contributor was shown | System; contributors; auditor | `S2` | Retained as consent evidence; period gated by `EG-91-001` |
| `FD-82-062` | `EN-82-12` | Per-contributor confirmation state | Drive the atomic commit while staying invisible to other contributors under `PB-82-07` | System; the confirming contributor; auditor | `S3` | With the proposal; never disclosed across contributors |
| `FD-82-063` | `EN-82-12` | Expiry | Make an unanswered ceremony indistinguishable from a decline under `AS-82-07` | System; contributors | `S2` | With the proposal |
| `FD-82-064` | `EN-82-12` | Proposal state | Drive the §8.3 proposal state machine | System; contributors | `S2` | With the proposal |

## 4. Cardinality and uniqueness

| ID | Rule | Source |
| --- | --- | --- |
| `CD-82-01` | One account subject has exactly one active financial profile. Zero is the state before first use; two is prohibited | `CA-92-012` |
| `CD-82-02` | One financial profile has zero or more provider connections. One connection belongs to exactly one profile | `CA-92-012` |
| `CD-82-03` | One connection has exactly one authorizer, who is the profile subject. The authorizer is fixed for the life of the connection | `CA-92-002` |
| `CD-82-04` | One connection produces zero or more observations. One observation belongs to exactly one connection | `CA-92-002` |
| `CD-82-05` | One profile has zero or more canonical accounts. One canonical account belongs to exactly one profile | `CA-92-012` |
| `CD-82-06` | One canonical account carries one or more provenance edges. One edge names exactly one canonical account and exactly one connection | `CA-92-003` |
| `CD-82-07` | One canonical account has zero or more account-to-space links. One link names exactly one account, one contributing subject, and one budget space | `CA-92-004` |
| `CD-82-08` | A canonical account has at most one active link per budget space. A second link to the same space is a version of the first, not a sibling | `CA-92-004` |
| `CD-82-09` | One budget space has zero or more joint projections. One projection belongs to exactly one space | `CA-92-008` |
| `CD-82-10` | One projection references two or more current links, each through exactly one source reference. A projection of one is not a projection and is dissolved automatically | `CA-92-008`, `CA-92-011` |
| `CD-82-11` | Two links in one projection never share a contributing subject. A person contributes at most one source to a given projection | `CA-92-008` |
| `CD-82-12` | A non-association decision names exactly one space, one candidate set, and the evidence version rejected. It does not span spaces | `CA-92-011` |

**The prohibited relations are as load-bearing as the permitted ones.** There is no entity joining two profiles, no entity joining two spaces, no application-wide canonical account, and no path from a projection in one space to anything in another. If a future requirement seems to need one, it is a change to `CA-92-*`, not to this document.

## 5. The authority matrix

Five actors appear, and the model works only because they are kept distinct.

| ID | Rule |
| --- | --- |
| `AU-82-01` | The **profile subject** is the sole actor for connection creation, repair, reauthorization, disconnect, and every private connection field. No budget role reaches these, ever, including a Primary Owner of a space the account is linked to |
| `AU-82-02` | The **connection authorizer** is the profile subject and does not change. Ownership transfer, membership loss, role change, archival, and deletion never move it (`CA-92-002`, CBD-12-AC28) |
| `AU-82-03` | The **contributing member** is a subject who holds both a profile account and a current membership in the space. Only they may create a link from their own account to that space (`CA-92-009`) |
| `AU-82-04` | A **Primary Owner or Co-owner** may unlink any account-to-space link in their space and may dissolve a projection there. That authority stops at the boundary: it grants no connection access, no repair, no reauthorization, no disconnect, no provenance view, and nothing in another space (`CA-92-009`, `CA-92-011`) |
| `AU-82-05` | A **Collaborator** may link their own account and may unlink only their own link. They hold no owner unlink authority |
| `AU-82-06` | A **Viewer or Accountability Partner** may do neither. They read what their role permits through §7 and nothing more |
| `AU-82-07` | Link creation requires no separate owner approval. The contributing member's own authority is sufficient, because they are sharing their own account into a space they already belong to (`CA-92-009`) |
| `AU-82-08` | Termination is two-sided. The contributing subject or a current Primary Owner or Co-owner may unlink; either is sufficient and neither needs the other (`CA-92-009`) |
| `AU-82-09` | Every operation rechecks current role, entitlement, link version, projection version, and lifecycle state at commit. A check at request time is not a check |
| `AU-82-10` | Nobody may link another person's account. There is no delegation, no invitation, and no owner-initiated link on a member's behalf |

## 6. The account-to-space link

The link is the only bridge between the two domains, so its contract carries the whole boundary.

| ID | Rule |
| --- | --- |
| `LK-82-01` | A link starts default-deny. Until it exists and is active, the space sees no account, no balance, no transaction, and no signal that an account exists |
| `LK-82-02` | Creation requires the contributing member's current authority, a current membership, and an explicit disclosure of what the space will see, what will synchronize, what unlinking stops, and what history is retained afterwards |
| `LK-82-03` | The link carries a version. Every read, route, projection, and derived value resolves against the current version, and a version change invalidates open work rather than mutating it |
| `LK-82-04` | The link grants the safe account representation and future routing for that space only. It grants no private connection control, no source provenance, no membership, no ownership, and nothing in another space |
| `LK-82-05` | Absence, ambiguity, staleness, or removal fails closed. A missing link is never treated as an unrestricted link |
| `LK-82-06` | Removal is atomic, immediately suppresses link-authorized work, recomputes projections and derived values, notifies safely, and is audited |
| `LK-82-07` | A provider identifier, webhook, normalization match, or previously removed link cannot create or reactivate a link. Reactivation is a new link with a new version and a new disclosure |

## 7. Canonicalization and joint projection

Two different questions are often confused, and separating them is most of the safety.

**Within one profile** (`AS-82-01`–`AS-82-03`), observations from different connections may share a normalized canonical account when approved reliable provider identity or the subject's explicit confirmation establishes it. Every contributing connection keeps a reversible provenance edge. Weak identifiers, names, balances, timing, and membership never merge records on their own.

**Across profiles** (`AS-82-04`–`AS-82-08`), nothing merges. A budget-scoped joint projection is a presentation and duplicate-prevention device inside one space. It has no application-wide identity, reveals no other profile or space, and is recomputed whenever a source, connection, or link changes.

| ID | Rule |
| --- | --- |
| `AS-82-01` | Profile-local canonicalization requires approved reliable provider identity or the subject's explicit confirmation. Nothing else suffices |
| `AS-82-02` | Every canonical account retains a reversible edge to each contributing connection and its observations. Canonicalization is never destructive |
| `AS-82-03` | A canonical split restores separate accounts and preserves both histories. It never deletes an observation |
| `AS-82-04` | A joint projection requires every source to be explicitly linked to that space first. A link is a precondition, not a consequence |
| `AS-82-05` | Where reliable provider identity does not establish the association, every distinct contributing subject must confirm explicitly, against the exact space, representations, effect, and boundary. A non-contributing owner cannot substitute for a contributor (`CA-92-010`) |
| `AS-82-06` | The proposal binds every contributor, version, candidate, disclosure version, and expiry. All confirmations and versions are rechecked at one atomic commit |
| `AS-82-07` | A decline, expiry, membership change, link change, missing confirmation, or ambiguous participant set leaves every candidate separate, and reveals neither another person's response nor a private association |
| `AS-82-08` | A rejected association records a space-scoped non-association decision bound to the evidence version rejected, so the same stale signal cannot immediately recreate it. Re-association needs materially new approved evidence or a fresh unanimous confirmation |

### 7.1 Correction, retry, and repair

Association can be wrong, and a model that only describes how associations form is untestable in the direction that matters. These rules state who may correct what, and what a provider retry or a late correction is allowed to change. They are separated from `AS-82-*` because forming an association and undoing one answer different questions and carry different authority.

| ID | Rule |
| --- | --- |
| `CR-82-01` | A **contributing subject** may correct a projection they participate in, by removing their own source or by requesting dissolution. Neither needs another contributor's permission, and neither reveals another contributor's response (`PB-82-07`) |
| `CR-82-02` | A **Primary Owner or Co-owner** may dissolve a projection in their own space they judge wrong. That correction stops at the boundary: it grants no connection access, no provenance view, and no profile-local merge or split (`AU-82-04`) |
| `CR-82-03` | Only the **profile subject** may correct a profile-local canonicalization, by confirming an association or splitting one (`AS-82-03`). No budget role may, in any space, at any time |
| `CR-82-04` | A **stale observation** whose observed-at precedes the current provenance state is recorded against its own connection and changes nothing. It does not re-merge a split account, re-route a moved transaction, or reactivate a removed link |
| `CR-82-05` | A **provider retry or redelivery** is idempotent on observation identity: repeated delivery of the same provider event yields at most one observation and no duplicate derived value. A retry never creates an account, a link, or a projection |
| `CR-82-06` | A retry arriving after a disconnect, a revocation, or a link removal **fails closed**. It is recorded as historical against its connection and reactivates nothing (`PB-82-04`, `LK-82-07`) |
| `CR-82-07` | A **provider correction** arrives as a later observation carrying a supersedes reference. The earlier observation is never edited or deleted, derived values recompute deterministically, and the correction chain stays readable (`FD-82-021`) |
| `CR-82-08` | A space may **withdraw its own non-association decision**. Withdrawal alone forms nothing; a projection still requires the full `AS-82-05` confirmation path |
| `CR-82-09` | Every correction is audited under `AE-82-01` and notified within the `AE-82-03` channel ceiling. A correction notice names no other contributor's decision and no private provenance |

## 8. Lifecycle and the outcome matrix

Seven events change what a space can see, and the value of these tables is that they differ. §8.1 states where each event reaches; §8.2 states what each event leaves behind. They are split because a single nine-column matrix was unreadable, not because the two halves are independent: every event appears in both.

### 8.1 Scope effects

| ID | Event | Space visibility | Future sync and routing | Connection | Other spaces |
| --- | --- | --- | --- | --- | --- |
| `OC-82-01` | Budget unlink | Stops for that space | Stops for that space | Untouched and still active | Unaffected |
| `OC-82-02` | Projection dissolution | Sources appear separately | Continues per link | Untouched | Unaffected |
| `OC-82-03` | Provider disconnect or revocation | Marked not syncing | Stops for that connection only | Terminated for that connection only | Unaffected except through shared links |
| `OC-82-04` | Authorizer membership loss | Stops for that space; retained history is labeled orphaned and not synchronizing | Stops through that authorizer's links to that space | Untouched; authority never transfers | Unaffected |
| `OC-82-05` | Budget-space archival | Stops active use | Stops generating | Untouched | Unaffected |
| `OC-82-06` | Reconnect | Requires a new link | Resumes only through a new active link | New or repaired connection | Unaffected |
| `OC-82-07` | Account-subject deletion | Stops immediately | Stops immediately | Revoked and destroyed as supported | Links removed; no space inherits authority |

### 8.2 Record effects

The event name leads each row here because the identifier is defined once, in §8.1.

| Event | Rule | Retained history | Provenance | Customer notice | Audit |
| --- | --- | --- | --- | --- | --- |
| Budget unlink | `OC-82-01` | Retained under CBD-91 §7.2 | Edges untouched and still immutable | Contributing subject and current owners told the link ended; no channel names the account beyond the `AE-82-03` ceiling | Link-removal event with actor, space, link version, and outcome |
| Projection dissolution | `OC-82-02` | Retained; deduplication recomputed | Source edges preserved and reversible; nothing removed | Space members see the sources separate again; no contributor's decision is revealed (`PB-82-07`) | Dissolution event naming the projection version, never a contributor response |
| Provider disconnect or revocation | `OC-82-03` | Retained with provenance | Edges retained and marked detached at; nothing purged | Authorizer told directly; every affected space sees only the not-syncing marker | Disconnect event plus the revocation delivery result recorded under `FD-82-015` and `DS-82-04` |
| Authorizer membership loss | `OC-82-04` | Retained, attributed, and labeled orphaned and not synchronizing; any joint projection recomputes from the remaining independently authorized sources (`CA-92-013`) | Edges untouched; attribution to the former member preserved | Remaining members see attribution preserved; the departing member learns nothing beyond the disclosure they accepted | Membership-driven stop event. No authority-transfer event exists to emit, because no transfer occurs |
| Budget-space archival | `OC-82-05` | Preserved entirely | Preserved and frozen | Members told the space is archived; overlays freeze under `FD-82-055` | Archival event recording the frozen scope |
| Reconnect | `OC-82-06` | Reconciled, never resurrected | New edges created; detached edges stay detached and are not revived | A new disclosure is presented and acknowledged under `LK-82-02` | New-link event carrying the new link version and new disclosure version |
| Account-subject deletion | `OC-82-07` | Per `PA-92-006` disposition | Permitted immutable provenance retained where `PA-92-006` allows; copy never promises its removal (`DR-82-03`) | Deletion receipt is content-free; no space is told what the subject deleted | Deletion event plus the tombstone recorded under `FD-82-002` |

| ID | Rule |
| --- | --- |
| `LC-82-01` | Unlink and disconnect are different events affecting different scopes, and conflating them is the defect this table exists to prevent (`CA-92-007`) |
| `LC-82-02` | Authorizer membership loss invalidates that subject's account-to-space links **for that space only**. It stops synchronization and link-authorized work there, preserves imported records and provenance, labels the retained history orphaned and not synchronizing, recomputes any joint projection from the remaining independently authorized sources, and never transfers connection authority or activates another connection automatically. It does not disconnect a profile-level connection that stays authorized for the profile or for another linked space. **Rejoining grants nothing back:** it requires a new `CA-92-009` link under current membership and disclosure versions, and a different entitled member may restore coverage only through their own connection under `CA-92-008` to `CA-92-010` (`CA-92-013`, `CA-92-002`; CBD-12 in-scope) |
| `LC-82-03` | A partial failure in any multi-step operation leaves the prior state intact. There is no half-linked, half-projected, or half-dissolved state |
| `LC-82-04` | Concurrency is resolved by version, not by arrival order. A stale actor's commit fails and is audited rather than overwriting a newer decision |

### 8.3 State machines

Three entities have a lifecycle worth drawing. The rest move between the states listed in §3 without a branch worth a table.

**Provider connection.**

| State | Trigger | Next state | Guard |
| --- | --- | --- | --- |
| `pending authorization` | The authorizer completes provider authorization | `active` | The authorizer is the profile subject and is fixed from here (`AU-82-02`) |
| `active` | Credential expires or the provider errors | `degraded` | None; the space sees only the not-syncing marker |
| `degraded` | Repair succeeds | `active` | Only the authorizer may repair (`AU-82-01`) |
| `degraded` | Repair threshold reached | `repair required` | None |
| `repair required` | The authorizer reauthorizes | `active` | The authorizer is unchanged; no new authorizer may be set |
| `active`, `degraded`, `repair required` | The authorizer disconnects | `disconnected` | Only the authorizer (`AU-82-01`) |
| `disconnected` | Revocation confirmed delivered | `revoked` | An unconfirmed revocation does not reach `revoked` (`DS-82-04`) |
| Any | Account-subject deletion | `revoked` | `OC-82-07`; destroyed as far as the provider supports |
| Any | Provider event, webhook, or link change | Unchanged | `PB-82-04`; no external event moves a connection |

**Account-to-space link.**

| State | Trigger | Next state | Guard |
| --- | --- | --- | --- |
| `proposed` | The contributor accepts the disclosure | `active` | Current contributing-member authority and current membership (`LK-82-02`) |
| `active` | The contributor or a current owner unlinks | `removed` | Either is sufficient and neither needs the other (`AU-82-08`) |
| `active` | A new link is created for the same account and space | `superseded` | The new link carries a new version and a new disclosure (`CD-82-08`) |
| `active` | The space is archived | `active`, frozen | `OC-82-05`; archival does not remove the link |
| `removed` | A new link is created | `proposed` | A new link, never a revival of the old one (`LK-82-07`) |
| Any | Provider event or normalization match | Unchanged | `PB-82-04` |

**Joint-association proposal and projection.**

| State | Trigger | Next state | Guard |
| --- | --- | --- | --- |
| `open` | Every contributor confirms before expiry | `committed`, projection `active` | Atomic recheck of every version at one commit (`AS-82-06`) |
| `open` | Any contributor declines | `declined`; candidates stay separate | Not revealed to other contributors (`AS-82-07`) |
| `open` | Expiry is reached | `expired`; candidates stay separate | Indistinguishable from a decline (`AS-82-07`) |
| `open` | A link or membership version changes | `failed`; candidates stay separate | `AS-82-06` |
| `active` | A source is removed leaving fewer than two | `dissolved` | Automatic; a projection of one is not a projection (`CD-82-10`) |
| `active` | A contributor or owner corrects | `dissolved` | `CR-82-01`, `CR-82-02` |
| `declined`, `expired` | The same evidence arrives again | No change | A non-association decision binds it (`AS-82-08`) |

### 8.4 Derived state, cache, and revocation propagation

Derived state is where a correct model leaks. A cache, index, or precomputed total that outlives the link it was built from becomes a second, unauthorized source of truth, and a revocation that is never delivered becomes a promise the product did not keep.

| ID | Rule |
| --- | --- |
| `DS-82-01` | Every cache, index, materialized view, and precomputed total depending on a link, link version, projection, or connection state is invalidated in the same atomic commit that changes it. A cache is never a second source of authority |
| `DS-82-02` | A read served from cache resolves the current link version first. An entry whose version no longer matches is discarded rather than served (`LK-82-03`, `LK-82-05`) |
| `DS-82-03` | Search results, suggestions, counts, totals, reports, and empty states are built per space from currently active links only. A removed or superseded link leaves no residue in any of them |
| `DS-82-04` | A revocation not confirmed delivered to the provider is recorded as undelivered and retried. The connection does not reach `revoked`, the space-visible not-syncing marker applies immediately regardless, and the discrepancy is audited and surfaced to the authorizer |
| `DS-82-05` | A lost or failed revocation never silently degrades to success, and a connection is never presented as revoked while the provider may still honor it |
| `DS-82-06` | Recomputation after any lifecycle event is deterministic and idempotent. Repeating it yields the same result and emits no duplicate notice |
| `DS-82-07` | Silent re-merge is prohibited. Any recomputation that would reunite records previously split or refused stops and requires `CR-82-03` confirmation or materially new approved evidence (`AS-82-08`) |

## 9. Prohibitions

| ID | Prohibited without exception |
| --- | --- |
| `PB-82-01` | Any application-wide, cross-person canonical account |
| `PB-82-02` | Automatic transfer of connection authority by any route |
| `PB-82-03` | Linking an account a person does not hold in their own profile |
| `PB-82-04` | Creating or reactivating a link from a provider event, identifier, match, or prior link |
| `PB-82-05` | Merging accounts on weak identifiers, names, balances, timing, or shared membership |
| `PB-82-06` | Exposing a projection, association, or non-association in one space to another space |
| `PB-82-07` | Disclosing another contributor's confirmation, decline, or private provenance |
| `PB-82-08` | Any budget role reaching a private connection field, secret, cursor, or repair path |
| `PB-82-09` | Treating a missing, stale, or ambiguous link as permission |
| `PB-82-10` | Resurrecting purged data through restore, replay, retry, or reconnect |

## 10. Data, retention, and notice

| ID | Requirement |
| --- | --- |
| `DR-82-01` | Every retained field carries a purpose, an audience, a sensitivity class, and a retention rule or a named gate. A field with none of these is not persisted |
| `DR-82-02` | Provider secrets, cursors, and private configuration live only in the profile domain and are never projected into a space, an export, an audit payload, or a notice |
| `DR-82-03` | Provenance edges are permitted immutable records. Customer copy never promises their removal, and never promises remote deletion of anything a recipient already holds |
| `DR-82-04` | Retained history after unlink or disconnect follows the CBD-91 §7.2 interim policy and remains subject to its gates. This document sets no retention period |
| `AE-82-01` | Link creation, link removal, projection formation, projection dissolution, source removal, non-association, disconnect, reconnect, and every denial produce an audit event bound to actor, space, versions, and outcome |
| `AE-82-02` | Audit payloads carry no provider secret, no raw observation, no other person's private state, and no cross-space correlation |
| `AE-82-03` | Notices are safe by the channel that carries them: the `NT-92-001` fixed body on push and SMS, the `EM-92-003` ceiling on lifecycle email, and full detail only on the authenticated in-app surface |

### 10.1 Retained-event inventory

`DR-82-01` states the obligation for fields and `AE-82-01` names the events. This table discharges both for events: every retained event carries a purpose, an audience, a sensitivity class, and a retention rule or a named gate. Sensitivity uses the CBD-91 §2.1 classes. No audit payload may carry a provider secret, a raw observation, another person's private state, or a cross-space correlation, whatever this table says about audience (`AE-82-02`).

| ID | Event | Purpose | Audience | Sensitivity | Retention rule or named gate |
| --- | --- | --- | --- | --- | --- |
| `EV-82-01` | Connection authorized | Prove consent and fix the authorizer for the life of the connection | Profile subject; auditor | `S3` | Retained as authorization evidence; period gated by `EG-91-001` |
| `EV-82-02` | Connection repair attempted or succeeded | Show the repair path ran without exposing failure detail to a space | Profile subject; auditor | `S3` | Retained with the connection; gated by `EG-91-001` |
| `EV-82-03` | Connection disconnected | Establish when provider synchronization ended | Profile subject; affected spaces as the not-syncing marker; auditor | `S2` | Retained under `DR-82-04` |
| `EV-82-04` | Revocation delivery result | Prove a revocation was delivered, or record that it was not, under `DS-82-04` and `DS-82-05` | Profile subject; auditor | `S2` | Retained as evidence; never overwritten by a later success |
| `EV-82-05` | Observation recorded | Establish the provider fact and its arrival time | System; auditor | `S3` | With the observation under CBD-91 §7.2 |
| `EV-82-06` | Observation superseded by correction | Make the correction chain readable without editing history (`CR-82-07`) | System; profile subject; auditor | `S3` | With the observation |
| `EV-82-07` | Stale observation rejected | Prove that a late arrival re-merged, re-routed, and reactivated nothing (`CR-82-04`) | System; auditor | `S3` | Retained; gated by `OI-82-003` |
| `EV-82-08` | Canonical merge | Record which basis established the association (`AS-82-01`) | Profile subject; auditor; never a space | `S3` | With the provenance edge |
| `EV-82-09` | Canonical split | Prove the merge was reversible and no observation was deleted (`AS-82-03`) | Profile subject; auditor; never a space | `S3` | With the provenance edge |
| `EV-82-10` | Link created | Bind the space's entitlement to an actor, a version, and a disclosure | Contributing subject; current owners; auditor | `S2` | Retained after removal as consent evidence; gated by `EG-91-001` |
| `EV-82-11` | Link version superseded | Show which version each read and route resolved against (`LK-82-03`) | System; auditor | `S2` | Retained with the link |
| `EV-82-12` | Link removed | Bound the entitlement window and prove the connection was untouched | Contributing subject; current owners; auditor | `S2` | Retained under `DR-82-04` |
| `EV-82-13` | Projection formed | Record the atomic commit and the versions it rechecked | Space; auditor | `S2` | Retained with the projection |
| `EV-82-14` | Projection source removed | Show one source separated without unlinking an account | Space; auditor | `S2` | Retained with the projection |
| `EV-82-15` | Projection dissolved | Distinguish automatic dissolution from a correction (`CD-82-10`, `CR-82-02`) | Space; auditor | `S2` | Retained with the projection |
| `EV-82-16` | Joint proposal opened, confirmed, declined, or expired | Drive the ceremony and prove unanimity where it was required | The acting contributor; auditor. Never another contributor (`PB-82-07`) | `S3` | Retained as consent evidence; gated by `EG-91-001` |
| `EV-82-17` | Non-association recorded or withdrawn | Bind a refusal to the evidence version it refused (`AS-82-08`, `CR-82-08`) | Space; auditor | `S3` | Retained so a replay cannot recreate the association; gated by `OI-82-003` |
| `EV-82-18` | Membership-loss stop applied | Prove the stop happened and that no authority transferred | Remaining members as attribution; auditor | `S2` | Retained under `DR-82-04`. No transfer event exists to emit |
| `EV-82-19` | Space archived | Record the frozen scope | Space members; auditor | `S2` | Preserved with the archived space |
| `EV-82-20` | Subject deletion applied | Prove a deletion occurred without retaining what was deleted | Auditor | `S2` | Content-free receipt; disposition under `PA-92-006` and `EG-91-001` |
| `EV-82-21` | Denial of any operation | Prove the boundary failed closed rather than silently allowing | Auditor | `S2` | Retained; gated by `EG-91-001` |

## 11. Handoff to sibling tasks

A sibling task implementing persistence, APIs, or synchronization consumes §3 through §10 and needs no new product decision. Where it finds one missing, that is a defect in this document and a change here, not a local choice.

The contracts below say what each named consumer may rely on and what it may not decide for itself. The second column matters more than the first: a consumer that finds itself choosing an authority, cardinality, lifecycle, or retention behavior has found a gap in this document.

| ID | Consumer | May rely on | Must not decide |
| --- | --- | --- | --- |
| `HO-82-01` | **CBD-212** — persist one financial profile per account subject | `CD-82-01` exactly one active profile per subject, with zero as the pre-first-use state and two prohibited; `EN-82-02` identifier discipline; `FD-82-003` to `FD-82-005` | Whether a second profile may exist, whether a profile may be selected, transferred, merged, or shared. All are prohibited. Physical schema stays at `OI-82-001` |
| `HO-82-02` | **CBD-214**, **CBD-216**, **CBD-219** — sibling CBD-22 implementation tasks | The §3.1 field inventory as the complete logical field set, the §8.3 state machines as the complete transition set, and §5 as the complete authority set | Any authority, cardinality, lifecycle, notice, or retention behavior not stated here. Their exact scope is defined in their own tickets and is not restated in this document |
| `HO-82-03` | **CBD-84** — linked-account scope across multiple budgets | `CD-82-07` and `CD-82-08`: one account may link to many spaces, at most one active link per space. `LK-82-04` grants that space only. `OC-82-01` unlink is per space. `DS-82-03` leaves no residue elsewhere. `LNK-82-T05`, `ISO-82-T01`, `ISO-82-T03`, `LIFE-82-T01` | That a cross-space account, a shared link, or an application-wide canonical account may exist. `PB-82-01` and `PB-82-06` prohibit all three |
| `HO-82-04` | **CBD-49** — budget-space consumption of linked accounts | The account-to-space link as the sole visibility precondition, default-deny under `LK-82-01`, and fail-closed on absence, ambiguity, or staleness under `LK-82-05` | That a missing, stale, or ambiguous link may be treated as permission, or that a provider event may create one (`PB-82-04`) |
| `HO-82-05` | **CBD-107** — connection and provenance boundary | The profile-side ownership model: one authorizer per connection (`AU-82-02`), reversible provenance (`AS-82-02`), and the `EN-82-03` field set in `FD-82-006` to `FD-82-016` | Provider selection and provider mechanics, which are CBD-107's own `FC-107-*` contracts. Reciprocally, CBD-107 does not decide profile cardinality or budget-link authority. `OI-82-004` closes when `EG-91-012` does |
| `HO-82-06` | **CBD-67** and **CBD-71** — period and cadence | That "future routing" in §8 means attribution into the periods the space's own schedule defines, and that unlink stops future routing without rewriting periods already attributed | The schedule model itself. CBD-82 consumes it and changes nothing in it |

## 12. Open issues

| ID | Issue | Status and effect |
| --- | --- | --- |
| `OI-82-001` | Physical schema, indexes, partitioning, and migration remain unmade. `RF-92-006` also names provider association signals and identity-verification implementation, which depend on the CBD-15 selection that has not happened | Open. This document closes the logical half of `RF-92-006` only, and says so in §13 rather than implying more |
| `OI-82-002` | No deterministic fixtures or negative tests exist yet. The scenario catalog states rule-level expectations that test design implements, following the disposition CBD-72 used for the same question | Open under the CBD-94 verification inventory |
| `OI-82-003` | Retention periods for provenance edges, non-association decisions, and post-unlink history are not set here and remain with `EG-91-001` and CBD-91 §7.2 | Open. `DR-82-04` binds |
| `OI-82-004` | `EG-91-012` provider identity reliability is unresolved until a provider is selected, so `AS-82-01`'s "approved reliable provider identity" has a shape but no concrete test | Open under CBD-15 and CBD-107. Until it closes, `CA-92-010` unanimous confirmation is the only available path |

## 13. What this closes, and what it does not

`RF-92-006` names five things: the physical schema, provider association signals, identity-verification implementation, the final per-class deletion disposition, and executable sync and lifecycle contracts.

v0.2 adds one correction that belongs here rather than in a footnote. v0.1 stated the governing account set as `CA-92-001` to `CA-92-012`. `CA-92-013` exists, governs membership loss and permanent subject loss, and is cited by CBD-93, CBD-102, and every CBD-107 document. It was missing, and `LC-82-02` was written against `CA-92-002` and CBD-12 instead of the contract that actually decides the case. §8 and `LC-82-02` now implement it, including the rejoin and restoration rules v0.1 omitted entirely.

This document supplies the logical model beneath the last of those and answers `EG-91-021`. It does not supply the other four, and three of them cannot be supplied until a provider is selected. `RF-92-006` should therefore be narrowed rather than closed when this package is approved, in the same way `CR-91-008` was narrowed rather than closed: the part that was decidable is decided, and the part that waits on evidence still waits.

## 14. Revision history

| Version | Date | Author | Change | Approval |
| --- | --- | --- | --- | --- |
| 0.2 | September 12, 2026 | Claude with Alexander Wohlford as Product Owner | Closed the seven criterion-level gaps found in the v0.1 review. Added §3 lifecycle states per entity and the §3.1 field-level logical schema and retention inventory, 64 fields each carrying purpose, audience, sensitivity, and a retention rule or named gate. Added `CR-82-01` to `CR-82-09` for correction, retry, and repair, which v0.1 named in its traceability and never stated. Split §8 into scope effects and record effects so provenance, customer notice, and audit have their own columns per event, and added §8.3 state machines for the connection, the link, and the joint proposal. Added `DS-82-01` to `DS-82-07` for cache invalidation, search and count residue, lost revocation, and silent re-merge, none of which v0.1 covered. Added the §10.1 retained-event inventory, 21 events on the same four-part obligation. Replaced the two-sentence §11 with explicit handoff contracts `HO-82-01` to `HO-82-06` naming CBD-212, CBD-214, CBD-216, CBD-219, CBD-84, CBD-49, CBD-107, CBD-67, and CBD-71. **Corrected the governing set from `CA-92-012` to `CA-92-013`** and rewrote `LC-82-02` against it, adding the rejoin, orphan-labeling, projection-recomputation, and restoration rules v0.1 omitted. No open issue was resolved: `OI-82-001` to `OI-82-004` and all five evidence gates stand. | Draft; Product Owner review required |
| 0.1 | September 3, 2026 | Claude with Alexander Wohlford as Product Owner | Initial complete draft. Twelve entities, twelve cardinality rules, ten authority rules, seven link rules, eight association rules, a seven-event outcome matrix with four lifecycle rules, ten prohibitions, seven data and audit requirements, and four open issues. Answers `EG-91-021` by naming the financial profile steward of connections, accounts, and provenance and the budget space steward of its own overlays, with the account-to-space link as the only bridge. | Draft; Product Owner review required |
