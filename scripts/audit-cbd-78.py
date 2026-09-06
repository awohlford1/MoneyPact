#!/usr/bin/env python3
"""Structural audit for the CBD-78 engagement and retention metrics package.

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

* Every metric identifier is unique, sequential from MT-78-001, and every
  measurement source is marked "proposed" -- CBD-80 assigns the MS-80-nnn
  identifiers and this package may not pre-empt them.

* The five UB-77-001 limbs are present and each cites an approved source.
  CBD-78-AC03 requires the usable-budget definition to name a minimum profile,
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
METRICS = REPO_ROOT / "docs/cbd-78-engagement-and-retention-metrics.md"
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

AD_LIMBS = ("Collaboration", "Transaction", "Budget change")

# Metrics AB-74-014 constrains beyond ordinary suppression. Until OQ-78-002
# confirms the section 6 reading, these two are defined and not authorized for
# release, and the document must keep saying so.
ALERT_CONSTRAINED = ("MT-78-007", "MT-78-008")


class Audit:
    def __init__(self) -> None:
        self.checks = 0
        self.failures: list[str] = []

    def check(self, ok: bool, message: str) -> None:
        self.checks += 1
        if not ok:
            self.failures.append(message)


def metric_blocks(text: str) -> dict[str, str]:
    """Return {MT-78-nnn: the record body} for each metric heading."""
    blocks: dict[str, str] = {}
    headings = list(re.finditer(r"^### (MT-78-\d{3}) — (.+)$", text, re.M))
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
    audit.check(len(blocks) >= 1, "metrics: no MT-78-nnn records found")

    # --- identifiers are unique and sequential from 001 ---------------------
    numbers = sorted(int(k.rsplit("-", 1)[1]) for k in blocks)
    audit.check(numbers == list(range(1, len(numbers) + 1)),
                f"metrics: identifiers must run MT-78-001 upward with no gaps, got {numbers}")

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

    # --- AD-78-001 states three limbs, each citing an approved source -------
    section = re.search(r"\*\*`AD-78-001`.*?(?=\n## )", text, re.S)
    audit.check(section is not None, "metrics: AD-78-001 activity condition table not found")
    if section:
        for limb in AD_LIMBS:
            row = re.search(rf"^\| \*\*{re.escape(limb)}\*\* \| (.+?) \| (.+?) \|$",
                            section.group(0), re.M)
            audit.check(bool(row), f"AD-78-001: limb {limb!r} missing")
            if row:
                audit.check(
                    bool(re.search(r"`(?:SD-071|AB-74|CA-92)-\d+`", row.group(2))),
                    f"AD-78-001: limb {limb!r} cites no approved source",
                )

    # Approved Private MVP deferral must remain visible on each affected record.
    # These checks protect specification disposition, not source feasibility.
    for identifier in ("MT-78-004", "MT-78-005", "MT-78-006"):
        body = blocks.get(identifier, "")
        audit.check(
            bool(re.search(
                r"^\| Private MVP disposition \| \*\*Deferred — unavailable, "
                r"not zero or measured success\.\*\*.*future definitions only; "
                r"§4 reopening gate applies \|$", body, re.M)),
            f"{identifier}: approved Private MVP deferral and reopening gate missing",
        )
    for required in (
        "Permission is not evidence of action.",
        "Source feasibility remains unproven under mutation/deletion.",
        "no numeric release or surviving-state proxy is substituted",
        "Source assignment alone does not satisfy this gate.",
        "missing evidence requires a dated extension or pause decision, never automatic success",
    ):
        audit.check(required in text,
                    f"metrics: approved deferral safeguard missing: {required}")

    # --- RT-78-001 keeps neither window set ---------------------------------
    # This is the sentence that makes retention permitted rather than a cohort
    # under another name. AN-92-005 prohibits persisting the contributing
    # records, so a retention computation that stops saying it discards them is
    # a defect in the measure, not a lapse in the prose.
    retention = re.search(r"\*\*`RT-78-001`.*?(?=\n\*\*Why this is not)", text, re.S)
    audit.check(retention is not None, "metrics: RT-78-001 computation not found")
    if retention:
        audit.check(
            re.search(r"[Rr]etain neither set", retention.group(0)) is not None,
            "RT-78-001: must state that neither window set is retained -- AN-92-005",
        )
        steps = re.findall(r"^\d+\. ", retention.group(0), re.M)
        audit.check(len(steps) == 5,
                    f"RT-78-001: expected five numbered steps, found {len(steps)}")
    audit.check(
        "not a cohort" in text.lower(),
        "metrics: must state why the retention computation is not a cohort -- AN-92-001",
    )

    # --- the AB-74-014 constraint stays attached to both alert metrics ------
    # CBD-78-AC06 requires an acknowledgement rate and AB-74-014 prohibits
    # visibility into whether a person acknowledged. Section 6 reconciles them
    # on three conditions. If a later edit drops the pointer, the metric looks
    # like an ordinary aggregate and the constraint is lost.
    for identifier in ALERT_CONSTRAINED:
        body = blocks.get(identifier, "")
        audit.check(bool(body), f"{identifier}: metric missing")
        if body:
            audit.check(
                "§6" in body or "section 6" in body.lower(),
                f"{identifier}: must point at the AB-74-014 release constraint",
            )
    audit.check("AB-74-014" in text,
                "metrics: must engage AB-74-014, which CBD-78-AC06 runs against")
    # The claim must stand in section 6, where the reading is argued, and not
    # only in the open-items table. Checking the whole document would pass on
    # either alone, which is how a guard ends up protecting nothing.
    # Inverted at the OQ-78-002 decision of September 5, 2026. These guards
    # required "not authorized for release", which was true while the question
    # was open and false the moment it was answered -- section 4.77's defect,
    # which this family has now hit often enough to expect.
    #
    # What must stay true is the four release conditions, and above all the
    # fourth. Conditions 1 to 3 keep the figure away from members; only the
    # ratchet stops the operator using it to press harder, which is what
    # AB-74-014's broader first sentence actually forbids. It is also the
    # condition a later edit would most plausibly drop, because it constrains
    # the reader of the metric rather than its audience.
    section_six = re.search(r"^## 6\. .*?(?=^## 7\.)", text, re.S | re.M)
    audit.check(section_six is not None, "metrics: section 6 not found")
    if section_six:
        body = section_six.group(0)
        audit.check(
            "one-way ratchet" in body.lower(),
            "metrics section 6: must state the one-way ratchet, which is the only "
            "condition addressing AB-74-014's prohibition on using alert "
            "behaviour to pressure",
        )
        audit.check(
            re.search(r"never\b[^.]{0,80}\bmore (?:numerous|frequent|insistent)", body, re.I)
            is not None,
            "metrics section 6: the ratchet must state what it forbids, not only "
            "what it permits",
        )
        for condition in ("Global only", "Never a member-visible surface",
                          "No response may name, contact, or differentiate a member"):
            audit.check(condition in body,
                        f"metrics section 6: release condition {condition!r} missing")

    # The ratchet must ride on both metric records, not only in section 6. A
    # reader who opens the record and not the section would otherwise see an
    # ordinary aggregate.
    for identifier in ALERT_CONSTRAINED:
        body = blocks.get(identifier, "")
        if body:
            audit.check(
                "may never justify sending more" in body,
                f"{identifier}: must carry the one-way ratchet on its own record",
            )

    print(f"CBD-78 documentation audit: {audit.checks} checks")
    print(f"Failures: {len(audit.failures)}")
    for failure in audit.failures:
        print(f"  - {failure}")
    if not audit.failures:
        print("Result: PASS (documentation integrity only; deferred measures remain "
              "unavailable; source assignment is not feasibility proof; none measured)")
    return 1 if audit.failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
