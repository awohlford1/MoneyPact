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

* The two unsatisfied criteria stay visible. CBD-79-AC04 is blocked on
  OQ-13-007 and no safety metric is defined; `incorrect` has no measurable
  referent, so CBD-79-AC03 is met for four of its five states. Both are gaps in
  approved criteria rather than omissions here, and both are the kind of
  admission a later edit tidies away, so the audit keeps them present.

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


def main() -> int:
    audit = Audit()
    text = METRICS.read_text(encoding="utf-8")
    conventions = CONVENTIONS.read_text(encoding="utf-8")

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

    # --- the two criteria this package does not satisfy stay visible --------
    # Both are gaps in approved criteria rather than omissions here, and both
    # are the kind of thing a later edit tidies away because it reads like an
    # admission. Each must keep its section and its open question.
    audit.check("OQ-13-007" in text,
                "metrics: CBD-79-AC04 is blocked on OQ-13-007 and must say so")
    audit.check(
        "No metric is defined for this criterion" in text,
        "metrics: must state plainly that no safety metric is defined, rather "
        "than leaving CBD-79-AC04 looking answered",
    )
    audit.check(
        re.search(r"AN-92-006", text) is not None,
        "metrics: must cite AN-92-006, which is what blocks CBD-79-AC04",
    )
    # The claim must head its own section, where the three rejected routes are
    # argued, and not survive only as an open-item row. A finding reduced to a
    # table row loses the reasoning that makes it defensible.
    audit.check(
        re.search(r"^## \d+\. `incorrect` has no measurable referent$", text, re.M)
        is not None,
        "metrics: `incorrect` has no measurable referent must head its own "
        "section -- CBD-79-AC03 is met for four of five states, and the "
        "reasoning is what makes that defensible",
    )
    audit.check(
        text.lower().count("no measurable referent") >= 2,
        "metrics: the unmeasurable finding must appear in its section and in "
        "the open-items table, so neither can be dropped silently",
    )
    # Each must hold a row in the section 8 table, not merely be mentioned in
    # prose. Searching the whole document passes while the row is deleted,
    # which is how an open question stops being tracked without anyone
    # removing it -- the same weakness CBD-78's release guard had.
    open_items = re.search(r"^## 8\. What this package could not settle.*", text,
                           re.S | re.M)
    audit.check(open_items is not None, "metrics: section 8 open-items table not found")
    if open_items:
        for question in ("OQ-79-001", "OQ-79-002", "OQ-79-003"):
            audit.check(
                re.search(rf"^\| `{question}` \|", open_items.group(0), re.M) is not None,
                f"metrics: {question} must hold a row in the section 8 table, "
                "not only a mention in prose",
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
