#!/usr/bin/env python3
"""Structural audit for the CBD-80 measurement source register.

This one is different from the CBD-77 through CBD-79 audits, which check a
package against itself. CBD-80 exists to make three concurrently written
packages agree, so the guards that matter here are cross-package:

* Every source CBD-77, CBD-78 and CBD-79 proposed is registered, or is recorded
  in section 4 as merged or renamed. The conventions gave those packages the
  right to propose and gave this register the right to accept, rename or merge
  -- and required every such decision to be recorded. A proposal that is
  silently dropped leaves a metric citing a source that does not exist.

* Every owning metric named here exists in a sibling package, and every metric
  in those packages is named by at least one source. A source no metric reads
  should not be registered; a metric no source serves is not computable.

* No MS-80 identifier is duplicated or skipped, because the sibling packages
  cite them and a renumber breaks the citation silently.

* The privacy rules that carry the whole re-architecture stay present: no
  identifier reaches a measurement surface, no consent basis is recorded, and a
  customer deletion request reaches no measurement store.

* Every open question holds a row in the section 7 table, and a decided one
  keeps a struck row rather than disappearing, so a later reader sees the
  decision and not just its absence.

Documentation integrity only. It implements no source, reads no state, and does
not establish that any figure can be released.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
REGISTER = REPO_ROOT / "docs/cbd-80-measurement-source-register.md"
CONVENTIONS = REPO_ROOT / "docs/cbd-13-measurement-conventions.md"
SIBLINGS = (
    REPO_ROOT / "docs/cbd-77-activation-and-onboarding-metrics.md",
    REPO_ROOT / "docs/cbd-78-engagement-and-retention-metrics.md",
    REPO_ROOT / "docs/cbd-79-reliability-and-safety-metrics.md",
)

PROPOSED = re.compile(r"`([a-z_]+\.[a-z_]+)`\s*\*\(proposed\)\*")
METRIC_ID = re.compile(r"\bMT-7[789]-\d{3}\b")
SOURCE_ID = re.compile(r"^\| `(MS-80-\d{3})` \| `([a-z_]+\.[a-z_]+)`", re.M)

REQUIRED_RULES = {
    "prohibited content": "raw transaction values",
    "no identifier reaches a measurement surface":
        "No identifier reaches a measurement surface",
    "consent cannot do the work": "None is recorded, and none can do the work",
    "purpose separation": "AN-92-006",
    # Pinned to the section 3.4 row rather than to a turn of phrase. The first
    # version matched "finds nothing", which lived in section 6 and vanished
    # when the release decision rewrote it -- while the rule itself, in section
    # 3.4, had not changed at all. A guard on wording fails when the wording
    # moves and passes when the rule goes.
    "deletion reaches no measurement store": "reaches no measurement store",
}

EVENT_MODEL = {
    "analytics event": r"\banalytics event\b",
    "event catalog": r"\bevent catalog\b",
    "AE- prefix": r"\bAE-\d+-\d+\b",
    "idempotency key": r"\bidempotency[_ ]key\b",
}


class Audit:
    def __init__(self) -> None:
        self.checks = 0
        self.failures: list[str] = []

    def check(self, ok: bool, message: str) -> None:
        self.checks += 1
        if not ok:
            self.failures.append(message)


# Focused documentation guards for the approved logical predicates/deferrals.
# These check the governing row/block, not runtime data or source feasibility.
APPROVED_RULES = {'Usable source': ('| `MS-80-005` |',
                   ('eligible under MS-80-003',
                    'simultaneously immediately before C',
                    'CBD13-PROFILE-001',
                    'CBD13-CATEGORY-001',
                    'physical binding and verification remain future')),
 'Timing source': ('| `MS-80-007` |',
                   ('Deferred/unavailable for Private MVP',
                    'CBD13-USABLE-TIME-001',
                    'first simultaneous',
                    'replacement/deletion/period changes',
                    'No maximum current timestamps',
                    'updated_at',
                    'budget date',
                    'newly retained measurement history',
                    'no baseline credit or successful timing claim')),
 'Category source': ('| `MS-80-010` |',
                     ('distinct extant nonarchived spaces',
                      'qualifying Category-limb entity',
                      'CBD13-CATEGORY-001',
                      'without requiring spending or a target')),
 'Target source': ('| `MS-80-011` |',
                   ('only MS-80-010-eligible spaces',
                    'same qualifying set',
                    'Explicitly stored zero',
                    'missing target does not')),
 'Breadth denominator': ('| `MS-80-015` |',
                         ('Deferred/unavailable for MT-78-004',
                          'CBD13-RETENTION-001',
                          'does not prove historical eligibility')),
 'Breadth actions': ('| `MS-80-016` |',
                     ('Deferred/unavailable for Private MVP',
                      'CBD13-RETENTION-001',
                      'actual',
                      'occurrence times',
                      'viewing',
                      'editing',
                      'acknowledgement',
                      'commenting',
                      'permission, not action',
                      'mutation/deletion',
                      'No proxy substitution')),
 'Retention pair': ('| `MS-80-017` |',
                    ('Deferred/unavailable for Private MVP',
                     'CBD13-RETENTION-001',
                     'windows A and B',
                     'A-active count and A-and-B-active count',
                     'not historical feasibility proof',
                     'mutation/deletion',
                     'No behavioral events, retained measurement membership, audit-purpose '
                     'reuse or proxy substitution',
                     'no zero or successful retention claim')),
 'Shared predicate': ('## Approved usable predicates',
                      ('current active Primary Owner',
                       'exactly one extant active person-level',
                       'An existing empty profile counts; no profile fails',
                       'Multiple active profiles or ambiguous association invalidate the '
                       'source',
                       'Deletion-pending, terminated and retained-history-only',
                       'extant stable-identity entity owned by the measured budget space',
                       'currently usable for expense classification and category-target '
                       'planning',
                       'income/transfer classifications, uncategorized placeholders, display '
                       'groups, historical-only references and '
                       'archived/deleted/replaced-only/inactive categories',
                       'explicitly stored zero qualifies; a missing target does not',
                       'W4',
                       'R4/R8',
                       'no baseline credit'))}


def approved_amendment_checks(text: str, audit: Audit) -> None:
    for label, (marker, required) in APPROVED_RULES.items():
        start = text.find(marker)
        if start < 0:
            body = ""
        elif marker.startswith("|"):
            body = text[start:].splitlines()[0]
        else:
            end = re.search(r"\n#{2,3} ", text[start + len(marker):])
            stop = start + len(marker) + end.start() if end else len(text)
            body = text[start:stop]
        for phrase in required:
            audit.check(phrase in body,
                        f"docs/cbd-80-measurement-source-register.md: {label} must retain {phrase!r}")



# Approved lifecycle/closure invariants. Logical documentation checks only;
# source availability, synthetic QA execution and release safety remain gates.
LIFECYCLE_RULES = {'Freshness source': ('| `MS-80-023` |',
                      ('currently authorized and active',
                       'T minus last committed successful sync watermark',
                       'Never-synced eligible connections stay in denominator',
                       'missing age never zero',
                       'no extra released label',
                       'baseline start/credit')),
 'Lateness source': ('| `MS-80-028` |',
                     ('first rule satisfaction to authorized in-app availability',
                      'evaluation/fan-out delay',
                      'still-unavailable/failed excluded',
                      'cannot prove absence of dropped alerts',
                      'baseline start/credit')),
 'Terminal source': ('| `MS-80-029` |',
                     ('budget-space deletion and personal-account deletion',
                      'completed / (completed + failed)',
                      'approved terminal unsuccessful outcome',
                      'valid cancellation/restoration',
                      'do not invent cancellation',
                      'Processor/backup obligations separately tracked')),
 'Elapsed source': ('| `MS-80-030` |',
                    ('completed-plus-failed terminal population as MS-80-029',
                     'accepted eligible authorized request after verification/confirmation',
                     'queue delay included',
                     'same terminal transition as MS-80-029',
                     'no SLA/compliance or near-breach claim')),
 'Freshness snapshot': ('### Freshness snapshot',
                        ('currently authorized and active',
                         'orphaned, revoked, disconnected and lifecycle-stopped',
                         'T minus that watermark',
                         'Failed or superseded runs do not advance',
                         'never-synced eligible connection remains in the denominator',
                         'missing age, never zero')),
 'Alert interval': ('### End-to-end alert interval',
                    ('durable source revision first satisfying',
                     'settlement is required only where that rule requires',
                     'evaluation and fan-out delay',
                     'Viewing, acknowledgement, external sends and quiet-hour expiry are not '
                     'endpoints',
                     'Still-unavailable and failed instances are excluded',
                     'cannot prove absence of dropped alerts')),
 'Accepted request': ('### Accepted request and success predicates',
                      ('budget-space deletion and personal-account deletion',
                       'accepted eligible authorized request after required '
                       'verification/confirmation',
                       'queue delay after acceptance is included',
                       'after the approved objection conditions',
                       'not at proposal time')),
 'Export endpoint': ('| Export |',
                     ('correctly scoped, recipient-bound protected package',
                      'ready for authorized retrieval',
                      'download and expiry are not completion endpoints',
                      'FU-95-016')),
 'Archival endpoint': ('| Archival |',
                       ('archived state and its restrictions are atomically committed',
                        'archival erases nothing')),
 'Budget deletion endpoint': ('| Budget-space deletion |',
                              ('After the restoration window',
                               'irreversibly purged',
                               'minimal nonfinancial tombstone',
                               'FU-95-014',
                               'archived-without-pending-deletion')),
 'Personal deletion endpoint': ('| Personal-account deletion |',
                                ('After the restoration window, irreversible account/profile termination',
                                 'private-data/shared-history dispositions',
                                 'pseudonymized',
                                 'minimal non-resurrection ledger',
                                 'FU-95-022',
                                 'Immediate authority shutdown is not completion',
                                 'restoration does not resurrect authority')),
 'Application boundary': ('### Accepted request and success predicates',
                          ('evidenced application-controlled terminal disposition',
                           'approved per-class/custodian schedule',
                           'Merely scheduling cleanup is insufficient',
                           'Processor and backup obligations remain separately tracked',
                           'does not certify their expiry or erasure of recipient-held copies')),
 'Outcome alignment': ('### Outcome and population alignment',
                       ('completed / (completed + failed)',
                        'same completed-plus-failed terminal population',
                        'acceptance to terminal outcome, not success-only time',
                        'once at its terminal transition',
                        'regardless of acceptance week',
                        'do not invent cancellation',
                        'unfinished requests are excluded',
                        'cannot imply success or absence of failures')),
 'Bounds and applicability': ('### Later-bound specification disposition',
                              ('closure-stage exception, not a Private MVP applicability deferral',
                               'no rate, healthy status, numerical release, baseline start or '
                               'credit',
                               'D14 starts only when valid comparable releasable rates',
                               'interval, terminal-state, source, bucket and release prerequisites',
                               'No SLA/compliance or near-breach claim',
                               'restoration grace, export expiry and backup expiry are not '
                               'performance SLOs',
                               'no expansion or successful evaluation exit without required '
                               'evidence',
                               'dated continuation/pause process'))}


def lifecycle_checks(text: str, audit: Audit) -> None:
    for label, (marker, required) in LIFECYCLE_RULES.items():
        start = text.find(marker)
        if start < 0:
            body = ""
        elif marker.startswith("|"):
            body = text[start:].splitlines()[0]
        else:
            end = re.search(r"\n#{2,3} ", text[start + len(marker):])
            stop = start + len(marker) + end.start() if end else len(text)
            body = text[start:stop]
        missing = [phrase for phrase in required if phrase not in body]
        audit.check(not missing,
                    f"docs/cbd-80-measurement-source-register.md: {label} missing approved invariant(s): {missing}")



# Focused approved sent/synchronization requirement groups. Documentation only.
FINAL_SOURCE_RULES = {'Terminal invitation source': ('| `MS-80-014` |',
                                ('accepted',
                                 'expired',
                                 'revoked',
                                 'declined',
                                 '**`sent` is excluded**',
                                 'not a production count or changed terminal population')),
 'Consumer-specific sync counts': ('| `MS-80-021` |',
                                   ('MT-79-001 uses success and denominator counts over R(D) minus '
                                    'S(D)',
                                    'MT-79-004/005 denominators use all R(D)',
                                    'Never reuse one supersession-filtered scalar',
                                    'No cancellation-as-success/failure')),
 'All-run duration': ('| `MS-80-022` |',
                      ('all R(D), including cancellations/supersession',
                       'terminal timestamp minus first Worker-attempt timestamp',
                       'including retries/backoff',
                       'terminal-day attribution',
                       'not per-run timings')),
 'All-run retry buckets': ('| `MS-80-024` |',
                           ('all R(D), including zero',
                            'cancelled/superseded runs',
                            'positive-retry runs once',
                            'denominator is all R(D)')),
 'Failed subset': ('| `MS-80-025` |',
                   ('only terminal technical failures in R(D)',
                    'denominator comes from all R(D) in MS-80-021',
                    'Valid cancellations are not failures',
                    'not complements',
                    'No provider message, payload, or identifier')),
 'Projection evidence': ('## Approved invitation sent coverage',
                         ('not proof of dispatch, delivery, receipt or recipient activity',
                          'does not create terminal measurement membership',
                          'INV-73-05',
                          'INV-73-13',
                          'INV-73-19',
                          'VER-73-11',
                          'not executed tests or runtime proof')),
 'Operational binding gate': ('## Approved synchronization terminal-day populations',
                              ('Never-attempted queued work is excluded',
                               'Unknown outcome or operational-identity mappings block computation',
                               'Exact midnight belongs to the new day',
                               'Postterminal replay requires an approved operational identity rule',
                               'no new cancellation-reason labels, identifiers, per-run timing '
                               'releases, tracking or retained measurement history'))}


def final_source_checks(text: str, audit: Audit) -> None:
    for label, (marker, required) in FINAL_SOURCE_RULES.items():
        start = text.find(marker)
        if start < 0:
            body = ""
        elif marker.startswith("|"):
            body = text[start:].splitlines()[0]
        else:
            end = re.search(r"\n#{2,3} ", text[start + len(marker):])
            stop = start + len(marker) + end.start() if end else len(text)
            body = text[start:stop]
        missing = [phrase for phrase in required if phrase not in body]
        audit.check(not missing,
                    f"docs/cbd-80-measurement-source-register.md: {label} missing approved invariant(s): {missing}")



def main() -> int:
    audit = Audit()
    text = REGISTER.read_text(encoding="utf-8")
    conventions = CONVENTIONS.read_text(encoding="utf-8")
    final_source_checks(text, audit)
    lifecycle_checks(text, audit)
    approved_amendment_checks(text, audit)

    version = re.search(r"\| Document version \| ([\d.]+) \|", conventions)
    audit.check(version is not None, "conventions: no document version found")
    if version:
        audit.check(f"Document version **{version.group(1)}**" in text,
                    f"register: conventions pin must name version {version.group(1)}")

    rows = SOURCE_ID.findall(text)
    audit.check(bool(rows), "register: no MS-80-nnn rows found")

    # --- identifiers are unique and sequential ------------------------------
    ids = [int(i.rsplit("-", 1)[1]) for i, _ in rows]
    audit.check(len(ids) == len(set(ids)), f"register: duplicate MS-80 identifier in {ids}")
    audit.check(sorted(ids) == list(range(1, len(ids) + 1)),
                f"register: identifiers must run MS-80-001 upward with no gaps, got {sorted(ids)}")

    registered_names = {name for _, name in rows}

    # --- every proposal is registered, merged, or renamed -------------------
    proposals: dict[str, str] = {}
    sibling_metrics: set[str] = set()
    for path in SIBLINGS:
        sibling = path.read_text(encoding="utf-8")
        for name in PROPOSED.findall(sibling):
            proposals.setdefault(name, path.name)
        sibling_metrics.update(METRIC_ID.findall(sibling))

    audit.check(bool(proposals), "siblings: no proposed sources found -- check the pattern")
    for name, origin in sorted(proposals.items()):
        recorded = name in registered_names or f"`{name}`" in text
        audit.check(
            recorded,
            f"register: {name!r}, proposed by {origin}, is neither registered nor "
            "recorded in section 4 as merged or renamed",
        )

    # --- owning metrics resolve both ways -----------------------------------
    owned: set[str] = set()
    for line in text.splitlines():
        if line.startswith("| `MS-80-"):
            owned.update(METRIC_ID.findall(line))

    for metric in sorted(owned):
        audit.check(metric in sibling_metrics,
                    f"register: owning metric {metric} does not exist in any sibling package")
    for metric in sorted(sibling_metrics):
        audit.check(
            metric in owned,
            f"register: {metric} is defined in a sibling package and no source serves it, "
            "so it is not computable",
        )

    # --- every row carries all six attributes -------------------------------
    for line in text.splitlines():
        if not line.startswith("| `MS-80-"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        identifier = cells[0].strip("`")
        audit.check(len(cells) == 6,
                    f"{identifier}: expected six columns, found {len(cells)}")
        for index, attribute in enumerate(
                ("id", "name", "state of record", "derivation", "refresh", "owning metric")):
            if index < len(cells):
                audit.check(bool(cells[index]),
                            f"{identifier}: attribute {attribute!r} is empty")

    # --- the privacy rules that carry the re-architecture -------------------
    for label, needle in REQUIRED_RULES.items():
        audit.check(needle in text, f"register: must state the rule -- {label}")

    # Each open question must hold a row in the section 7 table, not merely be
    # mentioned in prose. Searching the whole document passes while the row is
    # deleted, which is how a question stops being tracked without anyone
    # removing it. This is the fourth guard in the CBD-13 family to need the
    # same tightening, so it is written this way from the start here.
    open_items = re.search(r"^## 7\. What this package could not settle.*", text,
                           re.S | re.M)
    audit.check(open_items is not None, "register: section 7 open-items table not found")
    if open_items:
        # Derived, not listed. Two earlier versions named the questions
        # explicitly and both had to be edited the moment one was decided --
        # first OQ-80-001, then OQ-80-005 -- which is the same by-hand
        # restatement this audit exists to prevent elsewhere.
        #
        # The invariant does not need a list: every OQ-80 identifier the
        # document mentions must hold a row in section 7, struck if it has been
        # decided and unstruck if it has not. That catches a dropped row, a
        # question raised in prose and never tabled, and a decision that erased
        # its own record, without naming any of them.
        table = open_items.group(0)
        mentioned = set(re.findall(r"\bOQ-80-\d{3}\b", text))
        audit.check(bool(mentioned), "register: no OQ-80 questions found at all")
        for question in sorted(mentioned):
            audit.check(
                re.search(rf"^\| ~?~?`{question}`~?~? \|", table, re.M) is not None,
                f"register: {question} is mentioned but holds no row in the "
                "section 7 table -- a question tracked in prose is not tracked",
            )
        # At least one decided question keeps a struck row, so the convention
        # of striking rather than deleting is itself enforced.
        audit.check(
            re.search(r"^\| ~~`OQ-80-\d{3}`~~ \|", table, re.M) is not None,
            "register: a decided question must keep a struck row, so the "
            "decision remains visible rather than disappearing",
        )
        # The rule above catches a question raised in prose and never tabled.
        # It does not catch a row deleted when nothing else mentions it -- the
        # proof found exactly that gap by renaming OQ-80-006, whose only
        # appearance was its own row. Requiring the identifiers to run 001
        # upward with no gaps closes it: a deleted or renamed row leaves a hole.
        tabled = sorted(int(n) for n in
                        re.findall(r"^\| ~?~?`OQ-80-(\d{3})`~?~? \|", table, re.M))
        audit.check(
            tabled == list(range(1, len(tabled) + 1)),
            f"register: section 7 questions must run OQ-80-001 upward with no "
            f"gaps, got {tabled} -- a gap means a row was deleted or renamed",
        )

    # --- the withdrawn event model has not returned -------------------------
    for name, pattern in EVENT_MODEL.items():
        # Section 2 names the model in order to reject it, so only the register
        # table is scanned for its vocabulary.
        for line in text.splitlines():
            if line.startswith("| `MS-80-"):
                audit.check(not re.search(pattern, line, re.I),
                            f"register: a source row uses the withdrawn event model ({name})")

    # --- the stated totals agree with the table -----------------------------
    # Derived, not pinned. The first version of this guard hardcoded 30 and 31,
    # and failed the moment the OQ-13-007 decision added three sources -- it
    # would have had to be edited on every amendment, which is the same defect
    # as restating a figure by hand. It now reads the totals the document
    # states and compares them to what the table and the siblings actually hold.
    stated = re.search(r"\*\*(\d+) sources for (\d+) proposals\*\*", text)
    audit.check(
        stated is not None,
        "register: must state the source and proposal totals as digits, so they "
        "can be compared to the table rather than trusted",
    )
    if stated:
        said_sources, said_proposals = int(stated.group(1)), int(stated.group(2))
        audit.check(
            said_sources == len(rows),
            f"register: states {said_sources} sources; the table holds {len(rows)}",
        )
        audit.check(
            said_proposals == len(proposals),
            f"register: states {said_proposals} proposals; the sibling packages "
            f"make {len(proposals)}",
        )

    print(f"CBD-80 documentation audit: {audit.checks} checks")
    print(f"Failures: {len(audit.failures)}")
    for failure in audit.failures:
        print(f"  - {failure}")
    if not audit.failures:
        # Says only what stays true. Two earlier versions named the open
        # question blocking release -- first OQ-80-001, then OQ-80-005 --
        # and both went stale the moment that question was decided. A
        # result line that has to be edited on every decision is the same
        # restated-by-hand defect as everything else this audit checks.
        print("Result: PASS (documentation integrity only; no source is implemented "
              "and none has been read; section 7 carries what remains open)")
    return 1 if audit.failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
