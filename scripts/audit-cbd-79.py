#!/usr/bin/env python3
"""Structural audit for the CBD-79 reliability and safety metrics package.

What it checks, and why each guard exists:

* Every metric carries every field the approved conventions section 4 requires.
  A field that does not apply is written "n/a" with a reason and is never
  omitted, so a missing row is a defect rather than a judgment.

* Release form is "global" and boundary is "worker" for every metric. Class and
  Owner vary here, unlike CBD-77 and CBD-78, because most of this package is
  AN-92-003 reliability telemetry rather than AN-92-005 aggregate state -- so
  both are checked against the closed sets instead of against a constant.

* No metric proposes an analytics event. AN-92-001 disables the behavioural
  event pipeline, and the whole package was written after that re-architecture,
  so event-model vocabulary in a metric record means the model leaked back in.

* Every metric identifier is unique, sequential from MT-79-001, and every
  measurement source is marked "proposed" -- CBD-80 assigns the MS-80-nnn
  identifiers and this package may not pre-empt them.

* Every metric carries an Operational response, which CBD-79-AC06 requires and
  the conventions record shape does not have. A response of "investigate" is
  an intention rather than an action and fails.

* Safety exclusions stay visible, and the approved synthetic incorrect-alert
  QA disposition is protected separately from production measurement.

* acknowledged and dismissed are answered by reference to CBD-78's MT-78-007
  and MT-78-008, never redefined. Two metrics for one quantity is what the
  conventions section 10 boundary exists to prevent, and a redefinition here
  would drop the AB-74-014 release constraint CBD-78 attaches to them.

Documentation integrity only. It measures nothing, proves no metric computable,
and does not establish that any measurement source exists.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
METRICS = REPO_ROOT / "docs/cbd-79-reliability-and-safety-metrics.md"
CONVENTIONS = REPO_ROOT / "docs/cbd-13-measurement-conventions.md"

# Conventions section 4. "Class", "Release form", "Boundary" and "Owner" are
# declared once for the package in section 4's preamble rather than per record,
# which the package states explicitly, so they are checked there instead.
REQUIRED_FIELDS = (
    "Purpose", "Formula", "Numerator", "Denominator", "Measurement source",
    "Interval basis", "Window", "Suppression", "Connectivity", "Data source",
    "Collection method", "Review cadence", "Unhealthy condition",
)

# Only two are constant here. CBD-79 spans both measurement classes and all
# four owner categories on purpose -- most of it is AN-92-003 reliability
# telemetry rather than AN-92-005 aggregate state -- so Class and Owner are
# per-record and validated against the conventions vocabularies instead.
PACKAGE_CONSTANTS = ("Release form: global", "Boundary: worker")

METRIC_CLASSES = ("aggregate-state", "reliability-telemetry")
OWNERS = ("product", "security", "synchronization", "notifications")

EVENT_MODEL = {
    "analytics event": r"\banalytics event\b",
    "event catalog": r"\bevent catalog\b",
    "start event": r"\bstart event\b",
    "end event": r"\bend event\b",
    "cohort": r"\bcohorts?\b",
    "funnel": r"\bfunnels?\b",
    "idempotency key": r"\bidempotency[_ ]key\b",
    "AE- prefix": r"\bAE-\d+-\d+\b",
}




class Audit:
    def __init__(self) -> None:
        self.checks = 0
        self.failures: list[str] = []

    def check(self, ok: bool, message: str) -> None:
        self.checks += 1
        if not ok:
            self.failures.append(message)


def metric_blocks(text: str) -> dict[str, str]:
    """Return {MT-79-nnn: the record body} for each metric heading."""
    blocks: dict[str, str] = {}
    headings = list(re.finditer(r"^### (MT-79-\d{3}) — (.+)$", text, re.M))
    for index, match in enumerate(headings):
        start = match.end()
        end = headings[index + 1].start() if index + 1 < len(headings) else len(text)
        blocks[match.group(1)] = text[start:end]
    return blocks


# Approved lifecycle/closure invariants. Logical documentation checks only;
# source availability, synthetic QA execution and release safety remain gates.
LIFECYCLE_RULES = {'Synthetic QA': ('## 3. Synthetic incorrect-alert QA',
                  ('CBD13-CORRECTNESS-001',
                   'synthetic QA against approved alert rules',
                   'separate from production metrics and customer/support data',
                   'No new production metric',
                   'no executed QA or pass is claimed')),
 'Correctness disposition': ('| ~~`OQ-79-002`~~ |',
                             ('CBD13-CORRECTNESS-001',
                              'synthetic QA',
                              'No new metric or executed QA is claimed')),
 'Freshness metric': ('### MT-79-003',
                      ('fresh_eligible_connections / eligible_connections',
                       'T minus last committed successful sync watermark',
                       'Never-synced eligible connections remain included',
                       'missing, never zero',
                       'D14 cannot start or earn credit')),
 'Lateness metric': ('### MT-79-008',
                     ('Those same delivered recipient instances',
                      'durable source revision first satisfying',
                      'still-unavailable and failed instances excluded',
                      'no baseline start or credit')),
 'Completion metric': ('### MT-79-009',
                       ('completed_requests / (completed_requests + failed_requests)',
                        'Accepted eligible authorized request after required '
                        'verification/confirmation',
                        'valid cancellation/restoration are excluded',
                        'processor/backup obligations separately tracked')),
 'Elapsed metric': ('### MT-79-010',
                    ('same completed-plus-failed terminal population as MT-79-009',
                     'queue delay included',
                     'regardless of acceptance week',
                     'interval, terminal-state, source, bucket and release prerequisites',
                     'No SLA/compliance or near-breach claim')),
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
                    f"docs/cbd-79-reliability-and-safety-metrics.md: {label} missing approved invariant(s): {missing}")



def main() -> int:
    audit = Audit()
    text = METRICS.read_text(encoding="utf-8")
    conventions = CONVENTIONS.read_text(encoding="utf-8")
    lifecycle_checks(text, audit)

    # --- the package pins the conventions version it was written against ----
    version = re.search(r"\| Document version \| ([\d.]+) \|", conventions)
    audit.check(version is not None, "conventions: no document version found")
    if version:
        audit.check(
            f"Document version **{version.group(1)}**" in text,
            f"metrics: conventions pin must name version {version.group(1)}, "
            "which is what check-jira-freshness compares",
        )

    # --- package-level constants, declared once in section 4 ----------------
    for constant in PACKAGE_CONSTANTS:
        audit.check(constant in text,
                    f"metrics: section 4 must declare the package constant {constant!r}")

    blocks = metric_blocks(text)
    audit.check(len(blocks) >= 1, "metrics: no MT-79-nnn records found")

    # --- identifiers are unique and sequential from 001 ---------------------
    numbers = sorted(int(k.rsplit("-", 1)[1]) for k in blocks)
    audit.check(numbers == list(range(1, len(numbers) + 1)),
                f"metrics: identifiers must run MT-79-001 upward with no gaps, got {numbers}")

    for identifier, body in sorted(blocks.items()):
        for field in REQUIRED_FIELDS:
            present = re.search(rf"^\| {re.escape(field)} \| .+\|", body, re.M)
            audit.check(bool(present), f"{identifier}: missing required field {field!r}")

        # A field that does not apply says so, and says why.
        for na in re.finditer(r"^\| ([^|]+?) \| `n/a`(.*)$", body, re.M):
            audit.check(
                "—" in na.group(2) or "-" in na.group(2),
                f"{identifier}: field {na.group(1).strip()!r} is n/a with no reason",
            )

        audit.check(
            "proposed" in body or "Measurement source | `n/a`" in body,
            f"{identifier}: measurement sources must be marked proposed until CBD-80 assigns",
        )
        audit.check(
            not re.search(r"\bMS-80-\d+\b", body),
            f"{identifier}: must not pre-empt a CBD-80 MS-80-nnn identifier",
        )
        audit.check(
            "withheld" in body.lower() or "Suppression | `n/a`" in body,
            f"{identifier}: suppression must state what is reported, never a blank",
        )

        # A record may restate a package constant, but never contradict one.
        # Declaring the constants once in section 4 is not a guard on its own:
        # a later edit can add "| Release form | `by-cadence` |" to one record
        # and the section 4 preamble stays true. Conventions decision 2 makes
        # any release form but global a defect, so the override is checked
        # where it would actually be written.
        for field, permitted in (("Release form", "global"),
                                 ("Boundary", "worker")):
            for override in re.finditer(
                    rf"^\| {re.escape(field)} \| (.+?) \|", body, re.M):
                value = override.group(1).strip().strip("`*")
                audit.check(
                    value == permitted,
                    f"{identifier}: {field} is {value!r}, and the package declares "
                    f"{permitted!r} for every metric -- conventions decision 2 "
                    f"makes any other release form a defect",
                )

        # Class and Owner vary here, so they are checked against the closed
        # sets rather than against a constant. An unrecognised value is a
        # vocabulary breach the doc-vocabulary checker cannot see, because a
        # single wrong value forms no run.
        for field, permitted_set in (("Class", METRIC_CLASSES), ("Owner", OWNERS)):
            row = re.search(rf"^\| {re.escape(field)} \| (.+?) \|", body, re.M)
            audit.check(bool(row), f"{identifier}: missing required field {field!r}")
            if row:
                value = row.group(1).strip().strip("`*")
                audit.check(
                    value in permitted_set,
                    f"{identifier}: {field} is {value!r}, not one of {permitted_set}",
                )

        # CBD-79-AC06 requires an operational response for every unhealthy
        # condition, and the conventions record shape carries no such field --
        # section 5 adds it. A response that is only an intention is not one.
        response = re.search(r"^\| \*\*Operational response\*\* \| (.+?) \|$", body, re.M)
        audit.check(bool(response),
                    f"{identifier}: missing the Operational response field -- CBD-79-AC06")
        if response:
            audit.check(
                response.group(1).strip().lower() not in
                ("investigate", "investigate.", "tbd", "to be decided"),
                f"{identifier}: operational response is an intention, not an action",
            )

    # --- the event model must not have leaked back in -----------------------
    # Section 2 names the prohibited constructions in order to reject them, and
    # section 6 records open items, so both are prose about the model rather
    # than a metric using it. Only the metric records are scanned.
    for identifier, body in sorted(blocks.items()):
        for name, pattern in EVENT_MODEL.items():
            audit.check(
                not re.search(pattern, body, re.I),
                f"{identifier}: uses the withdrawn event model ({name}) -- AN-92-001",
            )

    # --- the unchanged barred safety signals stay visible ------------------
    # Both are gaps in approved criteria rather than omissions here, and both
    # are the kind of thing a later edit tidies away because it reads like an
    # admission. Each must keep its section and its open question.
    # Inverted at the OQ-13-007 decision of September 5, 2026. This required
    # the words "No metric is defined for this criterion", which were true while
    # CBD-79-AC04 was treated as one blocked question and became false the
    # moment two of its four signals were written -- section 4.77 of the CBD-108
    # corpus again, a guard requiring a statement a decision had falsified.
    #
    # What must stay true is narrower and more useful: both barred signals are
    # still named, each with the contract that bars it, so a later edit cannot
    # quietly report AC04 as fully met.
    audit.check(
        re.search(r"security-decision", text) is not None,
        "metrics: must name the AN-92-003 security-decision exclusion, which is "
        "what bars a denied-access count",
    )
    for signal, contract in (("Denied cross-space access", "AN-92-003"),
                             ("Related support incidents", "AN-92-006")):
        row = re.search(rf"^\| \*\*{re.escape(signal)}\*\* \| \*\*Barred\*\* \| (.+?) \|$",
                        text, re.M)
        audit.check(bool(row),
                    f"metrics: {signal!r} must remain a barred row in the section 4 table")
        if row:
            audit.check(contract in row.group(1),
                        f"metrics: {signal!r} must name {contract} as what bars it")
    audit.check(
        re.search(r"AN-92-006", text) is not None,
        "metrics: must cite AN-92-006, which is what bars the support-incident signal",
    )
    # Synthetic correctness disposition is protected by lifecycle_checks.
    # Each must hold a row in the section 8 table, not merely be mentioned in
    # prose. Searching the whole document passes while the row is deleted,
    # which is how an open question stops being tracked without anyone
    # removing it -- the same weakness CBD-78's release guard had.
    open_items = re.search(r"^## 8\. What this package could not settle.*", text,
                           re.S | re.M)
    audit.check(open_items is not None, "metrics: section 8 open-items table not found")
    if open_items:
        # Derived rather than listed, ported from the CBD-80 audit after the
        # same guard there needed editing once per decision. Every OQ-79
        # identifier the document mentions must hold a row, struck if decided
        # and unstruck if not, and the identifiers must run 001 upward with no
        # gaps -- which catches a row deleted when nothing else mentions it,
        # the case a mention-based rule alone misses.
        table = open_items.group(0)
        mentioned = set(re.findall(r"\bOQ-79-\d{3}\b", text))
        audit.check(bool(mentioned), "metrics: no OQ-79 questions found at all")
        for question in sorted(mentioned):
            audit.check(
                re.search(rf"^\| ~?~?`{question}`~?~? \|", table, re.M) is not None,
                f"metrics: {question} is mentioned but holds no row in the "
                "section 8 table -- a question tracked in prose is not tracked",
            )
        tabled = sorted(int(n) for n in
                        re.findall(r"^\| ~?~?`OQ-79-(\d{3})`~?~? \|", table, re.M))
        audit.check(
            tabled == list(range(1, len(tabled) + 1)),
            f"metrics: section 8 questions must run OQ-79-001 upward with no "
            f"gaps, got {tabled} -- a gap means a row was deleted or renamed",
        )
        audit.check(
            re.search(r"^\| ~~`OQ-79-\d{3}`~~ \|", table, re.M) is not None,
            "metrics: a decided question must keep a struck row, so the "
            "decision remains visible rather than disappearing",
        )

    # --- acknowledged and dismissed are CBD-78's, by reference --------------
    # Redefining them here would create two metrics for one quantity and would
    # drop the AB-74-014 release constraint CBD-78 attaches to them.
    audit.check(
        "MT-78-007" in text and "MT-78-008" in text,
        "metrics: must answer CBD-79-AC03's acknowledged and dismissed states "
        "by reference to CBD-78 rather than redefining them",
    )
    for identifier, body in sorted(blocks.items()):
        audit.check(
            not re.search(r"acknowledgement rate|dismissal rate", body, re.I),
            f"{identifier}: redefines a CBD-78 alert measure -- conventions §10",
        )

    print(f"CBD-79 documentation audit: {audit.checks} checks")
    print(f"Failures: {len(audit.failures)}")
    for failure in audit.failures:
        print(f"  - {failure}")
    if not audit.failures:
        print("Result: PASS (documentation integrity only; no metric is computable "
              "until CBD-80 assigns its measurement sources, and none has been measured)")
    return 1 if audit.failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
