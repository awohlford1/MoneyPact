#!/usr/bin/env python3
"""Verify that every identifier the CBD-13 metric packages cite actually exists.

Why this exists
---------------
The CBD-77 approval review checked each cited identifier against its approved
source by hand and found two problems: a limb citing a decision that did not
support it, and a class the citing document had inherited from an upstream
error. The first needed a person. **The second half of that work did not** --
confirming that a cited identifier resolves to a real row is mechanical, and
doing it by hand is how a typo'd or invented citation survives review.

Each package audit already checks that a claim *carries* a citation. None of
them checks that the citation *resolves*, so `SD-071-999` would pass every one.

What this does not do
---------------------
It cannot tell whether a source supports the claim made about it. `SD-071-010`
exists and says something true; it simply did not establish what CBD-77 cited
it for. That judgment stays with the reviewer, and CBD-77 `OQ-77-004` records
the one instance found.

    python scripts/check-citations.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DOCS = REPO_ROOT / "docs"

# Documents whose citations are checked.
CITING = (
    "cbd-13-measurement-conventions.md",
    "cbd-77-activation-and-onboarding-metrics.md",
    "cbd-77-acceptance-criteria-traceability.md",
    "cbd-78-engagement-and-retention-metrics.md",
    "cbd-79-reliability-and-safety-metrics.md",
    "cbd-80-measurement-source-register.md",
)

# Identifier family -> the approved document that defines it.
DEFINED_IN = {
    "SD-071": "cbd-71-mvp-schedule-decision-register.md",
    "CA-92": "cbd-92-system-flow-technical-threat-model.md",
    "AN-92": "cbd-92-system-flow-technical-threat-model.md",
    "OP-92": "cbd-92-system-flow-technical-threat-model.md",
    "AB-74": "cbd-74-accountability-alert-boundary-specification.md",
    "INC-76": "cbd-76-mvp-boundary-and-readiness-record.md",
    "PRO-76": "cbd-76-mvp-boundary-and-readiness-record.md",
    "DI-91": "cbd-91-private-mvp-data-inventory.md",
    "SG-93": "cbd-93-privacy-coercion-abuse-analysis.md",
    "EX-102": "cbd-102-evidence-register-and-exception-rules.md",
    "HG-102": "cbd-102-provider-requirements-hard-gate-catalog.md",
}

CITATION = re.compile(r"\b((?:" + "|".join(DEFINED_IN) + r")-\d+)\b")


def defining_row(body: str, identifier: str) -> bool:
    """A definition is a table row opening with the identifier, or a bolded
    definition line. A passing mention elsewhere is not a definition."""
    return bool(
        re.search(rf"^\|\s*`?{re.escape(identifier)}`?\s*\|", body, re.M)
        or re.search(rf"^\**`?{re.escape(identifier)}`?\**\s*[—-]", body, re.M)
    )


def main() -> int:
    sources: dict[str, str] = {}
    failures: list[str] = []
    checked = 0

    for family, filename in DEFINED_IN.items():
        path = DOCS / filename
        if not path.is_file():
            failures.append(f"{family}: defining document {filename} not found")
            continue
        sources[family] = path.read_text(encoding="utf-8")

    for name in CITING:
        path = DOCS / name
        if not path.is_file():
            failures.append(f"{name}: citing document not found")
            continue
        text = path.read_text(encoding="utf-8")
        for identifier in sorted(set(CITATION.findall(text))):
            family = identifier.rsplit("-", 1)[0]
            body = sources.get(family)
            if body is None:
                continue
            checked += 1
            if not defining_row(body, identifier):
                failures.append(
                    f"{name}: cites {identifier}, which has no defining row in "
                    f"{DEFINED_IN[family]}")

    print(f"check-citations: {checked} citations across {len(CITING)} documents")
    if failures:
        print(f"{len(failures)} unresolved:")
        for failure in failures:
            print("  - " + failure)
        print("\nA cited identifier that does not resolve is either a typo or an "
              "invention. Neither survives a reader who follows the citation.")
        return 1
    print("Every cited identifier resolves to a defining row.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
