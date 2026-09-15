#!/usr/bin/env python3
"""Repeatable structural and traceability audit for the CBD-73 package.

The audit fixes the exact Approved v1.0.5 identifier sets, source baseline, declared
totals, cross-document references, open-gate namespace, and repository wiring.
It proves documentation integrity only.  Product approval, implementation,
specialist review, and runtime evidence remain governed by OI-73-001..012.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

SPEC = Path("docs/cbd-73-invitation-consent-lifecycle-specification.md")
MESSAGES = Path("docs/cbd-73-customer-message-inventory.md")
TESTS = Path("docs/cbd-73-negative-recovery-test-inventory.md")
TRACE = Path("docs/cbd-73-acceptance-criteria-traceability.md")
REVIEW = Path("docs/cbd-73-exhaustive-review-findings.md")
PACKAGE_FILES = (SPEC, MESSAGES, TESTS, TRACE)

EXPECTED_DEFINITIONS: dict[str, set[str]] = {
    "IC": {f"IC-73-{number:03d}" for number in range(1, 22)},
    "TR": {
        *(f"TR-73-{number:02d}" for number in range(1, 40)),
        *(f"TR-73-{number:02d}" for number in range(40, 48)),
    },
    "RC": {f"RC-73-{number:02d}" for number in range(1, 15)},
    "DR": {f"DR-73-{number:02d}" for number in range(1, 14)},
    "AE": {f"AE-73-{number:02d}" for number in range(1, 33)},
    "MSG": {
        *(f"MSG-73-{number:03d}" for number in range(1, 7)),
        *(f"MSG-73-{number:03d}" for number in range(10, 27)),
        "MSG-73-027",
        *(f"MSG-73-{number:03d}" for number in range(29, 48)),
        "MSG-73-049",
        *(f"MSG-73-{number:03d}" for number in range(50, 54)),
    },
}

SCENARIO_COUNTS = {
    "INV": 19,
    "VER": 11,
    "CNS": 11,
    "DCL": 13,
    "DST": 8,
    "CHG": 13,
    "RVK": 16,
    "TRF": 10,
}

EXPECTED_OPEN_ISSUES = {f"OI-73-{number:03d}" for number in range(1, 13)}
EXPECTED_REVIEW_FINDINGS = {f"RV-73-{number:03d}" for number in range(1, 30)}
EXPECTED_AC = {f"CBD-73-AC{number:02d}" for number in range(1, 18)}

# These manifests deliberately freeze every direct stable-ID reference in each
# transition row.  A semantic change must update both the row and this reviewed
# expectation.  They catch reference-set drift and unnamed contracts; they do
# not infer emission polarity, conditions, or cardinality from natural language.
TRANSITION_AUDIT_REFERENCE_MANIFEST: dict[str, set[str]] = {
    "TR-73-01": {"AE-73-01", "AE-73-31"},
    "TR-73-02": {"AE-73-02"},
    "TR-73-03": {"AE-73-03"},
    "TR-73-04": {"AE-73-04"},
    "TR-73-05": {"AE-73-05", "AE-73-16", "AE-73-31"},
    "TR-73-06": {"AE-73-06", "AE-73-16", "AE-73-31"},
    "TR-73-07": {"AE-73-07", "AE-73-16"},
    "TR-73-08": {"AE-73-08", "AE-73-16", "AE-73-31"},
    "TR-73-09": {"AE-73-09"},
    "TR-73-10": {"AE-73-06", "AE-73-10", "AE-73-16"},
    "TR-73-11": {"AE-73-11", "AE-73-16", "AE-73-31"},
    "TR-73-12": {"AE-73-06", "AE-73-12", "AE-73-16", "AE-73-31"},
    "TR-73-13": {"AE-73-06", "AE-73-13", "AE-73-15", "AE-73-16", "AE-73-30"},
    "TR-73-14": {"AE-73-07", "AE-73-08", "AE-73-14", "AE-73-16"},
    "TR-73-15": {"AE-73-01", "AE-73-05", "AE-73-27", "AE-73-31"},
    "TR-73-16": {"AE-73-02"},
    "TR-73-17": {"AE-73-07"},
    "TR-73-18": {"AE-73-06", "AE-73-31"},
    "TR-73-19": {"AE-73-07", "AE-73-28"},
    "TR-73-38": {"AE-73-30", "AE-73-32"},
    "TR-73-39": {"AE-73-06", "AE-73-30", "AE-73-31", "AE-73-32"},
    "TR-73-20": {"AE-73-17", "AE-73-30"},
    "TR-73-21": {"AE-73-18", "AE-73-19", "AE-73-20", "AE-73-30"},
    "TR-73-22": {"AE-73-18"},
    "TR-73-23": {"AE-73-18", "AE-73-20", "AE-73-30"},
    "TR-73-24": {"AE-73-18", "AE-73-30"},
    "TR-73-25": {"AE-73-20", "AE-73-30"},
    "TR-73-26": {"AE-73-19", "AE-73-30"},
    "TR-73-27": {"AE-73-20"},
    "TR-73-28": {"AE-73-20"},
    "TR-73-29": {"AE-73-26", "AE-73-31"},
    "TR-73-30": {"AE-73-06", "AE-73-16", "AE-73-21", "AE-73-23", "AE-73-30"},
    "TR-73-31": {"AE-73-06", "AE-73-16", "AE-73-22", "AE-73-23", "AE-73-30"},
    "TR-73-32": {"AE-73-06", "AE-73-16", "AE-73-22", "AE-73-23", "AE-73-30"},
    "TR-73-33": {"AE-73-24", "AE-73-30"},
    "TR-73-34": {"AE-73-29"},
    "TR-73-35": {"AE-73-23"},
    "TR-73-36": {"AE-73-16"},
    "TR-73-37": {"AE-73-16"},
    "TR-73-40": {"AE-73-25", "AE-73-30"},
    "TR-73-41": {"AE-73-25"},
    "TR-73-42": {"AE-73-25"},
    "TR-73-43": {"AE-73-06", "AE-73-25", "AE-73-30"},
    "TR-73-44": {"AE-73-25", "AE-73-30"},
    "TR-73-45": {"AE-73-25", "AE-73-30"},
    "TR-73-46": {"AE-73-25", "AE-73-30"},
    "TR-73-47": {"AE-73-25"},
}

TRANSITION_MESSAGE_REFERENCE_MANIFEST: dict[str, set[str]] = {
    "TR-73-01": {"MSG-73-001", "MSG-73-004"},
    "TR-73-02": {"MSG-73-002"},
    "TR-73-03": set(),
    "TR-73-04": set(),
    "TR-73-05": {"MSG-73-004"},
    "TR-73-06": {"MSG-73-003", "MSG-73-005"},
    "TR-73-07": {"MSG-73-003"},
    "TR-73-08": {"MSG-73-010"},
    "TR-73-09": {"MSG-73-011"},
    "TR-73-10": {"MSG-73-003", "MSG-73-012"},
    "TR-73-11": {"MSG-73-013"},
    "TR-73-12": {"MSG-73-014"},
    "TR-73-13": {
        "MSG-73-003",
        "MSG-73-015",
        "MSG-73-016",
        "MSG-73-019",
        "MSG-73-021",
        "MSG-73-023",
    },
    "TR-73-14": {"MSG-73-003"},
    "TR-73-15": {"MSG-73-001", "MSG-73-004"},
    "TR-73-16": {"MSG-73-006"},
    "TR-73-17": {"MSG-73-003", "MSG-73-006"},
    "TR-73-18": {"MSG-73-005"},
    "TR-73-19": set(),
    "TR-73-38": {
        "MSG-73-003",
        "MSG-73-016",
        "MSG-73-017",
        "MSG-73-050",
        "MSG-73-051",
    },
    "TR-73-39": {"MSG-73-052"},
    "TR-73-20": {"MSG-73-030"},
    "TR-73-21": {"MSG-73-029", "MSG-73-031"},
    "TR-73-22": {"MSG-73-037"},
    "TR-73-23": {"MSG-73-038"},
    "TR-73-24": {"MSG-73-039"},
    "TR-73-25": {"MSG-73-029"},
    "TR-73-26": {"MSG-73-032"},
    "TR-73-27": {"MSG-73-029"},
    "TR-73-28": {"MSG-73-029"},
    "TR-73-29": {"MSG-73-024"},
    "TR-73-30": {"MSG-73-033", "MSG-73-035"},
    "TR-73-31": {"MSG-73-034", "MSG-73-035", "MSG-73-047"},
    "TR-73-32": {"MSG-73-034", "MSG-73-035", "MSG-73-049"},
    "TR-73-33": {"MSG-73-036"},
    "TR-73-34": {"MSG-73-026"},
    "TR-73-35": set(),
    "TR-73-36": {"MSG-73-018"},
    "TR-73-37": set(),
    "TR-73-40": {"MSG-73-040"},
    "TR-73-41": {"MSG-73-025"},
    "TR-73-42": {"MSG-73-041"},
    "TR-73-43": {"MSG-73-042"},
    "TR-73-44": {"MSG-73-043"},
    "TR-73-45": {"MSG-73-044"},
    "TR-73-46": {"MSG-73-027", "MSG-73-045", "MSG-73-046"},
    "TR-73-47": {"MSG-73-027", "MSG-73-046"},
}

NON_EMITTING_MESSAGES = {"MSG-73-020"}

GOVERNING_BLOBS = {
    # Re-pinned September 4, 2026 for CBD-71 v1.1.2, which re-pins its own
    # section 2 baseline to the approved CBD-68 v1.1 and CBD-70 v1.1 sources;
    # again when CBD-71 section 8B recorded the reopen-amend-re-close workflow
    # that produced it; and again at CBD-71 v1.1.3, which re-pins CBD-69 to its
    # v1.1.1 editorial correction. Every one is editorial under CBD-71 section
    # 8.6 with no SD-071 or DD-071 decision changed.
    # It is editorial under CBD-71 section 8.6: no SD-071 or DD-071 decision
    # changed status, text, or evidence, and MVP Schedule Decisions v1.1 remains
    # the decision set.  CBD-73 cites this register for alert semantics,
    # mandatory in-app instances, personal delivery preferences, server-side
    # enforcement, and accessibility, none of which the re-pin touches, so no
    # CBD-73 rule is affected.
    Path("docs/cbd-71-mvp-schedule-decision-register.md"): (
        "fb70a7a0754a876b88c66a97469f0a57f67dd9c9"
    ),
    # Re-pinned September 15, 2026 for the approved CBD-72 v0.1.55 row 36 amendment
    # (manual-account management, PO-CBD72-ROW36-001), which adds a permission row
    # and touches no section CBD-73 cites; previously re-pinned September 2, 2026
    # for the v0.1.54 section 5.4 amendment, which removed the
    # recipient-configurable "privacy" item.  CBD-73 cites section 5.4 only for the
    # personal-settings boundary, which neither amendment changes, so no CBD-73
    # rule is affected.
    Path("docs/cbd-72-collaboration-permission-model.md"): (
        "6678f529c1c7f8cc1274ffc39a9855bf7e67bc41"
    ),
    # Re-pinned September 3, 2026, most recently for CBD-91 v1.0.4, which
    # records the corrected CR-91-001/002/003/004/005/006 sources.  Every row
    # kept its controlling outcome; no data class, classification, flow, rule,
    # or evidence gap changed, so no CBD-73 rule is affected.
    Path("docs/cbd-91-private-mvp-data-inventory.md"): (
        "5e3b1255fa6f6c020a54869cf22828a27792e04d"
    ),
    # Re-pinned September 3, 2026, most recently for CBD-94 v1.0.3, which marks
    # every section 8 reconciliation done and re-pins its own CBD-91 and CBD-92
    # source rows.  CBD-73 cites SR-94-007 through SR-94-011, none of which
    # changed.
    Path("docs/cbd-94-risk-mitigation-requirement-register.md"): (
        "ce6b3e105aff7f120eb670d3685c787082911516"
    ),
    # Re-pinned September 4, 2026 for the CBD-95 v1.0.10 refresh, which brings
    # the follow-up register's current-state fields up to date with the
    # September 2 to 4 closures.  CBD-73 cites this register for the Product
    # Owner dispositions RI-93-001 to RI-93-019; no disposition, priority,
    # required work, closure evidence, or effect-while-open changed, so no
    # CBD-73 rule is affected.
    Path("docs/cbd-95-architecture-roadmap-follow-up-register.md"): (
        "6d1f61f6aa49d920035acde5e97700c26c650181"
    ),
}

REQUIRED_HEADINGS = {
    SPEC: (
        "## 3. Governing invariants",
        "## 4. Invitation lifecycle state model",
        "## 10. Role and resource-scope changes after acceptance",
        "## 11. Revocation and removal",
        "## 12. Primary ownership transfer consent ceremony",
        "## 13. Invitation and consent data requirements",
        "## 14. Audit-event inventory",
        "## 15. BLOCKING OPEN-ISSUE REGISTER — DO NOT IMPLEMENT AROUND THESE GATES",
    ),
    MESSAGES: (
        "## 2. Cross-cutting semantic rules",
        "## 3. Open issues controlling this draft",
        "## 4. Message inventory",
        "## 6. Evidence gates",
    ),
    TESTS: (
        "## 2. Scenario families",
        "## 3. Open issues controlling expected outcomes",
        "## 4. Scenario inventory",
        "## 5. Required-case and hardening coverage check",
        "## 6. Totals",
    ),
    TRACE: (
        "## 2. Reproducible governing-source baseline",
        "## 3. Jira deliverable traceability",
        "## 4. CBD-73 acceptance-criteria mapping",
        "## 7. Stable open-issue and release-gate register",
        "## 10. RV-73 finding disposition ledger",
        "## 11. Approval, implementation, release, and publication gates",
    ),
}

LOCAL_ID = re.compile(r"\b(?:IC|TR|RC|DR|AE|MSG)-73-\d{2,3}\b")
SCENARIO_ID = re.compile(r"\b(?:INV|VER|CNS|DCL|DST|CHG|RVK|TRF)-73-\d{2}\b")
LEGACY_SCENARIO_ID = re.compile(
    r"\b(?:INV|VER|CNS|DCL|DST|CHG|RVK|TRF)-(?!73\b)\d{2}\b"
)
OPEN_ID = re.compile(r"\bOI-73-\d{3}\b")
REVIEW_ID = re.compile(r"\bRV-73-\d{3}\b")
AC_ID = re.compile(r"\bCBD-73-AC\d{2}\b")
ABBREVIATED_ENDPOINT = re.compile(
    r"\b(?:IC|TR|RC|DR|AE|MSG|OI|RV|INV|VER|CNS|DCL|DST|CHG|RVK|TRF)"
    r"-73-\d{2,3}`?(?:/|–|—)`?\d{2,3}\b"
)


@dataclass
class Audit:
    checks: int = 0
    failures: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def check(self, condition: bool, message: str) -> None:
        self.checks += 1
        if not condition:
            self.failures.append(message)

    def warn(self, condition: bool, message: str) -> None:
        if not condition:
            self.warnings.append(message)


def read(path: Path) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def table_ids(text: str, pattern: str) -> list[str]:
    return re.findall(rf"^\|\s*`?({pattern})`?\s*\|", text, flags=re.MULTILINE)


def table_row_map(text: str, pattern: str) -> dict[str, str]:
    """Return definition-table rows keyed by their stable first-column ID."""
    rows: dict[str, str] = {}
    for line in text.splitlines():
        match = re.match(rf"^\|\s*`?({pattern})`?\s*\|", line)
        if match:
            rows[match.group(1)] = line
    return rows


def table_cell_map(text: str, pattern: str) -> dict[str, list[str]]:
    """Return parsed Markdown-table cells keyed by a stable first-column ID."""
    rows: dict[str, list[str]] = {}
    for line in text.splitlines():
        match = re.match(rf"^\|\s*`?({pattern})`?\s*\|", line)
        if not match:
            continue
        cells = re.split(r"(?<!\\)\|", line)
        if cells and not cells[0].strip():
            cells = cells[1:]
        if cells and not cells[-1].strip():
            cells = cells[:-1]
        rows[match.group(1)] = [
            cell.strip().replace(r"\|", "|") for cell in cells
        ]
    return rows


def report_set_difference(
    audit: Audit, label: str, actual: set[str], expected: set[str]
) -> None:
    missing = sorted(expected - actual)
    unexpected = sorted(actual - expected)
    audit.check(not missing, f"{label}: missing definitions: {', '.join(missing)}")
    audit.check(
        not unexpected,
        f"{label}: unexpected definitions: {', '.join(unexpected)}",
    )


def git_blob_sha1(path: Path) -> str:
    result = subprocess.run(
        ["git", "hash-object", str(path).replace("\\", "/")],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip()


def table_blocks(text: str) -> list[list[str]]:
    blocks: list[list[str]] = []
    current: list[str] = []
    for line in text.splitlines():
        if line.startswith("|"):
            current.append(line)
        elif current:
            blocks.append(current)
            current = []
    if current:
        blocks.append(current)
    return blocks


def check_markdown_structure(audit: Audit, path: Path, text: str) -> None:
    audit.check(text.startswith("# "), f"{path}: missing level-one title")
    audit.check(
        len(re.findall(r"^# ", text, flags=re.MULTILINE)) == 1,
        f"{path}: expected exactly one level-one title",
    )
    audit.check(text.count("```") % 2 == 0, f"{path}: unbalanced fenced block")
    audit.check(not text.startswith("\ufeff"), f"{path}: unexpected UTF-8 BOM")
    audit.check(text.endswith("\n"), f"{path}: missing final newline")
    trailing = [
        number
        for number, line in enumerate(text.splitlines(), start=1)
        if line.endswith((" ", "\t"))
    ]
    audit.check(
        not trailing,
        f"{path}: trailing whitespace on lines {', '.join(map(str, trailing))}",
    )
    audit.check(
        "| Status | **Approved v1.0.5 " in text,
        f"{path}: package status is not Approved v1.0.5",
    )
    audit.check(
        "| Document version | 1.0.5 |" in text,
        f"{path}: document version is not 1.0.5",
    )

    headings = re.findall(r"^#{2,6}\s+(.+)$", text, flags=re.MULTILINE)
    duplicates = sorted(
        heading for heading, count in Counter(headings).items() if count > 1
    )
    audit.check(not duplicates, f"{path}: duplicate headings: {', '.join(duplicates)}")

    for heading in REQUIRED_HEADINGS[path]:
        audit.check(heading in text, f"{path}: missing heading {heading!r}")

    for number, block in enumerate(table_blocks(text), start=1):
        widths = [len(re.findall(r"(?<!\\)\|", line)) for line in block]
        audit.check(
            len(set(widths)) == 1,
            f"{path}: malformed Markdown table block {number}; pipe counts {widths}",
        )


def check_local_paths(audit: Audit, package_text: str) -> None:
    paths = set(
        re.findall(r"`((?:docs|scripts|\.github)/[^`\s]+)`", package_text)
    )
    for literal in sorted(paths):
        normalized = literal.split("#", 1)[0]
        normalized = re.sub(r":\d+(?:-\d+)?$", "", normalized)
        if any(marker in normalized for marker in ("*", "<", ">")):
            continue
        audit.check(
            (ROOT / normalized).exists(),
            f"package references missing local path: {literal}",
        )


def check_source_baseline(audit: Audit, trace_text: str) -> None:
    audit.check(
        "c096928a903dd5446b26ba21eaf7eaa2d84ce936" in trace_text,
        "traceability: reviewed main baseline commit is missing",
    )
    for path, expected_hash in GOVERNING_BLOBS.items():
        audit.check((ROOT / path).is_file(), f"missing governing source: {path}")
        if not (ROOT / path).is_file():
            continue
        audit.check(
            expected_hash in trace_text,
            f"traceability: governing blob is not recorded for {path}",
        )
        actual_hash = git_blob_sha1(path)
        audit.check(
            actual_hash == expected_hash,
            f"{path}: governing source changed; expected {expected_hash}, got {actual_hash}",
        )


def main() -> int:
    audit = Audit()
    texts: dict[Path, str] = {}

    for path in PACKAGE_FILES:
        audit.check((ROOT / path).is_file(), f"missing package file: {path}")
        if not (ROOT / path).is_file():
            continue
        texts[path] = read(path)
        check_markdown_structure(audit, path, texts[path])

    if len(texts) != len(PACKAGE_FILES):
        return finish(audit)

    definition_sources = {
        "IC": (SPEC, r"IC-73-\d{3}"),
        "TR": (SPEC, r"TR-73-\d{2}"),
        "RC": (SPEC, r"RC-73-\d{2}"),
        "DR": (SPEC, r"DR-73-\d{2}"),
        "AE": (SPEC, r"AE-73-\d{2}"),
        "MSG": (MESSAGES, r"MSG-73-\d{3}"),
    }

    all_definitions: set[str] = set()
    for family, (path, pattern) in definition_sources.items():
        ids = table_ids(texts[path], pattern)
        duplicates = sorted(
            identifier for identifier, count in Counter(ids).items() if count > 1
        )
        audit.check(
            not duplicates,
            f"{path}: duplicate {family} definitions: {', '.join(duplicates)}",
        )
        actual = set(ids)
        report_set_difference(audit, family, actual, EXPECTED_DEFINITIONS[family])
        all_definitions.update(actual)

    scenario_definitions: set[str] = set()
    for family, count in SCENARIO_COUNTS.items():
        ids = table_ids(texts[TESTS], rf"{family}-73-\d{{2}}")
        expected = {f"{family}-73-{number:02d}" for number in range(1, count + 1)}
        duplicates = sorted(
            identifier for identifier, value in Counter(ids).items() if value > 1
        )
        audit.check(
            not duplicates,
            f"{TESTS}: duplicate {family} scenarios: {', '.join(duplicates)}",
        )
        report_set_difference(audit, family, set(ids), expected)
        scenario_definitions.update(ids)

    ac_rows = table_ids(texts[TRACE], r"CBD-73-AC\d{2}")
    ac_duplicates = sorted(
        identifier for identifier, count in Counter(ac_rows).items() if count > 1
    )
    audit.check(
        not ac_duplicates,
        f"{TRACE}: duplicate acceptance-criterion rows: {', '.join(ac_duplicates)}",
    )
    report_set_difference(audit, "CBD-73 AC", set(ac_rows), EXPECTED_AC)

    for path in (SPEC, TRACE):
        open_rows = table_ids(texts[path], r"OI-73-\d{3}")
        duplicates = sorted(
            identifier
            for identifier, count in Counter(open_rows).items()
            if count > 1
        )
        audit.check(
            not duplicates,
            f"{path}: duplicate open-issue definitions: {', '.join(duplicates)}",
        )
        report_set_difference(
            audit, f"{path} open issues", set(open_rows), EXPECTED_OPEN_ISSUES
        )

    audit.check((ROOT / REVIEW).is_file(), f"missing independent review file: {REVIEW}")
    if (ROOT / REVIEW).is_file():
        review_text = read(REVIEW)
        review_rows = table_ids(review_text, r"RV-73-\d{3}")
        review_duplicates = sorted(
            identifier
            for identifier, count in Counter(review_rows).items()
            if count > 1
        )
        audit.check(
            not review_duplicates,
            f"{REVIEW}: duplicate review rows: {', '.join(review_duplicates)}",
        )
        report_set_difference(
            audit,
            "CBD-73 independent review",
            set(review_rows),
            EXPECTED_REVIEW_FINDINGS,
        )
        audit.check(
            "| Document version | 1.0.5 |" in review_text,
            f"{REVIEW}: remediation review is not version 1.0.5",
        )

    trace_review_rows = table_ids(texts[TRACE], r"RV-73-\d{3}")
    report_set_difference(
        audit,
        "traceability RV ledger",
        set(trace_review_rows),
        EXPECTED_REVIEW_FINDINGS,
    )

    package_text = "\n".join(texts[path] for path in PACKAGE_FILES)
    review_text = read(REVIEW) if (ROOT / REVIEW).is_file() else ""
    direct_local_references = set(LOCAL_ID.findall(package_text))
    direct_scenario_references = set(SCENARIO_ID.findall(package_text))
    direct_open_references = set(OPEN_ID.findall(package_text))
    direct_review_references = set(REVIEW_ID.findall(package_text))
    direct_ac_references = set(AC_ID.findall(package_text))

    audit.check(
        direct_local_references <= all_definitions,
        "dangling local identifiers: "
        + ", ".join(sorted(direct_local_references - all_definitions)),
    )
    audit.check(
        direct_scenario_references <= scenario_definitions,
        "dangling scenario identifiers: "
        + ", ".join(sorted(direct_scenario_references - scenario_definitions)),
    )
    audit.check(
        direct_open_references <= EXPECTED_OPEN_ISSUES,
        "dangling open-issue identifiers: "
        + ", ".join(sorted(direct_open_references - EXPECTED_OPEN_ISSUES)),
    )
    audit.check(
        direct_review_references <= EXPECTED_REVIEW_FINDINGS,
        "dangling review identifiers: "
        + ", ".join(sorted(direct_review_references - EXPECTED_REVIEW_FINDINGS)),
    )
    audit.check(
        direct_ac_references <= EXPECTED_AC,
        "dangling CBD-73 acceptance-criterion identifiers: "
        + ", ".join(sorted(direct_ac_references - EXPECTED_AC)),
    )

    legacy = sorted(set(LEGACY_SCENARIO_ID.findall(package_text)))
    audit.check(not legacy, "legacy unnamespaced scenario identifiers remain")
    abbreviated_endpoints = sorted(
        set(ABBREVIATED_ENDPOINT.findall(package_text + "\n" + review_text))
    )
    audit.check(
        not abbreviated_endpoints,
        "abbreviated stable-ID endpoints remain: " + ", ".join(abbreviated_endpoints),
    )

    occurrence_counts = Counter(LOCAL_ID.findall(package_text))
    for family in ("TR", "AE", "MSG"):
        orphans = sorted(
            identifier
            for identifier in EXPECTED_DEFINITIONS[family]
            if occurrence_counts[identifier] < 2
        )
        audit.check(
            not orphans,
            f"{family}: definitions without a second package edge: {', '.join(orphans)}",
        )

    transition_rows = table_row_map(texts[SPEC], r"TR-73-\d{2}")
    report_set_difference(
        audit,
        "transition audit-reference manifest keys",
        set(TRANSITION_AUDIT_REFERENCE_MANIFEST),
        EXPECTED_DEFINITIONS["TR"],
    )
    report_set_difference(
        audit,
        "transition message-reference manifest keys",
        set(TRANSITION_MESSAGE_REFERENCE_MANIFEST),
        EXPECTED_DEFINITIONS["TR"],
    )
    for identifier in sorted(EXPECTED_DEFINITIONS["TR"]):
        row = transition_rows.get(identifier, "")
        actual_audit_references = set(re.findall(r"AE-73-\d{2}", row))
        expected_audit_references = TRANSITION_AUDIT_REFERENCE_MANIFEST.get(
            identifier, set()
        )
        audit.check(
            actual_audit_references == expected_audit_references,
            f"{identifier}: audit-reference manifest mismatch; expected "
            f"{sorted(expected_audit_references)}, got {sorted(actual_audit_references)}",
        )
        actual_message_references = set(re.findall(r"MSG-73-\d{3}", row))
        expected_message_references = TRANSITION_MESSAGE_REFERENCE_MANIFEST.get(
            identifier, set()
        )
        audit.check(
            actual_message_references == expected_message_references,
            f"{identifier}: message-reference manifest mismatch; expected "
            f"{sorted(expected_message_references)}, got {sorted(actual_message_references)}",
        )

    scenario_rows = table_row_map(
        texts[TESTS], r"(?:INV|VER|CNS|DCL|DST|CHG|RVK|TRF)-73-\d{2}"
    )
    scenario_cells = table_cell_map(
        texts[TESTS], r"(?:INV|VER|CNS|DCL|DST|CHG|RVK|TRF)-73-\d{2}"
    )
    scenario_outcomes = {
        identifier: cells[2] if len(cells) >= 3 else ""
        for identifier, cells in scenario_cells.items()
    }
    scenario_contract_text = "\n".join(scenario_rows.values())
    test_transition_references = set(
        re.findall(r"TR-73-\d{2}", scenario_contract_text)
    )
    scenario_outcome_text = "\n".join(scenario_outcomes.values())
    test_audit_references = set(
        re.findall(r"AE-73-\d{2}", scenario_outcome_text)
    )
    test_message_references = set(
        re.findall(r"MSG-73-\d{3}", scenario_outcome_text)
    )
    report_set_difference(
        audit,
        "scenario transition coverage",
        test_transition_references,
        EXPECTED_DEFINITIONS["TR"],
    )
    report_set_difference(
        audit,
        "scenario audit-event coverage",
        test_audit_references,
        EXPECTED_DEFINITIONS["AE"],
    )
    report_set_difference(
        audit,
        "scenario emitting-message coverage",
        test_message_references - NON_EMITTING_MESSAGES,
        EXPECTED_DEFINITIONS["MSG"] - NON_EMITTING_MESSAGES,
    )

    # Coverage must be attached to the transition it proves.  A package-level
    # occurrence can otherwise conceal a missing conditional child event or
    # message edge by mentioning the identifier in an unrelated scenario.
    for identifier in sorted(EXPECTED_DEFINITIONS["TR"]):
        proving_rows = [
            scenario_id
            for scenario_id, row in scenario_rows.items()
            if identifier in row
        ]
        covered_audits = set(
            re.findall(
                r"AE-73-\d{2}",
                "\n".join(scenario_outcomes[row_id] for row_id in proving_rows),
            )
        )
        missing_audits = (
            TRANSITION_AUDIT_REFERENCE_MANIFEST[identifier] - covered_audits
        )
        audit.check(
            not missing_audits,
            f"{identifier}: scenarios do not cover audit references: "
            + ", ".join(sorted(missing_audits)),
        )

        covered_messages = set(
            re.findall(
                r"MSG-73-\d{3}",
                "\n".join(scenario_outcomes[row_id] for row_id in proving_rows),
            )
        )
        missing_messages = (
            TRANSITION_MESSAGE_REFERENCE_MANIFEST[identifier] - covered_messages
        )
        audit.check(
            not missing_messages,
            f"{identifier}: scenarios do not cover message references: "
            + ", ".join(sorted(missing_messages)),
        )

    missing_scenario_audit_assertion = sorted(
        identifier
        for identifier, row in scenario_outcomes.items()
        if not re.search(r"AE-73-\d{2}|no new audit event", row, flags=re.I)
    )
    audit.check(
        not missing_scenario_audit_assertion,
        "scenarios without an exact audit or explicit no-new-event assertion: "
        + ", ".join(missing_scenario_audit_assertion),
    )

    denied_or_committed = re.compile(
        r"\b(?:deny|denies|denied|denial|reject|rejects|rejected|rejection|"
        r"invalidate|invalidates|invalidated|invalidation|commit|commits|"
        r"committed|commitment)\b",
        flags=re.IGNORECASE,
    )
    missing_exact_scenario_audit = sorted(
        identifier
        for identifier, row in scenario_outcomes.items()
        if denied_or_committed.search(row)
        and not re.search(r"AE-73-\d{2}|no new audit event", row, flags=re.I)
    )
    audit.check(
        not missing_exact_scenario_audit,
        "denied/committed scenarios without an exact audit assertion: "
        + ", ".join(missing_exact_scenario_audit),
    )

    spec_message_references = set(re.findall(r"MSG-73-\d{3}", texts[SPEC]))
    audit.check(
        NON_EMITTING_MESSAGES.isdisjoint(spec_message_references),
        "non-emitting compatibility message appears in the lifecycle specification: "
        + ", ".join(sorted(NON_EMITTING_MESSAGES & spec_message_references)),
    )
    audit.check(
        EXPECTED_DEFINITIONS["MSG"] - NON_EMITTING_MESSAGES
        <= spec_message_references,
        "emitting message IDs missing from the lifecycle specification: "
        + ", ".join(
            sorted(
                (EXPECTED_DEFINITIONS["MSG"] - NON_EMITTING_MESSAGES)
                - spec_message_references
            )
        ),
    )

    audit.check(
        len(EXPECTED_DEFINITIONS["MSG"]) == 48,
        "internal audit configuration error: expected message total is not 48",
    )
    audit.check(
        "48 exact semantic contracts" in texts[TRACE]
        and "all 48 rows" in texts[MESSAGES],
        "declared 48-message total is missing or inconsistent",
    )
    scenario_total = sum(SCENARIO_COUNTS.values())
    audit.check(scenario_total == 101, "internal audit configuration error: scenario total")
    audit.check(
        "101 globally namespaced scenarios" in texts[TRACE]
        and "101 scenarios in 8 families" in texts[TESTS],
        "declared 101-scenario/eight-family total is missing or inconsistent",
    )

    for path in (SPEC, MESSAGES, TESTS):
        literal = str(path).replace("\\", "/")
        audit.check(
            f"`{literal}`" in package_text,
            f"package does not cross-reference {literal}",
        )

    check_local_paths(audit, package_text)
    check_source_baseline(audit, texts[TRACE])

    abbreviated = sorted(set(re.findall(r"\bTR-\d{2}(?!-)", texts[SPEC])))
    audit.check(
        not abbreviated,
        "state diagram or specification uses abbreviated transition labels: "
        + ", ".join(abbreviated),
    )

    unresolved_markers = sorted(
        set(re.findall(r"\b(?:TODO|TBD|TBC|FIXME)\b", package_text, flags=re.I))
    )
    audit.check(
        not unresolved_markers,
        "unregistered placeholder markers remain: " + ", ".join(unresolved_markers),
    )

    package_json = json.loads(read(Path("package.json")))
    scripts = package_json.get("scripts", {})
    audit.check(
        scripts.get("check:docs") == "node scripts/check-mermaid.mjs",
        "package.json: check:docs is not wired to the Mermaid validator",
    )
    audit.check(
        "npm run check:docs" in scripts.get("check", ""),
        "package.json: normal check command does not include documentation validation",
    )
    audit.check(
        (ROOT / "scripts/check-mermaid.mjs").is_file(),
        "missing scripts/check-mermaid.mjs",
    )
    workflow = read(Path(".github/workflows/ci.yml"))
    audit.check(
        "python3 scripts/audit-cbd-73.py" in workflow,
        "CI does not run the CBD-73 structural audit",
    )
    audit.check(
        "npm run check" in workflow,
        "CI does not run the check command containing Mermaid validation",
    )

    return finish(audit)


def finish(audit: Audit) -> int:
    print(f"CBD-73 documentation audit: {audit.checks} checks")
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
