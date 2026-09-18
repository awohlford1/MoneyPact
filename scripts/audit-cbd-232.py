#!/usr/bin/env python3
"""Repeatable structural and traceability audit for the CBD-232 package.

The audit fixes the exact Approved 0.3 identifier sets, document version, and
cross-document traceability for docs/cbd-232-budget-creation-proposal-
contract.md. It proves documentation integrity only. Implementation and
runtime evidence remain governed by the §11 verification-contract groups and
by CBD-232-AC01..08's required implementation evidence.

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
DOC = Path("docs/cbd-232-budget-creation-proposal-contract.md")

# §4.2 (success response) and §4.4 (proposed confirmation handoff) interfaces
# and type aliases. Each must be declared exactly once.
EXPECTED_INTERFACES = (
    "BudgetCreationProposalResponse",
    "ConsentDisclosure",
    "ProposalLifecycle",
    "BudgetCreationProposalReadResponse",
    "ConfirmBudgetCreationRequest",
)

EXPECTED_AC = {f"CBD-232-AC{number:02d}" for number in range(1, 9)}
# The 0.3 amendment reuses existing criteria rather than minting new ones.
AMENDED_AC = {"CBD-232-AC03", "CBD-232-AC06"}

AC_ROW = re.compile(r"^\|\s*`(CBD-232-AC\d{2})`\s*(\([^)]*\))?\s*\|", re.MULTILINE)
AC_REF = re.compile(r"\bCBD-232-AC\d{2}\b")
FIELD_ERROR_CODE = re.compile(r"^\|\s*`([a-z][a-z0-9.-]*)`\s*\|", re.MULTILINE)


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
        and "applying the 0.3 consent amendment" in text,
        f"{DOC}: package status is not the 0.3 consent-amendment approval",
    )
    audit.check(
        "| Document version | 0.3.3 |" in text,
        f"{DOC}: document version is not 0.3.3",
    )
    headings = re.findall(r"^#{2,6}\s+(.+)$", text, flags=re.MULTILINE)
    duplicates = sorted(h for h, count in Counter(headings).items() if count > 1)
    audit.check(not duplicates, f"{DOC}: duplicate headings: {', '.join(duplicates)}")

    unresolved = sorted(set(re.findall(r"\b(?:TODO|TBD|TBC|FIXME)\b", text, flags=re.I)))
    audit.check(not unresolved, f"{DOC}: unregistered placeholder markers remain")


def check_interfaces(audit: Audit, text: str) -> None:
    for name in EXPECTED_INTERFACES:
        occurrences = re.findall(
            rf"^(?:interface|type)\s+{re.escape(name)}\b", text, flags=re.MULTILINE
        )
        audit.check(bool(occurrences), f"§4.2/4.4: missing declaration for {name}")
        audit.check(
            len(occurrences) <= 1,
            f"§4.2/4.4: {name} is declared more than once ({len(occurrences)} times)",
        )

    response_block = section(text, "### 4.2 Success response")
    audit.check(
        "readonly currentDisclosure: ConsentDisclosure;" in response_block,
        "§4.2: BudgetCreationProposalResponse is missing "
        "`currentDisclosure: ConsentDisclosure`",
    )
    for field_name in ("kind", "version", "digest", "text"):
        audit.check(
            re.search(rf"readonly {field_name}:", response_block) is not None,
            f"§4.2: ConsentDisclosure is missing field `{field_name}`",
        )

    handoff_block = section(text, "### 4.4 Proposed confirmation handoff")
    audit.check(
        "readonly acknowledgedDisclosure?:" in handoff_block,
        "§4.4: ConfirmBudgetCreationRequest is missing the optional "
        "`acknowledgedDisclosure` claim",
    )


def check_ac_rows(audit: Audit, text: str) -> None:
    rows = AC_ROW.findall(text)
    plain = [ac for ac, suffix in rows if not suffix]
    amended = [ac for ac, suffix in rows if suffix]

    plain_duplicates = sorted(i for i, count in Counter(plain).items() if count > 1)
    audit.check(
        not plain_duplicates,
        f"duplicate CBD-232 acceptance-criterion rows: {', '.join(plain_duplicates)}",
    )
    report_set_difference(audit, "CBD-232 AC", set(plain), EXPECTED_AC)

    unexpected_amended = sorted(set(amended) - AMENDED_AC)
    audit.check(
        not unexpected_amended,
        "0.3 consent-amendment traceability rows cite an unexpected criterion: "
        + ", ".join(unexpected_amended),
    )
    missing_amended = sorted(AMENDED_AC - set(amended))
    audit.check(
        not missing_amended,
        "0.3 consent-amendment traceability is missing a row for: "
        + ", ".join(missing_amended),
    )
    amended_duplicates = sorted(i for i, count in Counter(amended).items() if count > 1)
    audit.check(
        not amended_duplicates,
        f"duplicate 0.3 consent-amendment traceability rows: {', '.join(amended_duplicates)}",
    )
    audit.check(bool(rows), f"{DOC}: no CBD-232 acceptance-criterion rows found")

    ac_refs = set(AC_REF.findall(text))
    audit.check(
        ac_refs <= EXPECTED_AC,
        "dangling CBD-232 acceptance-criterion references: "
        + ", ".join(sorted(ac_refs - EXPECTED_AC)),
    )


def check_field_error_catalog(audit: Audit, text: str) -> None:
    block = section(text, "### 5.2 Top-level catalog")
    audit.check(bool(block), f"{DOC}: missing section 5.2")
    codes = FIELD_ERROR_CODE.findall(block)
    audit.check(len(codes) > 0, "§5.2: no field-error codes found")
    duplicates = sorted(c for c, count in Counter(codes).items() if count > 1)
    audit.check(not duplicates, f"§5.2: duplicate field-error codes: {', '.join(duplicates)}")
    malformed = sorted(c for c in codes if not re.fullmatch(r"[a-z][a-z0-9]*(?:[.-][a-z0-9]+)+", c))
    audit.check(
        not malformed,
        f"§5.2: field-error codes do not match the dotted/hyphenated convention: "
        + ", ".join(malformed),
    )


def main() -> int:
    audit = Audit()
    audit.check((ROOT / DOC).is_file(), f"missing package file: {DOC}")
    if not (ROOT / DOC).is_file():
        return finish(audit)

    text = read(DOC)
    check_markdown_structure(audit, text)
    check_interfaces(audit, text)
    check_ac_rows(audit, text)
    check_field_error_catalog(audit, text)

    return finish(audit)


def finish(audit: Audit) -> int:
    print(f"CBD-232 documentation audit: {audit.checks} checks")
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
