#!/usr/bin/env python3
"""Structural audit for the CBD-77 activation and onboarding metrics package.

What it checks, and why each guard exists:

* Every metric carries every field the approved conventions section 4 requires.
  A field that does not apply is written "n/a" with a reason and is never
  omitted, so a missing row is a defect rather than a judgment.

* Release form is "global" for every metric. Conventions decision 2 releases no
  segmented figure during the beta, and the conventions say plainly that any
  other value is a defect until the population decision is revisited. This is
  the guard that catches a segment reintroduced by a later edit.

* No metric proposes an analytics event. AN-92-001 disables the behavioural
  event pipeline, and the whole package was written after that re-architecture,
  so event-model vocabulary in a metric record means the model leaked back in.

* Every metric identifier is unique, sequential from MT-77-001, and every
  measurement source is marked "proposed" -- CBD-80 assigns the MS-80-nnn
  identifiers and this package may not pre-empt them.

* The five UB-77-001 limbs are present and each cites an approved source.
  CBD-77-AC03 requires the usable-budget definition to name a minimum profile,
  period, category, allocation, and account or transaction; a limb without a
  citation is an assertion.

Documentation integrity only. It measures nothing, proves no metric computable,
and does not establish that any measurement source exists.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
METRICS = REPO_ROOT / "docs/cbd-77-activation-and-onboarding-metrics.md"
CONVENTIONS = REPO_ROOT / "docs/cbd-13-measurement-conventions.md"

# Conventions section 4. "Class", "Release form", "Boundary" and "Owner" are
# declared once for the package in section 4's preamble rather than per record,
# which the package states explicitly, so they are checked there instead.
REQUIRED_FIELDS = (
    "Purpose", "Formula", "Numerator", "Denominator", "Measurement source",
    "Interval basis", "Window", "Suppression", "Connectivity", "Data source",
    "Collection method", "Review cadence", "Unhealthy condition",
)

PACKAGE_CONSTANTS = ("Class: aggregate-state", "Release form: global",
                     "Boundary: worker", "Owner: product")

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

UB_LIMBS = ("Profile", "Period", "Category", "Allocation", "Account or transaction")


class Audit:
    def __init__(self) -> None:
        self.checks = 0
        self.failures: list[str] = []

    def check(self, ok: bool, message: str) -> None:
        self.checks += 1
        if not ok:
            self.failures.append(message)


def metric_blocks(text: str) -> dict[str, str]:
    """Return {MT-77-nnn: the record body} for each metric heading."""
    blocks: dict[str, str] = {}
    headings = list(re.finditer(r"^### (MT-77-\d{3}) — (.+)$", text, re.M))
    for index, match in enumerate(headings):
        start = match.end()
        end = headings[index + 1].start() if index + 1 < len(headings) else len(text)
        blocks[match.group(1)] = text[start:end]
    return blocks


# Focused documentation guards for the approved logical predicates/deferrals.
# These check the governing row/block, not runtime data or source feasibility.
APPROVED_RULES = {'Profile': ('| **Profile** |',
             ('current active Primary Owner',
              'exactly one extant active person-level',
              'An existing empty profile counts; no profile fails',
              'Multiple active profiles or ambiguous association invalidate the source',
              'Deletion-pending, terminated and retained-history-only')),
 'Category': ('| **Category** |',
              ('extant stable-identity entity owned by the measured budget space',
               'designated expense budgeting',
               'currently usable for expense classification and category-target planning',
               'income/transfer classifications, uncategorized placeholders, display groups, '
               'historical-only references and archived/deleted/replaced-only/inactive '
               'categories',
               'Rename/reorder preserve identity; recreation creates a different identity',
               'Neither actual spending nor a target is required')),
 'Allocation': ('| **Allocation** |',
                ('qualifying category from the Category limb',
                 'current-period target',
                 'explicitly stored zero qualifies; a missing target does not',
                 'Approved transition-prorated targets count')),
 'Timing': ('### MT-77-005',
            ('first simultaneous',
             'Deferred/unavailable for Private MVP',
             'CBD13-USABLE-TIME-001',
             'replacement, deletion and period changes',
             'No maximum of current timestamps',
             'updated_at',
             'budget date',
             'newly retained measurement history',
             'W4 baseline preserved for future applicability',
             'no baseline credit or successful timing claim')),
 'Target population': ('### MT-77-008',
                       ('Those same denominator-eligible spaces',
                        'same qualifying set',
                        'explicitly stored zero',
                        'missing target does not',
                        'Distinct extant nonarchived budget spaces',
                        'qualifying Category-limb entity')),
 'Profile disposition': ('| `OQ-77-003` |',
                         ('Logical meaning settled', 'CBD13-PROFILE-001', 'bind and verify')),
 'Category disposition': ('| `OQ-77-004` |',
                          ('Logical meaning settled',
                           'CBD13-CATEGORY-001',
                           'bind and verify'))}


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
                        f"docs/cbd-77-activation-and-onboarding-metrics.md: {label} must retain {phrase!r}")



def main() -> int:
    audit = Audit()
    text = METRICS.read_text(encoding="utf-8")
    conventions = CONVENTIONS.read_text(encoding="utf-8")
    approved_amendment_checks(text, audit)

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
    audit.check(len(blocks) >= 1, "metrics: no MT-77-nnn records found")

    # --- identifiers are unique and sequential from 001 ---------------------
    numbers = sorted(int(k.rsplit("-", 1)[1]) for k in blocks)
    audit.check(numbers == list(range(1, len(numbers) + 1)),
                f"metrics: identifiers must run MT-77-001 upward with no gaps, got {numbers}")

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
        for field, permitted in (("Class", "aggregate-state"),
                                 ("Release form", "global"),
                                 ("Boundary", "worker"),
                                 ("Owner", "product")):
            for override in re.finditer(
                    rf"^\| {re.escape(field)} \| (.+?) \|", body, re.M):
                value = override.group(1).strip().strip("`*")
                audit.check(
                    value == permitted,
                    f"{identifier}: {field} is {value!r}, and the package declares "
                    f"{permitted!r} for every metric -- conventions decision 2 "
                    f"makes any other release form a defect",
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

    # --- UB-77-001 states five limbs, each citing an approved source --------
    section = re.search(r"\*\*`UB-77-001`.*?(?=\n## )", text, re.S)
    audit.check(section is not None, "metrics: UB-77-001 condition table not found")
    if section:
        for limb in UB_LIMBS:
            row = re.search(rf"^\| \*\*{re.escape(limb)}\*\* \| (.+?) \| (.+?) \|$",
                            section.group(0), re.M)
            audit.check(bool(row), f"UB-77-001: limb {limb!r} missing")
            if row:
                audit.check(
                    bool(re.search(r"`(?:SD-071|CA-92)-\d+`", row.group(2))),
                    f"UB-77-001: limb {limb!r} cites no approved source",
                )

    print(f"CBD-77 documentation audit: {audit.checks} checks")
    print(f"Failures: {len(audit.failures)}")
    for failure in audit.failures:
        print(f"  - {failure}")
    if not audit.failures:
        print("Result: PASS (documentation integrity only; no metric is computable "
              "until CBD-80 assigns its measurement sources, and none has been measured)")
    return 1 if audit.failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
