#!/usr/bin/env python3
"""Repeatable structural and boundary audit for the CBD-271 package.

The audit implements the eleven mechanical checks docs/cbd-271-report-and-
detachment-semantics.md lists in its own section 11.3: identifier integrity,
version pins read from CBD-270 rather than retyped, the RI-93-008 boundary as
positive assertions plus a granting-form scan over decision bodies, the
acceptance-criteria mapping against the Jira text as read on September 17,
2026, path completeness, observability assertions, the absence of an invented
retention value, outcome-vocabulary completeness, the revision-history table,
cross-document citation resolution, and Markdown structure. It proves
documentation integrity only; implementation and exercise evidence remain
governed by CBD-272 and CBD-273.

Mirrors the shape of scripts/audit-cbd-233.py: read the document, assert
structure, list failures by identifier, exit 0 on a clean pass.
"""

from __future__ import annotations

import re
import sys
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOC = Path("docs/cbd-271-report-and-detachment-semantics.md")
CBD_270 = Path("docs/cbd-270-platform-safety-operating-model.md")

# Check 4: the five criteria, verbatim from CBD-271 customfield_10066 as read
# on September 17, 2026. The document must quote each one exactly.
EXPECTED_AC_TEXT = {
    "CBD-271-AC01": (
        "The specification states what a report captures, how long it is "
        "retained, who may read it, and that it lives as isolated S3 text under "
        "SR-94-072. (Supports: CBD-131-AC03, AC04)"
    ),
    "CBD-271-AC02": (
        "Detachment semantics state what detaching removes from the subject's "
        "attributed record, what it preserves, and what the author and every "
        "other member see afterwards. (Supports: CBD-131-AC03)"
    ),
    "CBD-271-AC03": (
        "Confidentiality limits and the CBD-91 data-class assignment for report "
        "records are recorded. (Supports: CBD-131-AC04)"
    ),
    "CBD-271-AC04": (
        "The specification states that neither remedy edits or deletes another "
        "author's content, grants any role moderation authority, or changes any "
        "financial state. (Supports: CBD-131-AC03)"
    ),
    "CBD-271-AC05": (
        "The dependency on a shared-comments feature story is recorded and "
        "raised with the Product Owner, and completion records the PR and merge "
        "SHA. (Supports: CBD-131-AC09; CBD-2-AC27)"
    ),
}
EXPECTED_AC = set(EXPECTED_AC_TEXT)
AC_STATUS = re.compile(r"^\*\*Status: (Met in part|Met|Not met)\b", re.MULTILINE)

# Check 3: the RI-93-008 boundary.
POSITIVE_ASSERTIONS = (
    "never edits",
    "never hides",
    "never deletes",
    "never alters authored content",
    "never alters financial state",
    "grants no editorial, moderation, membership, role, or lifecycle power",
)
GRANT_FORMS = (
    "may", "can", "could", "grant", "grants", "granted", "allow", "allows",
    "allowed", "permit", "permits", "permitted", "enable", "enables", "enabled",
    "authorize", "authorizes", "authorized",
)
GRANT_NEGATORS = ("not", "never", "no", "neither", "nothing", "nobody", "none")
POWER_VERBS = (
    "edit", "edits", "edited", "editing",
    "delete", "deletes", "deleted", "deleting", "deletion",
    "hide", "hides", "hid", "hidden", "hiding",
    "moderate", "moderates", "moderated", "moderating", "moderation",
    "alter", "alters", "altered", "altering", "alteration",
)
# A granting form is a hit only when the next word is not a negator; this is a
# literal token rule (the document's check 3 says so), not a sense rule.
GRANT_RE = re.compile(
    r"\b(?:" + "|".join(GRANT_FORMS) + r")\b(?!\s+(?:" + "|".join(GRANT_NEGATORS) + r")\b)",
    re.IGNORECASE,
)
POWER_RE = re.compile(r"\b(?:" + "|".join(POWER_VERBS) + r")\b", re.IGNORECASE)
ALLOWLIST_ROW = re.compile(r'^\s*\|\s*`(PS-271-\d{3})`\s*\|\s*"(.+?)"\s*\|', re.MULTILINE)

# Check 5: the closed path list PS-270-033 axis 6 names.
PATHS = (
    "thread", "cache", "export", "report", "digest", "search index",
    "in-app notification", "email",
)

# Check 6.
OBSERVABILITY = {
    "PS-271-022": ("byte-for-byte", "no notice"),
    "PS-271-015": ("notifies no one",),
    "PS-271-034": ("no author-facing copy",),
}

# Check 7.
DURATION = re.compile(
    r"\b\d+\s*(?:day|days|week|weeks|month|months|year|years)\b", re.IGNORECASE
)

# Check 8: registered in check-doc-vocabulary.py for cbd-270-*.md only, so the
# set is repeated here for this file.
CASE_OUTCOMES = ("Actioned", "No action", "Out of scope", "Escalated", "Withdrawn")

# Check 10: identifier family -> the document that owns it.
FAMILY_OWNER = {
    "PS-270": CBD_270,
    "OQ-270": CBD_270,
    "OP-92": Path("docs/cbd-92-system-flow-technical-threat-model.md"),
    "AN-92": Path("docs/cbd-92-system-flow-technical-threat-model.md"),
    "RL-92": Path("docs/cbd-92-system-flow-technical-threat-model.md"),
    "SA-92": Path("docs/cbd-92-system-flow-technical-threat-model.md"),
    "PA-92": Path("docs/cbd-92-system-flow-technical-threat-model.md"),
    "EM-92": Path("docs/cbd-92-system-flow-technical-threat-model.md"),
    "NT-92": Path("docs/cbd-92-system-flow-technical-threat-model.md"),
    "RF-92": Path("docs/cbd-92-system-flow-technical-threat-model.md"),
    "SG-93": Path("docs/cbd-93-privacy-coercion-abuse-analysis.md"),
    "AB-93": Path("docs/cbd-93-privacy-coercion-abuse-analysis.md"),
    "EG-93": Path("docs/cbd-93-privacy-coercion-abuse-analysis.md"),
    "SR-94": Path("docs/cbd-94-risk-mitigation-requirement-register.md"),
    "RK-94": Path("docs/cbd-94-risk-mitigation-requirement-register.md"),
    "RG-94": Path("docs/cbd-94-risk-mitigation-requirement-register.md"),
    "RI-93": Path("docs/cbd-95-cbd-12-reconciliation-matrix.md"),
    "RC-95": Path("docs/cbd-95-cbd-12-reconciliation-matrix.md"),
    "FU-95": Path("docs/cbd-95-architecture-roadmap-follow-up-register.md"),
    "DI-91": Path("docs/cbd-91-private-mvp-data-inventory.md"),
    "EG-91": Path("docs/cbd-91-private-mvp-data-inventory.md"),
    "DL-76": Path("docs/cbd-76-mvp-boundary-and-readiness-record.md"),
    "INC-76": Path("docs/cbd-76-mvp-boundary-and-readiness-record.md"),
}
CITATION = re.compile(r"\b((?:" + "|".join(FAMILY_OWNER) + r")-\d{3})\b")

DECISION_HEADING = re.compile(r"^`(PS-271-\d{3})` — \*\*", re.MULTILINE)
OQ_ROW = re.compile(r"^\|\s*`(OQ-271-\d{3})`\s*\|", re.MULTILINE)
PS_REF = re.compile(r"\bPS-271-\d{3}\b")
OQ_REF = re.compile(r"\bOQ-271-\d{3}\b")

DOC_PATH_PIN = re.compile(
    r"^\|\s*`(docs/[a-z0-9.\-]+\.md)`\s*\|\s*Document version \*\*([0-9][0-9.]*)\*\*",
    re.MULTILINE,
)
DOC_VERSION = re.compile(r"^\|\s*Document version\s*\|\s*([^|]+?)\s*\|", re.MULTILINE)
LAST_UPDATED = re.compile(r"^\|\s*Last updated\s*\|\s*([^|]+?)\s*\|", re.MULTILINE)
CBD_270_SOURCES = (
    "docs/cbd-91-private-mvp-data-inventory.md",
    "docs/cbd-92-system-flow-technical-threat-model.md",
    "docs/cbd-93-privacy-coercion-abuse-analysis.md",
    "docs/cbd-94-risk-mitigation-requirement-register.md",
    "docs/cbd-94-verification-review-inventory.md",
    "docs/cbd-95-cbd-12-reconciliation-matrix.md",
    "docs/cbd-95-architecture-roadmap-follow-up-register.md",
    "docs/cbd-76-mvp-boundary-and-readiness-record.md",
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


def read(path: Path) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def section(text: str, heading: str) -> str:
    """Return the text from one heading up to (not including) the next
    level-2-through-6 heading."""
    match = re.search(
        rf"^{re.escape(heading)}\n(.*?)(?=^#{{2,6}} |\Z)", text, re.MULTILINE | re.DOTALL
    )
    return match.group(1) if match else ""


def decision_bodies(text: str) -> dict[str, str]:
    """Each PS-271 decision body: from its heading line through the end of its
    **Source** paragraph. The Source paragraph may wrap across lines."""
    bodies: dict[str, str] = {}
    headings = list(DECISION_HEADING.finditer(text))
    for index, match in enumerate(headings):
        start = match.start()
        end = headings[index + 1].start() if index + 1 < len(headings) else len(text)
        chunk = text[start:end]
        source = re.search(r"^\*\*Source:\*\*(?:.*\n)*?.*\.\s*$", chunk, re.MULTILINE)
        bodies[match.group(1)] = chunk[: source.end()] if source else chunk
    return bodies


def units(body: str) -> list[str]:
    """Sentences and table cells with line wrapping collapsed to single
    spaces, as the document's check 3 describes."""
    out: list[str] = []
    paragraph: list[str] = []

    def flush() -> None:
        if paragraph:
            flat = re.sub(r"\s+", " ", " ".join(paragraph)).strip()
            out.extend(s for s in re.split(r"(?<=[.!?])\s+(?=[A-Z`*(\"“])", flat) if s)
            paragraph.clear()

    for line in body.splitlines():
        stripped = line.strip()
        if stripped.startswith("|"):
            flush()
            if re.fullmatch(r"\|[\s:|-]+\|", stripped):
                continue
            out.extend(c.strip() for c in stripped.strip("|").split("|") if c.strip())
        elif not stripped:
            flush()
        else:
            paragraph.append(stripped)
    flush()
    return out


def check_markdown_structure(audit: Audit, text: str, raw: bytes) -> None:
    audit.check(text.startswith("# "), f"{DOC}: missing level-one title")
    audit.check(
        len(re.findall(r"^# ", text, flags=re.MULTILINE)) == 1,
        f"{DOC}: expected exactly one level-one title",
    )
    audit.check(text.count("```") % 2 == 0, f"{DOC}: unbalanced fenced block")
    audit.check(not raw.startswith(b"\xef\xbb\xbf"), f"{DOC}: unexpected UTF-8 BOM")
    audit.check(b"\r" not in raw, f"{DOC}: CRLF line endings; LF is required")
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
    audit.check("| Status | **Draft**" in text, f"{DOC}: status is not Draft")
    headings = re.findall(r"^#{2,6}\s+(.+)$", text, flags=re.MULTILINE)
    duplicates = sorted(h for h, count in Counter(headings).items() if count > 1)
    audit.check(not duplicates, f"{DOC}: duplicate headings: {', '.join(duplicates)}")
    unresolved = sorted(set(re.findall(r"\b(?:TODO|TBD|TBC|FIXME)\b", text, flags=re.I)))
    audit.check(not unresolved, f"{DOC}: unregistered placeholder markers remain")


def check_identifiers(audit: Audit, text: str, bodies: dict[str, str]) -> None:
    defined = list(DECISION_HEADING.findall(text))
    duplicates = sorted(i for i, count in Counter(defined).items() if count > 1)
    audit.check(not duplicates, f"duplicate PS-271 decision headings: {', '.join(duplicates)}")
    numbers = sorted(int(i[-3:]) for i in set(defined))
    audit.check(bool(numbers), f"{DOC}: no PS-271 decisions found")
    if numbers:
        expected = list(range(1, numbers[-1] + 1))
        missing = sorted(set(expected) - set(numbers))
        audit.check(
            not missing,
            "PS-271 numbering is not dense; missing: "
            + ", ".join(f"PS-271-{n:03d}" for n in missing),
        )

    oq_defined = OQ_ROW.findall(section(text, "### 11.1 Open questions this document raises"))
    oq_duplicates = sorted(i for i, count in Counter(oq_defined).items() if count > 1)
    audit.check(not oq_duplicates, f"duplicate OQ-271 rows: {', '.join(oq_duplicates)}")
    audit.check(bool(oq_defined), f"{DOC}: no OQ-271 rows found in section 11.1")

    dangling_ps = sorted(set(PS_REF.findall(text)) - set(defined))
    audit.check(not dangling_ps, f"dangling PS-271 references: {', '.join(dangling_ps)}")
    dangling_oq = sorted(set(OQ_REF.findall(text)) - set(oq_defined))
    audit.check(not dangling_oq, f"dangling OQ-271 references: {', '.join(dangling_oq)}")

    # Referenced at least once outside the defining body / row.
    for identifier, body in bodies.items():
        outside = text.replace(body, "", 1)
        audit.check(
            identifier in outside,
            f"{identifier}: never referenced outside its own decision body",
        )
    oq_section = section(text, "### 11.1 Open questions this document raises")
    for identifier in oq_defined:
        row = next(
            line for line in oq_section.splitlines() if line.startswith(f"| `{identifier}`")
        )
        outside = text.replace(row, "", 1)
        audit.check(identifier in outside, f"{identifier}: never referenced outside its own row")


def check_pins(audit: Audit, text: str) -> None:
    pins = dict(DOC_PATH_PIN.findall(section(text, "### 1.1 Authoritative inputs and pinned versions")))
    audit.check(bool(pins), f"{DOC}: no version pins found in section 1.1")

    cbd_270_path = CBD_270.as_posix()
    live_270 = DOC_VERSION.search(read(CBD_270))
    audit.check(live_270 is not None, f"{CBD_270}: document version not found")
    if live_270:
        audit.check(
            pins.get(cbd_270_path) == live_270.group(1).strip(),
            f"section 1.1 pins {cbd_270_path} at {pins.get(cbd_270_path)}; "
            f"it is version {live_270.group(1).strip()}",
        )

    upstream = dict(DOC_PATH_PIN.findall(section(read(CBD_270), "### 1.1 Authoritative inputs and pinned versions")))
    audit.check(
        set(CBD_270_SOURCES) <= set(upstream),
        "CBD-270 section 1.1 no longer pins every source this audit expects: "
        + ", ".join(sorted(set(CBD_270_SOURCES) - set(upstream))),
    )
    for source in CBD_270_SOURCES:
        audit.check(
            pins.get(source) == upstream.get(source),
            f"section 1.1 pins {source} at {pins.get(source)}; CBD-270 section 1.1 "
            f"pins it at {upstream.get(source)}",
        )
        live = DOC_VERSION.search(read(Path(source))) if (ROOT / source).is_file() else None
        audit.check(
            live is not None and pins.get(source) == live.group(1).strip(),
            f"section 1.1 pins {source} at {pins.get(source)}; "
            f"it is version {live.group(1).strip() if live else 'unknown'}",
        )


def check_boundary(audit: Audit, text: str, bodies: dict[str, str]) -> None:
    body_001 = re.sub(r"\s+", " ", bodies.get("PS-271-001", ""))
    for phrase in POSITIVE_ASSERTIONS:
        audit.check(phrase in body_001, f'PS-271-001 must contain "{phrase}" verbatim')

    check_block = section(text, "### 11.3 Mechanical checks this package needs")
    allowlist = ALLOWLIST_ROW.findall(check_block)
    for identifier, quoted in allowlist:
        flat = re.sub(r"\s+", " ", bodies.get(identifier, ""))
        audit.check(
            quoted in flat,
            f'check 3 allowlist row for {identifier} quotes a string that no longer '
            f'appears in it: "{quoted}"',
        )

    for identifier, body in bodies.items():
        for unit in units(body):
            if not (GRANT_RE.search(unit) and POWER_RE.search(unit)):
                continue
            exempt = any(i == identifier and q in unit for i, q in allowlist)
            audit.check(
                exempt,
                f"{identifier}: pairs a granting form with a content-power verb and "
                f'carries no allowlist entry: "{unit}"',
            )


def check_ac_mapping(audit: Audit, text: str, defined: set[str]) -> None:
    quoted = section(text, "### 1.2 What CBD-270 delegates here, and the Jira criteria that bind")
    for identifier, expected in EXPECTED_AC_TEXT.items():
        audit.check(
            f"| `{identifier}` | {expected} |" in quoted,
            f"section 1.2 does not quote {identifier} verbatim as read from Jira",
        )

    block = section(text, "## 13. Acceptance-criteria check")
    # section() stops at the first sub-heading; take the whole of section 13.
    match = re.search(r"^## 13\. Acceptance-criteria check\n(.*?)(?=^## 14\. |\Z)", text, re.MULTILINE | re.DOTALL)
    block = match.group(1) if match else block
    subsections = re.findall(r"^### 13\.(\d) `(CBD-271-AC\d{2})`", block, re.MULTILINE)
    audit.check(
        [ac for _, ac in subsections] == sorted(EXPECTED_AC),
        "section 13 must have exactly one subsection per criterion, AC01..AC05 in order; found: "
        + ", ".join(ac for _, ac in subsections),
    )
    audit.check(
        [int(n) for n, _ in subsections] == list(range(1, len(EXPECTED_AC) + 1)),
        "section 13 subsections are not numbered 13.1 through 13.5 in order",
    )
    for number, ac in subsections:
        sub = section(block, next(
            line for line in block.splitlines() if line.startswith(f"### 13.{number} `{ac}`")
        ))
        audit.check(bool(AC_STATUS.search(sub)), f"{ac}: section 13.{number} lacks a Status line of Met / Met in part / Not met")
        cited = set(PS_REF.findall(sub))
        audit.check(bool(cited) and cited <= defined, f"{ac}: section 13.{number} cites no resolving PS-271 decision")


def check_paths(audit: Audit, bodies: dict[str, str]) -> None:
    for identifier in ("PS-271-020", "PS-271-022"):
        flat = re.sub(r"\s+", " ", bodies.get(identifier, "")).lower()
        missing = [p for p in PATHS if p not in flat]
        audit.check(not missing, f"{identifier}: does not name every path: {', '.join(missing)}")


def check_observability(audit: Audit, bodies: dict[str, str]) -> None:
    for identifier, phrases in OBSERVABILITY.items():
        flat = re.sub(r"\s+", " ", bodies.get(identifier, ""))
        for phrase in phrases:
            audit.check(phrase in flat, f'{identifier} must contain "{phrase}"')


def check_no_retention_value(audit: Audit, bodies: dict[str, str]) -> None:
    hits = DURATION.findall(bodies.get("PS-271-014", ""))
    audit.check(not hits, f"PS-271-014 states a retention duration: {', '.join(hits)}")


def check_outcome_vocabulary(audit: Audit, text: str) -> None:
    flat = re.sub(r"\s+", " ", text)
    members = [re.escape(m) for m in CASE_OUTCOMES]
    joined = r"`?(?:" + "|".join(members) + r")`?"
    pattern = re.compile(joined + r"(?:\s*,\s*(?:and\s+|or\s+)?" + joined + r")+")
    enumerations = pattern.findall(flat)
    audit.check(bool(enumerations), f"{DOC}: the platform-safety-case-outcome set is never enumerated")
    for found in enumerations:
        missing = [m for m in CASE_OUTCOMES if m not in found]
        audit.check(not missing, f"incomplete platform-safety-case-outcome enumeration: \"{found}\" lacks {', '.join(missing)}")


def check_revision_history(audit: Audit, text: str) -> None:
    headings = re.findall(r"^## (.+)$", text, flags=re.MULTILINE)
    audit.check(headings and headings[-1] == "14. Revision history", f"{DOC}: section 14 Revision history is not the last section")
    block = section(text, "## 14. Revision history")
    audit.check("| Version | Date | Author | Change | Status |" in block, "section 14: revision table columns are not Version, Date, Author, Change, Status")
    rows = [line for line in block.splitlines() if line.startswith("| ") and not line.startswith("| Version") and not line.startswith("| ---")]
    audit.check(bool(rows), "section 14: no revision rows")
    version = DOC_VERSION.search(text)
    updated = LAST_UPDATED.search(text)
    if rows and version and updated:
        cells = [c.strip() for c in rows[0].strip("|").split("|")]
        audit.check(cells[0] == version.group(1).strip(), f"section 14 top row version {cells[0]} differs from header Document version {version.group(1).strip()}")
        audit.check(cells[1] == updated.group(1).strip(), f"section 14 top row date {cells[1]} differs from header Last updated {updated.group(1).strip()}")


def check_citations(audit: Audit, text: str) -> None:
    cited = sorted(set(CITATION.findall(text)))
    owners: dict[Path, str] = {}
    for identifier in cited:
        family = identifier.rsplit("-", 1)[0]
        owner = FAMILY_OWNER[family]
        if owner not in owners:
            owners[owner] = read(owner) if (ROOT / owner).is_file() else ""
        audit.check(
            re.search(rf"\b{re.escape(identifier)}\b", owners[owner]) is not None,
            f"{identifier} does not resolve in {owner.as_posix()}",
        )


def main() -> int:
    audit = Audit()
    audit.check((ROOT / DOC).is_file(), f"missing package file: {DOC}")
    audit.check((ROOT / CBD_270).is_file(), f"missing companion file: {CBD_270}")
    if not (ROOT / DOC).is_file() or not (ROOT / CBD_270).is_file():
        return finish(audit)

    raw = (ROOT / DOC).read_bytes()
    text = raw.decode("utf-8")
    bodies = decision_bodies(text)

    check_markdown_structure(audit, text, raw)
    check_identifiers(audit, text, bodies)
    check_pins(audit, text)
    check_boundary(audit, text, bodies)
    check_ac_mapping(audit, text, set(bodies))
    check_paths(audit, bodies)
    check_observability(audit, bodies)
    check_no_retention_value(audit, bodies)
    check_outcome_vocabulary(audit, text)
    check_revision_history(audit, text)
    check_citations(audit, text)

    return finish(audit)


def finish(audit: Audit) -> int:
    print(f"CBD-271 documentation audit: {audit.checks} checks")
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
