#!/usr/bin/env python3
"""Repeatable structural and traceability audit for the CBD-233 package.

The audit fixes the exact Approved 0.2 identifier sets, document version, and
cross-document traceability for docs/cbd-233-budget-creation-confirmation-
contract.md. It proves documentation integrity only. Implementation and
runtime evidence remain governed by the CONF-233-T* verification catalog and
by CBD-233-AC01..09's required implementation evidence.

Mirrors the shape of scripts/audit-cbd-73.py: read the document, assert
structure, list failures by identifier, exit 0 on a clean pass.
"""

from __future__ import annotations

import re
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOC = Path("docs/cbd-233-budget-creation-confirmation-contract.md")

# The CBD-233 section 3.3 stable failure-outcome set, widened to eight members
# by the 0.2 consent amendment's `stale_disclosure` addition. This is the same
# closed set registered as the `cbd-233-failure-outcome` vocabulary in
# scripts/check-doc-vocabulary.py; it is repeated here, independently, because
# this audit checks the section 3.3 *table* (which the vocabulary checker does
# not scan -- a pipe is not list glue) rather than a prose restatement.
EXPECTED_OUTCOMES = {
    "unauthenticated",
    "proposal_not_found",
    "proposal_not_current",
    "idempotency_key_reused",
    "authorization_denied",
    "confirmation_stale",
    "stale_disclosure",
    "retryable_conflict",
}

EXPECTED_INVARIANTS = {f"BCC-233-{number:03d}" for number in range(1, 10)}
EXPECTED_SCENARIOS = {f"CONF-233-T{number:02d}" for number in range(1, 12)}
EXPECTED_AC = {f"CBD-233-AC{number:02d}" for number in range(1, 10)}
# The 0.2 amendment reuses existing criteria rather than minting new ones; each
# amendment row's base ID must be one of these three.
AMENDED_AC = {"CBD-233-AC02", "CBD-233-AC03", "CBD-233-AC06"}

INVARIANT_ROW = re.compile(r"^\|\s*`(BCC-233-\d{3})`\s*\|", re.MULTILINE)
SCENARIO_ROW = re.compile(r"^\|\s*`(CONF-233-T\d{2})`\s*\|", re.MULTILINE)
AC_ROW = re.compile(
    r"^\|\s*`(CBD-233-AC\d{2})`\s*(\([^)]*\))?\s*\|", re.MULTILINE
)
INVARIANT_REF = re.compile(r"\bBCC-233-\d{3}\b")
SCENARIO_REF = re.compile(r"\bCONF-233-T\d{2}\b")
AC_REF = re.compile(r"\bCBD-233-AC\d{2}\b")


@dataclass
class Audit:
    checks: int = 0
    failures: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def check(self, condition: bool, message: str) -> None:
        self.checks += 1
        if not condition:
            self.failures.append(message)


def read(path: Path) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def report_set_difference(
    audit: Audit, label: str, actual: set[str], expected: set[str]
) -> None:
    missing = sorted(expected - actual)
    unexpected = sorted(actual - expected)
    audit.check(not missing, f"{label}: missing: {', '.join(missing)}")
    audit.check(not unexpected, f"{label}: unexpected: {', '.join(unexpected)}")


def section(text: str, heading: str) -> str:
    """Return the text from one heading up to (not including) the next
    level-2-through-6 heading."""
    match = re.search(
        rf"^{re.escape(heading)}\n(.*?)(?=^#{{2,6}} |\Z)", text, re.MULTILINE | re.DOTALL
    )
    return match.group(1) if match else ""


def check_markdown_structure(audit: Audit, text: str) -> None:
    audit.check(text.startswith("# "), f"{DOC}: missing level-one title")
    audit.check(
        len(re.findall(r"^# ", text, flags=re.MULTILINE)) == 1,
        f"{DOC}: expected exactly one level-one title",
    )
    audit.check(text.count("```") % 2 == 0, f"{DOC}: unbalanced fenced block")
    audit.check(not text.startswith("﻿"), f"{DOC}: unexpected UTF-8 BOM")
    audit.check(text.endswith("\n"), f"{DOC}: missing final newline")
    trailing = [
        number
        for number, line in enumerate(text.splitlines(), start=1)
        if line.endswith((" ", "\t"))
    ]
    audit.check(
        not trailing,
        f"{DOC}: trailing whitespace on lines {', '.join(map(str, trailing))}",
    )
    audit.check(
        "| Status | **Approved" in text
        and "PO-CONTRACT-APPROVALS-003" in text
        and "applying the 0.2 consent amendment" in text,
        f"{DOC}: package status is not the 0.2 consent-amendment approval",
    )
    audit.check(
        "| Document version | 0.2 |" in text,
        f"{DOC}: document version is not 0.2",
    )
    headings = re.findall(r"^#{2,6}\s+(.+)$", text, flags=re.MULTILINE)
    duplicates = sorted(h for h, count in Counter(headings).items() if count > 1)
    audit.check(not duplicates, f"{DOC}: duplicate headings: {', '.join(duplicates)}")

    unresolved = sorted(set(re.findall(r"\b(?:TODO|TBD|TBC|FIXME)\b", text, flags=re.I)))
    audit.check(not unresolved, f"{DOC}: unregistered placeholder markers remain")


def check_outcome_table(audit: Audit, text: str) -> None:
    block = section(text, "### 3.3 Stable failure outcomes")
    audit.check(bool(block), f"{DOC}: missing section 3.3")
    rows = re.findall(r"^\|\s*`([a-z_]+)`\s*\|", block, flags=re.MULTILINE)
    duplicates = sorted(o for o, count in Counter(rows).items() if count > 1)
    audit.check(not duplicates, f"section 3.3: duplicate outcome rows: {', '.join(duplicates)}")
    report_set_difference(audit, "section 3.3 outcome table", set(rows), EXPECTED_OUTCOMES)
    # Table row order is not asserted; only membership, uniqueness and count.
    audit.check(
        len(EXPECTED_OUTCOMES) == 8,
        "internal audit configuration error: expected outcome count is not 8",
    )


def check_dense_ids(audit: Audit, text: str) -> None:
    invariant_rows = INVARIANT_ROW.findall(text)
    duplicates = sorted(i for i, count in Counter(invariant_rows).items() if count > 1)
    audit.check(not duplicates, f"duplicate BCC-233 invariant rows: {', '.join(duplicates)}")
    report_set_difference(audit, "BCC-233 invariants", set(invariant_rows), EXPECTED_INVARIANTS)

    scenario_rows = SCENARIO_ROW.findall(text)
    duplicates = sorted(i for i, count in Counter(scenario_rows).items() if count > 1)
    audit.check(not duplicates, f"duplicate CONF-233-T scenario rows: {', '.join(duplicates)}")
    report_set_difference(audit, "CONF-233-T scenarios", set(scenario_rows), EXPECTED_SCENARIOS)


def check_ac_rows(audit: Audit, text: str) -> None:
    rows = AC_ROW.findall(text)
    base_ids = [ac for ac, _ in rows]
    plain = [ac for ac, suffix in rows if not suffix]
    amended = [ac for ac, suffix in rows if suffix]

    plain_duplicates = sorted(i for i, count in Counter(plain).items() if count > 1)
    audit.check(
        not plain_duplicates,
        f"duplicate CBD-233 acceptance-criterion rows: {', '.join(plain_duplicates)}",
    )
    report_set_difference(audit, "CBD-233 AC", set(plain), EXPECTED_AC)

    unexpected_amended = sorted(set(amended) - AMENDED_AC)
    audit.check(
        not unexpected_amended,
        "0.2 consent-amendment traceability rows cite an unexpected criterion: "
        + ", ".join(unexpected_amended),
    )
    missing_amended = sorted(AMENDED_AC - set(amended))
    audit.check(
        not missing_amended,
        "0.2 consent-amendment traceability is missing a row for: "
        + ", ".join(missing_amended),
    )
    amended_duplicates = sorted(i for i, count in Counter(amended).items() if count > 1)
    audit.check(
        not amended_duplicates,
        f"duplicate 0.2 consent-amendment traceability rows: {', '.join(amended_duplicates)}",
    )
    audit.check(bool(base_ids), f"{DOC}: no CBD-233 acceptance-criterion rows found")


def check_dangling_references(audit: Audit, text: str) -> None:
    invariant_refs = set(INVARIANT_REF.findall(text))
    scenario_refs = set(SCENARIO_REF.findall(text))
    ac_refs = set(AC_REF.findall(text))
    audit.check(
        invariant_refs <= EXPECTED_INVARIANTS,
        "dangling BCC-233 invariant references: "
        + ", ".join(sorted(invariant_refs - EXPECTED_INVARIANTS)),
    )
    audit.check(
        scenario_refs <= EXPECTED_SCENARIOS,
        "dangling CONF-233-T scenario references: "
        + ", ".join(sorted(scenario_refs - EXPECTED_SCENARIOS)),
    )
    audit.check(
        ac_refs <= EXPECTED_AC,
        "dangling CBD-233 acceptance-criterion references: "
        + ", ".join(sorted(ac_refs - EXPECTED_AC)),
    )


def main() -> int:
    audit = Audit()
    audit.check((ROOT / DOC).is_file(), f"missing package file: {DOC}")
    if not (ROOT / DOC).is_file():
        return finish(audit)

    text = read(DOC)
    check_markdown_structure(audit, text)
    check_outcome_table(audit, text)
    check_dense_ids(audit, text)
    check_ac_rows(audit, text)
    check_dangling_references(audit, text)

    return finish(audit)


def finish(audit: Audit) -> int:
    print(f"CBD-233 documentation audit: {audit.checks} checks")
    print(f"Failures: {len(audit.failures)}")
    for failure in audit.failures:
        print(f"  FAIL: {failure}")
    print(f"Warnings: {len(audit.warnings)}")
    for warning in audit.warnings:
        print(f"  WARN: {warning}")
    if not audit.failures:
        print("Result: PASS (documentation integrity only; open gates remain binding)")
    return 1 if audit.failures else 0


if __name__ == "__main__":
    sys.exit(main())
