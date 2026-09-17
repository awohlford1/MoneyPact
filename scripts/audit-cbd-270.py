#!/usr/bin/env python3
"""Repeatable structural and traceability audit for the CBD-270 package.

The audit implements the ten mechanical checks that §16.1 of
docs/cbd-270-platform-safety-operating-model.md names for Guard, against the
v0.5.2 draft. It proves documentation integrity only: it establishes that the
document's identifiers resolve, that its own restatements agree with each
other, and that no decision body slipped a power past the rules §4, §12 and
`PS-270-075` state. It does not establish that any `PS-270-*` design is built,
that any gate in §18.5 has closed, or that `OQ-270-*` has been answered.

Mirrors the shape of scripts/audit-cbd-233.py: read the document, assert
structure, list failures by identifier, exit 0 on a clean pass. Every failure
message is prefixed with the §16.1 check number it belongs to, so a red run
can be read against the document's own list.

Two of the checks are keyword scans (5 and 10) and one is a verb scan (8).
§16.1 is explicit that a hit's sense is never inferred: a hit is exempt only
by being one of the four positively asserted cells or by containing an exact
allowlisted string verbatim. Editing an exempted passage re-arms the check.
"""

from __future__ import annotations

import re
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOC = Path("docs/cbd-270-platform-safety-operating-model.md")

EXPECTED_DECISIONS = {f"PS-270-{number:03d}" for number in range(1, 79)}
EXPECTED_QUESTIONS = {f"OQ-270-{number:03d}" for number in range(1, 10)}

# The thirteen elements of CBD-270-AC01, in the criterion's order, read from
# Jira on 2026-09-17 (customfield_10066). §3 through §15 carry them one each.
AC01_ELEMENTS = (
    "Scope",
    "Prohibited staff powers",
    "Intake",
    "Severity model",
    "Response targets",
    "Staffing and on-call ownership",
    "Evidence handling",
    "Access controls",
    "User communication",
    "Escalation",
    "Appeals",
    "Audit",
    "Training",
)
FIRST_ELEMENT_SECTION = 3

# Check 2: the document that owns each identifier family a **Source** line may
# cite, per §1.1's pinned-inputs table. `EG-*` splits by package number.
# `RF-92` is not in §16.1's family list but `PS-270-020` cites `RF-92-012`; it
# is resolved anyway and its omission from the list is reported as a warning.
OWNING_DOC = {
    "DI-91": Path("docs/cbd-91-private-mvp-data-inventory.md"),
    "EG-91": Path("docs/cbd-91-private-mvp-data-inventory.md"),
    "OP-92": Path("docs/cbd-92-system-flow-technical-threat-model.md"),
    "AN-92": Path("docs/cbd-92-system-flow-technical-threat-model.md"),
    "EM-92": Path("docs/cbd-92-system-flow-technical-threat-model.md"),
    "NT-92": Path("docs/cbd-92-system-flow-technical-threat-model.md"),
    "SA-92": Path("docs/cbd-92-system-flow-technical-threat-model.md"),
    "RL-92": Path("docs/cbd-92-system-flow-technical-threat-model.md"),
    "PA-92": Path("docs/cbd-92-system-flow-technical-threat-model.md"),
    "RF-92": Path("docs/cbd-92-system-flow-technical-threat-model.md"),
    "AB-93": Path("docs/cbd-93-privacy-coercion-abuse-analysis.md"),
    "SG-93": Path("docs/cbd-93-privacy-coercion-abuse-analysis.md"),
    "EG-93": Path("docs/cbd-93-privacy-coercion-abuse-analysis.md"),
    "RK-94": Path("docs/cbd-94-risk-mitigation-requirement-register.md"),
    "SR-94": Path("docs/cbd-94-risk-mitigation-requirement-register.md"),
    "RG-94": Path("docs/cbd-94-risk-mitigation-requirement-register.md"),
    "MON-94": Path("docs/cbd-94-verification-review-inventory.md"),
    "VT-94": Path("docs/cbd-94-verification-review-inventory.md"),
    "RI-93": Path("docs/cbd-95-cbd-12-reconciliation-matrix.md"),
    "FU-95": Path("docs/cbd-95-architecture-roadmap-follow-up-register.md"),
    "DL-76": Path("docs/cbd-76-mvp-boundary-and-readiness-record.md"),
    "INC-76": Path("docs/cbd-76-mvp-boundary-and-readiness-record.md"),
}
LISTED_FAMILIES = set(OWNING_DOC) - {"RF-92"}

# Check 4: the two closed sets §17.2 defines. Repeated here independently of
# scripts/check-doc-vocabulary.py for the same reason audit-cbd-233.py repeats
# its outcome set -- this audit checks the §17.2 *table* and the canonical
# decision's enumeration, which the vocabulary checker does not scan.
CASE_OUTCOMES = ("Actioned", "No action", "Out of scope", "Escalated", "Withdrawn")
APPEAL_OUTCOMES = ("Upheld", "Reversed", "Modified", "Out of scope")

# Check 6: the literal marker, without the bold that wraps it in a heading.
CONDITIONAL_MARKER = "Conditional on `OQ-270-006`"

# Check 8: the scanned verb forms, exactly the §16.1 list. Matched without
# regard to case so that a stale row reading "Stop the affected surface" fires.
SURFACE_STOP_VERB = re.compile(
    r"\b(?:suspend(?:s|ed|ing)?|suspension|stop(?:s|ped|ping)?|stop-ship|"
    r"disabl(?:e|es|ed|ing))\b",
    re.IGNORECASE,
)

# Check 8: the four positive assertions. (decision, table row index, must
# contain). The two "must not contain a surface-stop authorization" halves are
# asserted as: after the required string is removed, no scanned verb remains
# in the row. A row may therefore say "never a ... suspension" and nothing
# else about stopping anything.
POSITIVE_CELLS = (
    ("PS-270-033", 0, "Never a target-wide or product-wide suspension", True),
    ("PS-270-033", 1, "stop the affected release surface", False),
    ("PS-270-057", 0, "never a target-, space- or product-wide suspension", True),
    ("PS-270-057", 1, "stop the affected release surface", False),
)

# Check 8: the exemption allowlist, decision id plus exact quoted string,
# transcribed literally from the §16.1 table. The script also parses that
# table and fails if the two lists differ, so the document remains the spec.
ALLOWLIST = (
    ("PS-270-024", "stop-ship rules are keyed to these four words"),
    ("PS-270-033", "Only a Critical *finding* stops a release surface"),
    ("PS-270-033", "Critical stop-ship rule in one sentence"),
    ("PS-270-033", "its remedy is stopping a **release surface**"),
    ("PS-270-033", "never suspends the reported author's ability to comment"),
    ("PS-270-033", "never suspends the comment surface for a target, a space, or the product"),
    ("PS-270-033", "Only this decision may specify a suspension at all, and only on a Critical finding"),
    ("PS-270-033", "an appeal does not suspend a Critical enforcement action applies to a terminal action, not to this measure"),
    ("PS-270-033", "declines to apply the release-surface stop-ship rule to case handling"),
    ("PS-270-043", "`AN-92-001` disables product analytics"),
    ("PS-270-057", "only the finding stops a surface"),
    ("PS-270-057", "v0.2 left row 1 of this table saying"),
    ("PS-270-057", "the surface-stopping action is moved to its own trigger"),
    ("PS-270-057", "A suspension of a surface, target, or space may be authorized in exactly two places"),
    ("PS-270-057", "§4 does not prohibit suspension, because it is an operations action"),
    ("PS-270-062", "An appeal does not suspend a terminal Critical enforcement action"),
    ("PS-270-075", "would stop being the safe reading of the sources"),
    ("PS-270-075", "suspending a defective surface is an operations action"),
)

# Check 5: the §4 prohibited-power list as keywords, one group per decision
# that states the prohibition. A hit is a granting construction ("may",
# "can", "is permitted to", ...) followed within two words by one of these,
# with the negated forms ("may not", "cannot", "never") excluded. Removal and
# withholding are deliberately absent: §4 records that power as unheld rather
# than prohibited, and check 6 governs it through the conditional marker.
PROHIBITED_POWER = (
    # PS-270-006 standing access
    r"browse", r"search (?:comments|cases|the datastore)", r"open a budget space",
    r"read (?:a |the )?membership graph", r"view a financial record",
    r"inspect a notification destination", r"read (?:another|any) person's profile",
    # PS-270-007 exceptional-access path and stored content
    r"use (?:the )?`?OP-92-003`?", r"read stored (?:comment )?content",
    r"read (?:customer|stored) content", r"moderate",
    # PS-270-009 impersonation and authority mutation
    r"impersonat\w+", r"bypass", r"change (?:a|the) notification destination",
    r"(?:cancel|trigger) a protected action", r"initiate a lifecycle request",
    r"(?:create|accept|revoke) an invitation",
    r"transfer (?:ownership|a role|connection authority)",
    # PS-270-010 rewriting
    r"(?:edit|rewrite|alter) (?:the text|another person's comment|an? attribution)",
    r"author content in a person's name",
    # PS-270-011 mediation and contact
    r"identify one member to another", r"pass a message",
    r"contact (?:the other person|a person who is not the reporter)",
    # PS-270-012 and PS-270-013 disclosure and confirmation
    r"(?:disclose|reveal) (?:the reporter|who reported)",
    r"confirm (?:a space|a membership|a role|a resource|existence)",
    # PS-270-014 manual access
    r"manual access",
)
NEGATOR = re.compile(
    r"\b(?:no|not|never|nobody|nothing|none|neither|cannot|without|"
    r"prohibit\w*|forbid\w*|denied|deny|denies|unavailable)\b",
    re.IGNORECASE,
)
GRANT = re.compile(
    r"\b(?:may|can|could|shall|will|"
    r"(?:is|are) (?:permitted|authori[sz]ed|allowed|able|entitled) to)\s+"
    r"(?!not\b|never\b|neither\b|no\b)(?:\w+\s+){0,2}?(?:" + "|".join(PROHIBITED_POWER) + r")",
    re.IGNORECASE,
)

# Check 10: membership, role and lifecycle language that would reintroduce
# the deleted v0.3 remedy at a restatement site. Phrased as offers, not bare
# nouns, because the clean sites say "No membership, role, or lifecycle action
# is offered" and that negation must not trip the scan.
MEMBERSHIP_REMEDY = re.compile(
    r"\b(?:membership (?:remedy|power|powers)|role (?:power|powers|change)|"
    r"remov(?:e|es|ed|ing|al) (?:of )?(?:the|a|an|any|that|this|them|their) "
    r"(?:member|person|author|collaborator|owner|partner|viewer|reporter)|"
    r"remov(?:e|es|ed|ing) (?:them|him|her)\b|expel|expulsion|"
    r"revok(?:e|es|ed|ing)|invitation|invite|archiv(?:e|es|ed|ing|al)|"
    r"transfer(?:s|red)? ownership|scope reduction|remains? available|"
    r"ordinary product surface)",
    re.IGNORECASE,
)
# Check 10: a pointer in the PS-270-078 out-of-scope answer. v0.4's "directs
# them to the ordinary product surface" is the string that must fail.
SURFACE_POINTER = re.compile(
    r"\b(?:direct|directs|directed|directing|point|points|pointed|pointing|"
    r"refer|refers|referred|referring|send|sends|sent|guide|guides|guided|"
    r"steer|steers|steered)\s+(?:them|the person|the requester|the reporter|"
    r"the owner|a person|the member|the asker)\s+to\b|"
    r"ordinary product surface|"
    r"(?:member management|manage members|membership (?:page|screen|settings|surface|tab))",
    re.IGNORECASE,
)

DECISION_HEADING = re.compile(r"^`(PS-270-\d{3})` — \*\*", re.MULTILINE)
QUESTION_ROW = re.compile(r"^\|\s*`(OQ-270-\d{3})`\s*\|", re.MULTILINE)
DECISION_REF = re.compile(r"`(PS-270-\d{3})`")
QUESTION_REF = re.compile(r"`(OQ-270-\d{3})`")
# A cited range, `PS-270-001`–`PS-270-005`, counts as a reference to every
# member. §18.1 cites most decisions only this way.
ID_RANGE = re.compile(r"`([A-Z]{2,4}-\d{2,3})-(\d{3})`–`\1-(\d{3})`")
SOURCE_ID = re.compile(r"`([A-Z]{2,4}-\d{2,3})-(\d{3})`")


@dataclass
class Audit:
    checks: int = 0
    failures: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    label: str = ""
    per_check: dict[str, int] = field(default_factory=dict)

    def begin(self, label: str) -> None:
        self.label = label
        self.per_check[label] = 0

    def check(self, condition: bool, message: str) -> None:
        self.checks += 1
        if not condition:
            self.failures.append(f"{self.label}: {message}")
            self.per_check[self.label] = self.per_check.get(self.label, 0) + 1

    def warn(self, message: str) -> None:
        self.warnings.append(f"{self.label}: {message}")


@dataclass
class Decision:
    id: str
    start: int
    end: int
    heading: str
    body: str
    section: int


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


def collapse(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def table_rows(text: str) -> list[list[str]]:
    """Data rows of every pipe table in `text`, header and rule rows dropped,
    each row a list of collapsed cells."""
    rows: list[list[str]] = []
    lines = [line.strip() for line in text.splitlines()]
    for index, line in enumerate(lines):
        if not line.startswith("|"):
            continue
        cells = [collapse(cell) for cell in line.strip("|").split("|")]
        if all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells):
            continue
        if index + 1 < len(lines) and re.match(r"^\|\s*:?-{3,}", lines[index + 1]):
            continue  # header row
        rows.append(cells)
    return rows


def units(text: str) -> list[str]:
    """Every sentence or table cell, line wrapping collapsed to single spaces.
    The hit unit §16.1 check 8 defines; reused by checks 5 and 10."""
    result: list[str] = []
    paragraph: list[str] = []

    def flush() -> None:
        if paragraph:
            joined = collapse(" ".join(paragraph))
            result.extend(s for s in re.split(r"(?<=[.!?])\s+", joined) if s)
            paragraph.clear()

    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            flush()
            continue
        if stripped.startswith("|"):
            flush()
            cells = [collapse(c) for c in stripped.strip("|").split("|")]
            if not all(re.fullmatch(r":?-{3,}:?", c) for c in cells):
                result.extend(c for c in cells if c)
            continue
        if re.match(r"^(?:[*-]|\d+[a-z]?\.)\s", stripped):
            flush()
        paragraph.append(stripped)
    flush()
    return result


def expand_ranges(text: str) -> str:
    """Append every member of each `X-NNN`–`X-MMM` range so reference scans
    see them as cited."""
    extra: list[str] = []
    for family, low, high in ID_RANGE.findall(text):
        extra.extend(f"`{family}-{n:03d}`" for n in range(int(low), int(high) + 1))
    return text + "\n" + " ".join(extra)


def split_decisions(audit: Audit, text: str) -> list[Decision]:
    """Each `PS-270-*` block: from its heading line through the end of its
    **Source** paragraph. This is the check-8 scan scope."""
    sections = [
        (m.start(), int(m.group(1)))
        for m in re.finditer(r"^## (\d+)\. ", text, re.MULTILINE)
    ]
    decisions: list[Decision] = []
    for match in DECISION_HEADING.finditer(text):
        start = match.start()
        source = re.search(r"^\*\*Source:\*\*.*?(?=\n\n|\Z)", text[start:], re.MULTILINE | re.DOTALL)
        audit.check(source is not None, f"{match.group(1)}: no **Source** line closes the decision")
        if source is None:
            continue
        end = start + source.end()
        block = text[start:end]
        heading = re.match(r"`PS-270-\d{3}` — \*\*(.*?)\*\*", block, re.DOTALL)
        audit.check(heading is not None, f"{match.group(1)}: heading bold does not close")
        number = max((n for pos, n in sections if pos <= start), default=0)
        decisions.append(
            Decision(
                id=match.group(1),
                start=start,
                end=end,
                heading=collapse(heading.group(1)) if heading else "",
                body=block,
                section=number,
            )
        )
    return decisions


def check_markdown_structure(audit: Audit, text: str) -> None:
    audit.begin("structure")
    audit.check(text.startswith("# CBD-270 — "), f"{DOC}: missing level-one title")
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
        "| Status | **Draft** — not approved." in text,
        f"{DOC}: package status is not the unapproved draft this audit targets",
    )
    audit.check(
        "| Document version | 0.5.2 |" in text,
        f"{DOC}: document version is not 0.5.2",
    )
    headings = re.findall(r"^#{2,6}\s+(.+)$", text, flags=re.MULTILINE)
    duplicates = sorted(h for h, count in Counter(headings).items() if count > 1)
    audit.check(not duplicates, f"{DOC}: duplicate headings: {', '.join(duplicates)}")
    unresolved = sorted(set(re.findall(r"\b(?:TODO|TBD|TBC|FIXME)\b", text, flags=re.I)))
    audit.check(not unresolved, f"{DOC}: unregistered placeholder markers remain")


def check_1_identifiers(audit: Audit, text: str, decisions: list[Decision]) -> None:
    """§16.1 check 1: every PS-270-* and OQ-270-* resolves, is unique, and is
    referenced at least once outside its defining row."""
    audit.begin("check 1")
    ids = [d.id for d in decisions]
    duplicates = sorted(i for i, count in Counter(ids).items() if count > 1)
    audit.check(not duplicates, f"duplicate PS-270 decision headings: {', '.join(duplicates)}")
    report_set_difference(audit, "PS-270 decisions", set(ids), EXPECTED_DECISIONS)

    questions = QUESTION_ROW.findall(text)
    duplicates = sorted(i for i, count in Counter(questions).items() if count > 1)
    audit.check(not duplicates, f"duplicate OQ-270 question rows: {', '.join(duplicates)}")
    report_set_difference(audit, "OQ-270 questions", set(questions), EXPECTED_QUESTIONS)

    dangling = set(DECISION_REF.findall(text)) - EXPECTED_DECISIONS
    audit.check(not dangling, f"dangling PS-270 references: {', '.join(sorted(dangling))}")
    dangling = set(QUESTION_REF.findall(text)) - EXPECTED_QUESTIONS
    audit.check(not dangling, f"dangling OQ-270 references: {', '.join(sorted(dangling))}")

    # A decision's defining row is its whole block; a citation must come from
    # elsewhere. Ranges cited in §18.1 count for every member.
    for decision in decisions:
        outside = expand_ranges(text[: decision.start] + text[decision.end :])
        audit.check(
            f"`{decision.id}`" in outside,
            f"{decision.id} is never referenced outside its own decision block",
        )
    for question in questions:
        rows = [
            line for line in text.splitlines()
            if line.startswith(f"| `{question}` |")
        ]
        outside = expand_ranges("\n".join(l for l in text.splitlines() if l not in rows))
        audit.check(
            f"`{question}`" in outside,
            f"{question} is never referenced outside its own §16 row",
        )


def check_2_source_lines(audit: Audit, decisions: list[Decision]) -> None:
    """§16.1 check 2: every identifier a **Source** line cites resolves in the
    document that owns it. A definition is a table row led by the identifier."""
    audit.begin("check 2")
    owned_text: dict[Path, str] = {}
    for path in set(OWNING_DOC.values()):
        audit.check((ROOT / path).is_file(), f"owning document missing: {path}")
        owned_text[path] = read(path) if (ROOT / path).is_file() else ""

    cited: dict[str, set[str]] = {}
    unlisted: set[str] = set()
    for decision in decisions:
        source = re.search(r"^\*\*Source:\*\*.*", decision.body, re.MULTILINE | re.DOTALL)
        line = source.group(0) if source else ""
        for family, number in SOURCE_ID.findall(expand_ranges(line)):
            if family in ("PS-270", "OQ-270"):
                continue
            if family not in OWNING_DOC:
                unlisted.add(family)
                continue
            if family not in LISTED_FAMILIES:
                audit.warn(f"{decision.id} cites family {family}, outside the §16.1 check-2 list")
            cited.setdefault(family, set()).add(f"{family}-{number}")
    audit.check(bool(cited), "no Source-line identifiers found")
    audit.check(not unlisted, f"Source lines cite families with no owning document: {', '.join(sorted(unlisted))}")

    for family, identifiers in sorted(cited.items()):
        owner = owned_text[OWNING_DOC[family]]
        for identifier in sorted(identifiers):
            defined = re.search(rf"^\|\s*`?{re.escape(identifier)}\b", owner, re.MULTILINE)
            audit.check(
                defined is not None,
                f"{identifier} does not resolve in {OWNING_DOC[family]}",
            )


def check_3_elements(audit: Audit, text: str, decisions: list[Decision]) -> None:
    """§16.1 check 3: the thirteen AC01 elements each have exactly one section,
    in the criterion's order, and §18.1 is derived from the headings."""
    audit.begin("check 3")
    headings = dict(
        (int(n), title.strip())
        for n, title in re.findall(r"^## (\d+)\. (.+)$", text, re.MULTILINE)
    )
    for offset, element in enumerate(AC01_ELEMENTS):
        number = FIRST_ELEMENT_SECTION + offset
        audit.check(
            headings.get(number) == element,
            f"§{number} heading is {headings.get(number)!r}, AC01 element {offset + 1} is {element!r}",
        )
    counts = Counter(t for t in headings.values() if t in AC01_ELEMENTS)
    duplicates = sorted(t for t, count in counts.items() if count > 1)
    audit.check(
        not duplicates,
        f"an AC01 element has more than one section: {', '.join(duplicates)}",
    )

    by_section: dict[int, list[str]] = {}
    for decision in decisions:
        by_section.setdefault(decision.section, []).append(decision.id)
    orphans = sorted(
        n for n in by_section if not FIRST_ELEMENT_SECTION <= n < FIRST_ELEMENT_SECTION + len(AC01_ELEMENTS)
    )
    audit.check(not orphans, f"PS-270 decisions outside §3–§15, in sections: {orphans}")

    rows = table_rows(section(text, "### 18.1 `CBD-270-AC01` — thirteen elements, each as its own section"))
    audit.check(len(rows) == len(AC01_ELEMENTS), f"§18.1 has {len(rows)} rows, expected {len(AC01_ELEMENTS)}")
    for row in rows:
        if len(row) != 4:
            audit.check(False, f"§18.1 row is not four cells: {row}")
            continue
        index, element, sec, listed = row
        number = FIRST_ELEMENT_SECTION + int(index) - 1
        audit.check(
            element == AC01_ELEMENTS[int(index) - 1] and sec == f"§{number}",
            f"§18.1 row {index} ({element}, {sec}) is not element {index} at §{number}",
        )
        # Walk the cell so ranges expand in place and document order survives.
        ordered: list[str] = []
        for token in re.finditer(r"`(PS-270-\d{3})`(?:–`PS-270-(\d{3})`)?", listed):
            first, last = token.group(1), token.group(2)
            if last:
                ordered.extend(f"PS-270-{n:03d}" for n in range(int(first[-3:]), int(last) + 1))
            else:
                ordered.append(first)
        audit.check(
            ordered == by_section.get(number, []),
            f"§18.1 row {index} lists {ordered}, §{number} headings give {by_section.get(number, [])}",
        )


def check_4_vocabularies(audit: Audit, text: str) -> None:
    """§16.1 check 4: the two closed vocabularies are complete wherever they
    are enumerated -- the §17.2 table and every restatement."""
    audit.begin("check 4")
    rows = table_rows(section(text, "### 17.2 New vocabulary requiring registration"))
    table = {row[0].strip("`"): row[1] for row in rows if len(row) == 3}
    for name, members, canonical in (
        ("platform-safety-case-outcome", CASE_OUTCOMES, "`PS-270-052`"),
        ("platform-safety-appeal-outcome", APPEAL_OUTCOMES, "`PS-270-062`"),
    ):
        audit.check(name in table, f"§17.2 table lacks `{name}`")
        listed = tuple(re.findall(r"`([^`]+)`", table.get(name, "")))
        audit.check(listed == members, f"§17.2 `{name}` members are {listed}, expected {members}")
        canonical_row = [row for row in rows if row and row[0].strip("`") == name]
        audit.check(
            bool(canonical_row) and canonical in canonical_row[0][2],
            f"§17.2 `{name}` canonical section does not name {canonical}",
        )
        # Every enumeration -- a comma-separated run of backticked items in
        # which two or more are members -- must name them all. Two members
        # mentioned in one sentence of prose is not an enumeration.
        for unit in units(text):
            for run in re.findall(r"`[^`]+`(?:,? (?:and |or )?`[^`]+`)+", unit):
                items = re.findall(r"`([^`]+)`", run)
                named = [m for m in members if m in items]
                if len(named) >= 2:
                    missing = [m for m in members if m not in items]
                    audit.check(
                        not missing,
                        f"`{name}` enumeration omits {missing}: {run[:90]!r}",
                    )
    registry = ROOT / "scripts" / "check-doc-vocabulary.py"
    registered = registry.is_file() and all(
        f'name="{name}"' in registry.read_text(encoding="utf-8")
        for name in ("platform-safety-case-outcome", "platform-safety-appeal-outcome")
    )
    if not registered:
        audit.warn("§17.2 vocabularies are not registered in scripts/check-doc-vocabulary.py")
    elif "Neither is registered in" in section(text, "### 17.2 New vocabulary requiring registration"):
        audit.warn("§17.2 says the vocabularies are unregistered; scripts/check-doc-vocabulary.py registers both")


def check_5_prohibited_powers(audit: Audit, decisions: list[Decision]) -> None:
    """§16.1 check 5: keyword scan of decision bodies against the §4
    prohibited-power list. A hit is a granting construction followed by a
    prohibited power; negated constructions are not hits."""
    audit.begin("check 5")
    for decision in decisions:
        hits = []
        for unit in units(decision.body):
            hit = GRANT.search(unit)
            if hit and not NEGATOR.search(unit[: hit.start()]):
                hits.append(f"{hit.group(0)!r} in {unit[:100]!r}")
        audit.check(
            not hits,
            f"{decision.id} grants a §4-prohibited power: " + "; ".join(hits),
        )


def check_6_conditional_markers(audit: Audit, decisions: list[Decision]) -> None:
    """§16.1 check 6: the decisions PS-270-075 lists as conditional carry the
    marker in their heading, no other decision does, and PS-270-057 row 1 is
    the only row-level marker."""
    audit.begin("check 6")
    by_id = {d.id: d for d in decisions}
    listing = by_id.get("PS-270-075")
    audit.check(listing is not None, "PS-270-075 missing")
    if listing is None:
        return
    item = re.search(r"At decision level:(.*?)At row level:(.*?)\.", collapse(listing.body))
    audit.check(item is not None, "PS-270-075 item 2 does not enumerate decision- and row-level markers")
    listed = set(DECISION_REF.findall(item.group(1))) if item else set()
    audit.check(len(listed) == 7, f"PS-270-075 lists {len(listed)} decision-level markers, expected seven")
    audit.check(
        item is not None and "— seven" in item.group(1),
        "PS-270-075 does not state the decision-level count as seven",
    )
    audit.check(
        item is not None and "row 1 of `PS-270-057`'s trigger table" in item.group(2),
        "PS-270-075 does not enumerate PS-270-057 row 1 as the row-level marker",
    )

    marked = {d.id for d in decisions if CONDITIONAL_MARKER in d.heading}
    report_set_difference(audit, "decision-level conditional markers", marked, listed)

    trigger = by_id.get("PS-270-057")
    rows = table_rows(trigger.body) if trigger else []
    audit.check(len(rows) == 6, f"PS-270-057 trigger table has {len(rows)} rows, expected six")
    for index, row in enumerate(rows):
        has_marker = CONDITIONAL_MARKER in " | ".join(row)
        audit.check(
            has_marker == (index == 0),
            f"PS-270-057 row {index + 1} {'carries' if has_marker else 'lacks'} the row-level marker",
        )

    # Outside headings and PS-270-057 row 1, the marker may appear only in the
    # PS-270-075 passage that enumerates it.
    for decision in decisions:
        body_after_heading = decision.body.split("**", 2)[-1]
        rest = body_after_heading
        if decision.id == "PS-270-057":
            rest = "\n".join(l for l in rest.splitlines() if not l.startswith("| Critical **case**"))
        stray = CONDITIONAL_MARKER in rest and decision.id != "PS-270-075"
        audit.check(not stray, f"{decision.id} carries the marker outside its heading and outside the enumerated row")


def check_7_actioned(audit: Audit, text: str, decisions: list[Decision]) -> None:
    """§16.1 check 7: `Actioned` is the only case-outcome member reachable
    solely through a conditional decision, and §17.2 says so."""
    audit.begin("check 7")
    vocab = collapse(section(text, "### 17.2 New vocabulary requiring registration"))
    audit.check(
        "one member is not yet reachable" in vocab,
        "§17.2 does not state that one member is not yet reachable",
    )
    audit.check(
        "`Actioned` depends on the content power `OQ-270-006` has not granted" in vocab,
        "§17.2 does not tie `Actioned` to `OQ-270-006`",
    )
    audit.check(
        "a case that would be `Actioned` terminates as `Escalated`" in vocab,
        "§17.2 does not state the `Escalated` fallback",
    )
    by_id = {d.id: d for d in decisions}
    canonical = collapse(by_id["PS-270-052"].body) if "PS-270-052" in by_id else ""
    audit.check(
        "`Actioned` is reachable only if `OQ-270-006` grants the content power" in canonical,
        "PS-270-052 does not state that `Actioned` is reachable only under `OQ-270-006`",
    )
    audit.check(
        "PS-270-052" in by_id and CONDITIONAL_MARKER not in by_id["PS-270-052"].heading,
        "PS-270-052, the canonical outcome decision, must not itself be conditional",
    )
    # No other member is described as conditional anywhere.
    for member in CASE_OUTCOMES:
        if member == "Actioned":
            continue
        flagged = [
            unit[:90]
            for unit in units(text)
            if f"`{member}`" in unit
            and "`Actioned`" not in unit
            and re.search(r"reachable only|depends on the content power|not yet reachable", unit)
        ]
        audit.check(not flagged, f"`{member}` is described as conditional: {flagged!r}")
    audit.check(
        "reachable only through `PS-270-062`, which is conditional" in vocab
        and "PS-270-062" in by_id and CONDITIONAL_MARKER in by_id["PS-270-062"].heading,
        "§17.2's appeal-outcome reachability claim does not match PS-270-062's marker",
    )


def check_8_surface_stop(audit: Audit, text: str, decisions: list[Decision]) -> None:
    """§16.1 check 8: no passage other than the two authorizing rows
    authorizes a suspension, stop, or disabling. Scope is decision bodies;
    every verb hit is a positively asserted cell or carries an allowlist entry."""
    audit.begin("check 8")
    by_id = {d.id: d for d in decisions}

    # The document's allowlist table is the spec; the constant above must match.
    check_text = section(text, "### 16.1 Mechanical checks this package needs")
    doc_rows = [
        (re.search(r"`(PS-270-\d{3})`", row[0]).group(1), row[1].strip('"'))
        for row in table_rows(check_text)
        if len(row) == 3 and row[0].startswith("`PS-270-")
    ]
    audit.check(
        doc_rows == list(ALLOWLIST),
        f"§16.1 allowlist table differs from this script's ALLOWLIST: "
        f"doc-only {sorted(set(doc_rows) - set(ALLOWLIST))}, script-only {sorted(set(ALLOWLIST) - set(doc_rows))}",
    )
    audit.check(len(ALLOWLIST) == 18, f"allowlist has {len(ALLOWLIST)} rows, §16.1 says eighteen")

    # Positive assertions.
    asserted: set[tuple[str, str]] = set()
    for decision_id, row_index, required, prohibitive in POSITIVE_CELLS:
        decision = by_id.get(decision_id)
        rows = table_rows(decision.body) if decision else []
        audit.check(
            len(rows) > row_index,
            f"{decision_id} table lacks row {row_index + 1}",
        )
        if len(rows) <= row_index:
            continue
        row_text = " | ".join(rows[row_index])
        audit.check(
            required in row_text,
            f"{decision_id} row {row_index + 1} must contain {required!r}",
        )
        for cell in rows[row_index]:
            asserted.add((decision_id, cell))
        if prohibitive:
            residue = SURFACE_STOP_VERB.findall(row_text.replace(required, ""))
            audit.check(
                not residue,
                f"{decision_id} row {row_index + 1} carries a surface-stop authorization: {residue}",
            )
    # PS-270-057 row 2 is the only row of that table with the finding remedy.
    rows = table_rows(by_id["PS-270-057"].body) if "PS-270-057" in by_id else []
    for index, row in enumerate(rows):
        if index == 1:
            continue
        audit.check(
            "stop the affected release surface" not in " | ".join(row),
            f"PS-270-057 row {index + 1} carries the finding remedy that only row 2 may",
        )

    # The scan.
    used: set[tuple[str, str]] = set()
    for decision in decisions:
        unexempt = []
        for unit in units(decision.body):
            if not SURFACE_STOP_VERB.search(unit):
                continue
            if (decision.id, unit) in asserted:
                continue
            entries = [e for e in ALLOWLIST if e[0] == decision.id and e[1] in unit]
            used.update(entries)
            if not entries:
                unexempt.append(unit[:120])
        audit.check(
            not unexempt,
            f"{decision.id} surface-stop hit with no allowlist entry: {unexempt!r}",
        )
    stale = sorted(set(ALLOWLIST) - used)
    audit.check(not stale, f"allowlist entries matching no hit (edited passage re-arms the check): {stale}")

    # PS-270-057's closing prose states the same rule; the two must agree.
    prose = collapse(by_id["PS-270-057"].body) if "PS-270-057" in by_id else ""
    audit.check(
        "may be authorized in exactly two places: `PS-270-033`'s Critical-finding row, and row 2 of the table above" in prose,
        "PS-270-057 prose does not name the two authorizing rows check 8 asserts",
    )


def check_9_axis_arithmetic(audit: Audit, text: str, decisions: list[Decision]) -> None:
    """§16.1 check 9: the enforceability table, the prose above it, PS-270-025's
    list, §18.5 and check 9's own statement agree: four hold (1, 2, 6, 7), one
    partly (4), two not at all (3, 5) -- and axes 3, 4, 5 still say so."""
    audit.begin("check 9")
    by_id = {d.id: d for d in decisions}
    body = by_id["PS-270-033"].body if "PS-270-033" in by_id else ""
    rows = [r for r in table_rows(body) if len(r) == 3 and r[0].isdigit()]
    audit.check(len(rows) == 7, f"PS-270-033 enforceability table has {len(rows)} axes, expected seven")
    names = {int(r[0]): r[1] for r in rows}
    hold = {int(r[0]) for r in rows if r[2].startswith("**Yes**")}
    partly = {int(r[0]) for r in rows if r[2].startswith("Partly")}
    not_held = {int(r[0]) for r in rows if r[2].startswith("**No**")}
    audit.check(hold == {1, 2, 6, 7}, f"table: axes holding are {sorted(hold)}, expected [1, 2, 6, 7]")
    audit.check(partly == {4}, f"table: axes partly holding are {sorted(partly)}, expected [4]")
    audit.check(not_held == {3, 5}, f"table: axes not holding are {sorted(not_held)}, expected [3, 5]")

    prose = collapse(body)
    audit.check(
        "Four hold today — 1, 2, 6, 7. Axis 4 holds only partly, and axes 3 and 5 do not hold at all." in prose,
        "PS-270-033 prose count above the table does not read four hold (1, 2, 6, 7), 4 partly, 3 and 5 not",
    )
    # Each non-enforceable axis still says so in its own item.
    for axis, statement in (
        (3, "**This axis is not operable today.**"),
        (4, "**This axis exists only to enable axis 3.**"),
        (5, "**The review that would act on the signal does not currently exist.**"),
    ):
        item = re.search(rf"^{axis}\. \*\*{re.escape(names.get(axis, ''))}\.\*\*(.*?)(?=^\d\. \*\*|\n\n\*\*|\Z)", body, re.MULTILINE | re.DOTALL)
        audit.check(
            item is not None and statement in collapse(item.group(1)),
            f"PS-270-033 axis {axis} no longer states {statement!r}",
        )

    # PS-270-025 names the bounds by name; map back through the table.
    bounds = collapse(by_id["PS-270-025"].body) if "PS-270-025" in by_id else ""
    match = re.search(
        r"the measure's (.*?) bounds are properties of the action and hold now — four of the seven; "
        r"its (.*?) bounds require .*?, and its (.*?) bound holds only partly",
        bounds,
    )
    audit.check(match is not None, "PS-270-025 no longer states which bounds hold, partly hold, and do not")
    if match:
        lower = {v.lower(): k for k, v in names.items()}
        def numbers(cell: str) -> set[int]:
            return {lower[n] for n in re.findall(r"\*\*([a-z -]+)\*\*", cell) if n in lower}
        audit.check(numbers(match.group(1)) == hold, f"PS-270-025 hold list {match.group(1)!r} != table {sorted(hold)}")
        audit.check(numbers(match.group(2)) == not_held, f"PS-270-025 not-held list {match.group(2)!r} != table {sorted(not_held)}")
        audit.check(numbers(match.group(3)) == partly, f"PS-270-025 partly list {match.group(3)!r} != table {sorted(partly)}")

    closing = collapse(section(text, "### 18.5 What this document does not close"))
    audit.check(
        "`PS-270-033` axes 3, 4, 5 | **Not operable.**" in closing
        and "Axes 1, 2, 6, and 7 hold today." in closing,
        "§18.5 axis row does not agree with the table",
    )
    own = collapse(section(text, "### 16.1 Mechanical checks this package needs"))
    audit.check(
        "**four hold (1, 2, 6, 7), one partly (4), two not at all (3, 5)**" in own,
        "§16.1 check 9 statement does not agree with the table",
    )


def check_10_no_membership_remedy(audit: Audit, decisions: list[Decision]) -> None:
    """§16.1 check 10: the PS-270-075 remedy set has no membership, role or
    lifecycle action; PS-270-023 item 1 and PS-270-048 reintroduce none; and
    the PS-270-078 out-of-scope answer points at no product surface."""
    audit.begin("check 10")
    by_id = {d.id: d for d in decisions}

    remedies = [r for r in table_rows(by_id["PS-270-075"].body) if len(r) == 3 and r[0].startswith("**")] if "PS-270-075" in by_id else []
    audit.check(len(remedies) == 3, f"PS-270-075 remedy table has {len(remedies)} rows, expected three")
    audit.check(
        "Three remedies survive the absence of the content power" in collapse(by_id["PS-270-075"].body if "PS-270-075" in by_id else ""),
        "PS-270-075 no longer states that three remedies survive",
    )
    hits = [m.group(0) for row in remedies for m in [MEMBERSHIP_REMEDY.search(" | ".join(row))] if m]
    audit.check(not hits, f"PS-270-075 remedy table carries a membership/role/lifecycle action: {hits!r}")

    sites: dict[str, str] = {}
    body = by_id["PS-270-023"].body if "PS-270-023" in by_id else ""
    item = re.search(r"^1\. \*\*What survives the absent content power\.\*\*(.*?)(?=^2\. )", body, re.MULTILINE | re.DOTALL)
    audit.check(item is not None, "PS-270-023 item 1 not found")
    sites["PS-270-023 item 1"] = collapse(item.group(1)) if item else ""
    body = by_id["PS-270-048"].body if "PS-270-048" in by_id else ""
    para = re.search(r"\*\*Told with the remedies, never as a bare refusal\.\*\*(.*?)(?=\n\n)", body, re.DOTALL)
    audit.check(para is not None, "PS-270-048 remedy paragraph not found")
    sites["PS-270-048"] = collapse(para.group(1)) if para else ""
    for label, passage in sites.items():
        for remedy in ("detachment", "preservation", "counsel"):
            audit.check(remedy in passage.lower(), f"{label} no longer restates the {remedy} remedy")
        audit.check(
            re.search(r"no membership, role, or lifecycle action", passage, re.IGNORECASE) is not None
            and "`PS-270-078`" in passage,
            f"{label} does not carry the PS-270-078 negation",
        )
        hits = [
            f"{m.group(0)!r} in {unit[:100]!r}"
            for unit in re.split(r"(?<=[.!?])\s+", passage)
            for m in [MEMBERSHIP_REMEDY.search(unit)]
            if m
        ]
        audit.check(not hits, f"{label} reintroduces a membership/role/lifecycle action: " + "; ".join(hits))

    body = by_id["PS-270-078"].body if "PS-270-078" in by_id else ""
    answer = re.search(r"Where a person asks whether such a power exists,(.*?)(?=\n\n)", body, re.DOTALL)
    audit.check(answer is not None, "PS-270-078 out-of-scope answer not found")
    passage = collapse(answer.group(1)) if answer else ""
    audit.check("out of scope for this process" in passage, "PS-270-078 answer is no longer out-of-scope on the PS-270-064 pattern")
    audit.check("`PS-270-064`" in passage, "PS-270-078 answer does not cite the PS-270-064 pattern")
    hit = SURFACE_POINTER.search(passage)
    audit.check(hit is None, f"PS-270-078 answer points at a product surface: {hit.group(0)!r}" if hit else "")
    hit = MEMBERSHIP_REMEDY.search(passage)
    audit.check(hit is None, f"PS-270-078 answer describes a membership/role/lifecycle action: {hit.group(0)!r}" if hit else "")


def main() -> int:
    # Failure messages quote the document, whose dashes and quotation marks a
    # Windows console's cp1252 pipe cannot encode; same guard as
    # check-doc-encoding.py, so a red run prints its reasons instead of a
    # UnicodeEncodeError.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    audit = Audit()
    audit.begin("structure")
    audit.check((ROOT / DOC).is_file(), f"missing package file: {DOC}")
    if not (ROOT / DOC).is_file():
        return finish(audit)

    text = read(DOC)
    check_markdown_structure(audit, text)
    decisions = split_decisions(audit, text)
    check_1_identifiers(audit, text, decisions)
    check_2_source_lines(audit, decisions)
    check_3_elements(audit, text, decisions)
    check_4_vocabularies(audit, text)
    check_5_prohibited_powers(audit, decisions)
    check_6_conditional_markers(audit, decisions)
    check_7_actioned(audit, text, decisions)
    check_8_surface_stop(audit, text, decisions)
    check_9_axis_arithmetic(audit, text, decisions)
    check_10_no_membership_remedy(audit, decisions)

    return finish(audit)


def finish(audit: Audit) -> int:
    print(f"CBD-270 documentation audit: {audit.checks} checks")
    for label, failed in audit.per_check.items():
        print(f"  {label}: {'FAIL' if failed else 'ok'}" + (f" ({failed})" if failed else ""))
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
