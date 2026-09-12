# CBD-82 — Account Lifecycle and Isolation Scenario Catalog

| Field | Value |
| --- | --- |
| Status | **Draft v0.2 — Product Owner review and approval required. Rule-level expectations only; deterministic fixtures are test-design scope under `OI-82-002`** |
| Document version | 0.2 |
| Owner | Alexander Wohlford |
| Jira | [CBD-82](https://cobudget.atlassian.net/browse/CBD-82) |
| Parent | [CBD-22](https://cobudget.atlassian.net/browse/CBD-22) |
| Governing model | `docs/cbd-82-financial-profile-and-account-ownership-model.md` |
| Traceability | `docs/cbd-82-acceptance-criteria-traceability.md` |
| Last updated | September 12, 2026 |

## 1. What these scenarios are

Rule-level acceptance evidence. Each row states a situation and the outcome the model requires, so that an implementation can be measured against it. None of them fixes a fixture, a date, an amount, or an identifier; that elaboration is test-design scope, carried by the CBD-94 verification inventory, following the disposition CBD-72 applied to the same question.

Every negative scenario exists because the model would otherwise be untestable in the direction that matters. It is easy to show that a link grants access. The rows below mostly show that something does not.

## 2. Coverage rule

Every scenario belongs to exactly one family and maps to at least one criterion in the traceability record. A new scenario must not create an observable distinction the isolation rules forbid.

This draft contains **59 scenarios** in nine families. v0.2 added the `CORR` and `DERIV` families, which cover the correction, retry, cache, count, and lost-revocation outcomes the v0.1 traceability record claimed and the catalog did not contain.

## 3. Scenario inventory

### 3.1 Link creation and removal — LNK, 7 scenarios

| ID | Scenario | Expected outcome | Source |
| --- | --- | --- | --- |
| `LNK-82-T01` | A member with no link opens the space | No account, balance, transaction, count, or existence signal appears | `LK-82-01` |
| `LNK-82-T02` | A Collaborator links their own account after the disclosure | The link is created, versioned, and active; the disclosure version is recorded | `LK-82-02`, `AU-82-03` |
| `LNK-82-T03` | A member attempts to link an account held in another person's profile | Denied with no state change; nothing reveals whether that account exists | `AU-82-10`, `PB-82-03` |
| `LNK-82-T04` | A Primary Owner attempts to link a member's account on their behalf | Denied. No delegation path exists | `AU-82-10` |
| `LNK-82-T05` | The same account is linked to a second budget space | Both links exist independently; neither space sees the other | `CD-82-07`, `LK-82-04` |
| `LNK-82-T06` | The same account is linked twice to one space | The second is a new version of the first, not a sibling | `CD-82-08` |
| `LNK-82-T07` | A Viewer or Accountability Partner attempts to create a link | Denied; no control is offered and the server refuses | `AU-82-06` |

### 3.2 Authority separation — AUTH, 6 scenarios

| ID | Scenario | Expected outcome | Source |
| --- | --- | --- | --- |
| `AUTH-82-T01` | A Primary Owner of a space where an account is linked attempts to repair, reauthorize, or disconnect the underlying connection | Denied. Owner unlink authority grants no connection access | `AU-82-01`, `AU-82-04` |
| `AUTH-82-T02` | A Primary Owner attempts to view source provenance for a linked account | Denied; the space sees the safe representation only | `AU-82-04`, `LK-82-04` |
| `AUTH-82-T03` | Primary ownership transfers to another member | No connection authorizer changes; no link is created or removed by the transfer | `AU-82-02` |
| `AUTH-82-T04` | The contributing subject unlinks their own account | Succeeds without owner involvement | `AU-82-08` |
| `AUTH-82-T05` | A Primary Owner unlinks a member's account from their space | Succeeds without contributor involvement; the connection is untouched | `AU-82-08`, `OC-82-01` |
| `AUTH-82-T06` | A role change lands between request and commit | The commit rechecks and fails closed; the denial is audited | `AU-82-09` |

### 3.3 Profile-local canonicalization — CANON, 6 scenarios

| ID | Scenario | Expected outcome | Source |
| --- | --- | --- | --- |
| `CANON-82-T01` | Two connections in one profile observe the same account with approved reliable provider identity | One canonical account with reversible edges to both connections | `AS-82-01`, `AS-82-02` |
| `CANON-82-T02` | Two observations share only a name, a balance, and a timing coincidence | No merge. They remain separate accounts | `AS-82-01`, `PB-82-05` |
| `CANON-82-T03` | The subject explicitly confirms an association the provider evidence did not establish | Merged, with both provenance edges retained | `AS-82-01` |
| `CANON-82-T04` | A previously merged canonical account is split | Two accounts with both histories preserved; no observation is deleted | `AS-82-03` |
| `CANON-82-T05` | A stale observation arrives after a split | It routes by provenance to its own connection and does not re-merge | `AS-82-03`, `CA-92-006` |
| `CANON-82-T06` | An observation arrives for a connection that has been disconnected | Recorded against that connection as historical; no space receives an update | `OC-82-03` |

### 3.4 Joint projection — JOINT, 8 scenarios

| ID | Scenario | Expected outcome | Source |
| --- | --- | --- | --- |
| `JOINT-82-T01` | Two subjects each link their own account for the same joint external account, with reliable provider identity | A budget-scoped projection forms; both source links remain separate and reversible | `AS-82-04`, `CD-82-10` |
| `JOINT-82-T02` | The same pair, without reliable provider identity | No projection until every contributor confirms explicitly | `AS-82-05` |
| `JOINT-82-T03` | One contributor declines | All candidates stay separate; the decline is not revealed to the other contributor | `AS-82-07`, `PB-82-07` |
| `JOINT-82-T04` | A proposal expires with one confirmation outstanding | Same outcome as a decline, and indistinguishable from it | `AS-82-07` |
| `JOINT-82-T05` | A Primary Owner attempts to confirm on a contributor's behalf | Denied. A non-contributing owner cannot substitute | `AS-82-05` |
| `JOINT-82-T06` | A link version changes between proposal and commit | The commit fails closed and leaves candidates separate | `AS-82-06` |
| `JOINT-82-T07` | A contributor removes their own source from a live projection | Their source separates; the others remain; deduplication recomputes; no account is unlinked | `CA-92-011`, `OC-82-02` |
| `JOINT-82-T08` | The same rejected evidence arrives again after a non-association decision | No projection re-forms. Re-association needs materially new evidence or a fresh unanimous confirmation | `AS-82-08` |

### 3.5 Lifecycle outcomes — LIFE, 8 scenarios

| ID | Scenario | Expected outcome | Source |
| --- | --- | --- | --- |
| `LIFE-82-T01` | An account linked to two spaces is unlinked from one | Only that space stops; the other continues; the connection stays active | `OC-82-01`, `LC-82-01` |
| `LIFE-82-T02` | The authorizer disconnects the provider connection | Every space fed by it marks the data not syncing; history and provenance are retained; no other connection is affected | `OC-82-03` |
| `LIFE-82-T03` | The authorizer loses membership in one space | Synchronization through their links to that space stops; records and attribution are preserved; authority does not transfer | `OC-82-04`, `LC-82-02` |
| `LIFE-82-T04` | Another connection in the same profile observes the same account after that membership loss | It does not activate automatically to fill the gap | `LC-82-02` |
| `LIFE-82-T05` | The budget space is archived | Active use and new alerts stop; every record is preserved; links are untouched | `OC-82-05` |
| `LIFE-82-T06` | A previously unlinked account is reconnected | A new link with a new version and a new disclosure is required; the old link does not revive | `OC-82-06`, `LK-82-07` |
| `LIFE-82-T07` | A multi-step link removal fails part way | The prior state remains; no half-removed link or half-dissolved projection exists | `LC-82-03` |
| `LIFE-82-T08` | Two actors act on the same link concurrently | The stale version fails and is audited; the newer decision stands | `LC-82-04` |

### 3.6 Cross-profile and cross-space isolation — ISO, 7 scenarios

| ID | Scenario | Expected outcome | Source |
| --- | --- | --- | --- |
| `ISO-82-T01` | A space searches for an account linked only to another space | No result, count, suggestion, or empty-state difference | `LK-82-04`, `PB-82-06` |
| `ISO-82-T02` | A report or total is requested where one input is outside the space | The value is omitted or replaced with a non-revealing explanation, never rendered as zero | CBD-72 §5.2 |
| `ISO-82-T03` | A projection exists in one space for two subjects who also share a second space | The second space shows nothing about that projection and forms none of its own | `PB-82-06`, `CD-82-09` |
| `ISO-82-T04` | A provider webhook arrives naming an account with a removed link | No link is created or reactivated; the event routes nowhere | `LK-82-07`, `PB-82-04` |
| `ISO-82-T05` | Response timing or error class is compared between an unlinked account and a nonexistent one | Indistinguishable | `LK-82-05` |
| `ISO-82-T06` | An audit export is read for a space | It carries no provider secret, no raw observation, and no other person's private state | `AE-82-02` |
| `ISO-82-T07` | Two subjects hold accounts at the same institution with similar identifiers, in the same space, without confirmation | They stay separate and neither learns of the other's account | `PB-82-05`, `AS-82-05` |

### 3.7 Deletion and retention — DEL, 4 scenarios

| ID | Scenario | Expected outcome | Source |
| --- | --- | --- | --- |
| `DEL-82-T01` | An account subject completes deletion | Links are removed, connections revoked as supported, no space inherits authority, and retained history follows the approved disposition | `OC-82-07` |
| `DEL-82-T02` | A restore runs from backup after a deletion | Purged data does not reappear; the restore reconciles against current deletion and authorization state first | `PB-82-10` |
| `DEL-82-T03` | Customer copy describes what unlinking removes | It never promises removal of permitted immutable provenance or of anything a recipient already holds | `DR-82-03` |
| `DEL-82-T04` | A retained field is examined for its basis | It carries a purpose, audience, sensitivity, and a retention rule or a named gate | `DR-82-01` |

### 3.8 Correction, retry, and repair — CORR, 7 scenarios

| ID | Scenario | Expected outcome | Source |
| --- | --- | --- | --- |
| `CORR-82-T01` | A contributor judges a live projection wrong and removes their own source | It separates without any other contributor's permission, and no other contributor learns why | `CR-82-01` |
| `CORR-82-T02` | A Primary Owner dissolves a projection they judge wrong | It dissolves in their space only; no connection, provenance, or profile-local canonicalization is touched | `CR-82-02`, `AU-82-04` |
| `CORR-82-T03` | A Primary Owner attempts to split a canonical account inside a member's profile | Denied. Only the profile subject may correct a canonicalization | `CR-82-03` |
| `CORR-82-T04` | The provider redelivers the same event three times | At most one observation exists and no derived value is counted twice | `CR-82-05` |
| `CORR-82-T05` | A provider retry arrives after the connection was revoked | Recorded as historical against that connection; no link, account, or projection reactivates | `CR-82-06`, `PB-82-04` |
| `CORR-82-T06` | The provider corrects a transaction already attributed to a closed period | A later observation supersedes the earlier one, neither is edited or deleted, and derived values recompute deterministically | `CR-82-07`, `FD-82-021` |
| `CORR-82-T07` | A space withdraws its own non-association decision | The refusal lifts; no projection forms until the full `AS-82-05` confirmation path runs again | `CR-82-08` |

### 3.9 Derived state, cache, and revocation — DERIV, 6 scenarios

| ID | Scenario | Expected outcome | Source |
| --- | --- | --- | --- |
| `DERIV-82-T01` | A link is removed while a cached space report still holds its values | The cache is invalidated in the same atomic commit; no stale value is ever served | `DS-82-01` |
| `DERIV-82-T02` | A read arrives holding a cache entry built under a superseded link version | The entry is discarded and the read resolves against the current version | `DS-82-02`, `LK-82-03` |
| `DERIV-82-T03` | A space's search results, suggestions, and counts are examined after an unlink | None of them differ from a space where the account never existed | `DS-82-03`, `ISO-82-T01` |
| `DERIV-82-T04` | The provider never confirms a revocation | The connection does not reach `revoked`, the not-syncing marker applies immediately, the discrepancy is audited, and the authorizer is told | `DS-82-04`, `DS-82-05` |
| `DERIV-82-T05` | A lifecycle recomputation runs twice | The second run yields the same result and emits no second notice | `DS-82-06` |
| `DERIV-82-T06` | A recomputation would reunite two accounts the subject previously split | It stops and requires `CR-82-03` confirmation or materially new approved evidence | `DS-82-07`, `AS-82-08` |

## 4. Family totals

| Family | Scenarios |
| --- | --- |
| LNK | 7 |
| AUTH | 6 |
| CANON | 6 |
| JOINT | 8 |
| LIFE | 8 |
| ISO | 7 |
| DEL | 4 |
| CORR | 7 |
| DERIV | 6 |
| **Total** | **59** |

## 5. Revision history

| Version | Date | Author | Change | Approval |
| --- | --- | --- | --- | --- |
| 0.2 | September 12, 2026 | Claude with Alexander Wohlford as Product Owner | Added the `CORR` and `DERIV` families, 13 scenarios, taking the catalog to 59 in nine families. They cover the correction rights, provider retry and redelivery, correction observations, cache invalidation, search and count residue, lost revocation, idempotent recomputation, and silent re-merge that the v0.1 traceability record claimed against `PB-82-06`, `LC-82-04`, and `PB-82-05` without a scenario or a rule behind any of them. The seven original families are unchanged. | Draft; Product Owner review required |
| 0.1 | September 3, 2026 | Claude with Alexander Wohlford as Product Owner | Initial catalog. 46 rule-level scenarios in seven families, weighted toward the negative cases the isolation rules exist to make testable. Deterministic fixtures remain test-design scope under `OI-82-002`. | Draft; Product Owner review required |
