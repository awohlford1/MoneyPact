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
  identifier reaches a measurement surface, no consent basis is recorded, and
  the release surface stays an open question until it is answered.

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
    "deletion finds nothing": "finds nothing",
    "release surface open": "OQ-80-001",
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


def main() -> int:
    audit = Audit()
    text = REGISTER.read_text(encoding="utf-8")
    conventions = CONVENTIONS.read_text(encoding="utf-8")

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
        for question in ("OQ-80-001", "OQ-80-002", "OQ-80-003"):
            audit.check(
                re.search(rf"^\| `{question}` \|", open_items.group(0), re.M) is not None,
                f"register: {question} must hold a row in the section 7 table, "
                "not only a mention in prose",
            )

    # --- the withdrawn event model has not returned -------------------------
    for name, pattern in EVENT_MODEL.items():
        # Section 2 names the model in order to reject it, so only the register
        # table is scanned for its vocabulary.
        for line in text.splitlines():
            if line.startswith("| `MS-80-"):
                audit.check(not re.search(pattern, line, re.I),
                            f"register: a source row uses the withdrawn event model ({name})")

    # --- the stated total agrees with the table -----------------------------
    stated = re.search(r"\*\*(?:Thirty|(\d+)) sources for (?:thirty-one|(\d+)) proposals\*\*", text)
    audit.check(stated is not None, "register: must state the source and proposal totals")
    audit.check(
        len(rows) == 30 and len(proposals) == 31,
        f"register: the table holds {len(rows)} sources against {len(proposals)} "
        "proposals, and the stated totals are thirty and thirty-one",
    )

    print(f"CBD-80 documentation audit: {audit.checks} checks")
    print(f"Failures: {len(audit.failures)}")
    for failure in audit.failures:
        print(f"  - {failure}")
    if not audit.failures:
        print("Result: PASS (documentation integrity only; no source is implemented, "
              "none has been read, and no figure may be released until OQ-80-001 is answered)")
    return 1 if audit.failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
