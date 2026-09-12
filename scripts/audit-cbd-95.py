#!/usr/bin/env python3
"""Repeatable mechanical audit for the CBD-95 documentation package.

This script deliberately checks documentation structure and traceability only.
It does not execute the CBD-94 verification inventory or prove that any runtime
control is implemented, effective, compliant, or secure.
"""

from __future__ import annotations

import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]

PACKAGE_FILES = (
    Path("docs/cbd-95-execution-plan.md"),
    Path("docs/cbd-95-threat-model-package-manifest.md"),
    Path("docs/cbd-95-cbd-12-reconciliation-matrix.md"),
    Path("docs/cbd-95-architecture-roadmap-follow-up-register.md"),
    Path("docs/cbd-95-acceptance-criteria-traceability.md"),
    Path("scripts/audit-cbd-95.py"),
)

# These blobs were frozen from `origin/main` at 43e87be on August 16, 2026.
# Blob identity, not commit identity, is the integrity control: it proves the
# exact authority sources are unchanged while allowing `main` to advance with
# unrelated work, including the merge of this package itself.
FROZEN_BLOBS = {
    # Re-frozen September 3, 2026 at CBD-91 v1.0.2, which records the
    # CR-91-003/CR-91-004 source corrections.  CBD-95 counts no CBD-91
    # identifier that changed: DI, DF, and EG family membership is untouched.
    Path("docs/cbd-91-private-mvp-data-inventory.md"): (
        "5e3b1255fa6f6c020a54869cf22828a27792e04d"
    ),
    Path("docs/cbd-92-system-flow-technical-threat-model.md"): (
        "2417cea6cbd47cb98fe9b44ca8e926781c3bdcfd"
    ),
    Path("docs/cbd-92-acceptance-criteria-traceability.md"): (
        "6938bbb0ca8eafad11b4712f1b3d35da432723af"
    ),
    Path("docs/cbd-93-privacy-coercion-abuse-analysis.md"): (
        # Re-frozen September 12, 2026 at CBD-93 v1.1.2 (editorial): the §12
        # sentence that still called joint-account projection a §13 gap was
        # corrected to cite §4.12. No normative content changed.
        "62527c870bb2d1c2bb39b211f46bd6b7c8a2e8a0"
    ),
    # Re-frozen September 3, 2026 at CBD-94 v1.0.1.  The RK, SR, and RG family
    # counts this audit enforces are unchanged; only two section 8 rows and the
    # CBD-91 source pin moved.
    Path("docs/cbd-94-risk-mitigation-requirement-register.md"): (
        "ce6b3e105aff7f120eb670d3685c787082911516"
    ),
    Path("docs/cbd-94-verification-review-inventory.md"): (
        "e139cdd75646f8070b8e253ff6cc95c1f6bca966"
    ),
    Path("docs/cbd-94-acceptance-criteria-traceability.md"): (
        # Re-frozen at CBD-94 v1.0.2, which added the missing
        # OP-92-004/OP-92-006 separation-of-duties acceptance criterion and
        # renumbered release gates. Evidence and labelling only; no route,
        # requirement, or gate changed. See manifest section 6.
        "ff70668fbeb3ddea2a843a3c11fb0024e8bf3957"
    ),
    Path("docs/cbd-94-exhaustive-review-findings.md"): (
        "c7c02611b7b2c6cfc78ed5467e013b615128b8c6"
    ),
    # The three CBD-72 pins below went stale on August 18, 2026, when the
    # CBD-72 package was approved -- two days after this freeze was taken at
    # 43e87be -- and again on September 2 for the permission model.  Nothing
    # caught it because this audit was never wired into CI; that is fixed in
    # the same change that re-freezes these.  Each drift was checked rather
    # than assumed benign:
    #
    #   permission model  v0.1.52 -> v0.1.54.  Approval, plus the section 5.4
    #                     amendment that removed the member-configurable
    #                     "privacy" detail.  That narrows what a member may
    #                     set, so it reinforces the CBD-95 citations rather
    #                     than contradicting them.
    #   scenario catalog  v0.1.13 -> v0.1.14.  Approval, plus routing
    #                     deterministic fixtures to VT-94-*.  Its own revision
    #                     row states no scenario rule changed.
    #   traceability      v0.1.12 -> v0.1.13.  Approval; gate results moved
    #                     from pending to Pass.  No rule changed.
    #
    # CBD-72 is a context freeze here, not a source family: SOURCE_FAMILIES
    # counts no CBD-72 identifier, so none of this moves a CBD-95 total.
    Path("docs/cbd-72-collaboration-permission-model.md"): (
        "f1842e5d020e7781c6808730ae4df43faedaaabd"
    ),
    Path("docs/cbd-72-authorization-scenario-catalog.md"): (
        "2c6030df745adf1e1b6a812d3a0afbd4985ba7a0"
    ),
    Path("docs/cbd-72-acceptance-criteria-traceability.md"): (
        "ce7cdc70399e2fbf7df276eb7189760c8a3aac20"
    ),
}

SOURCE_FAMILIES = {
    ("DI", 91): (Path("docs/cbd-91-private-mvp-data-inventory.md"), 76),
    ("DF", 91): (Path("docs/cbd-91-private-mvp-data-inventory.md"), 13),
    ("EG", 91): (Path("docs/cbd-91-private-mvp-data-inventory.md"), 24),
    ("TH", 92): (Path("docs/cbd-92-system-flow-technical-threat-model.md"), 45),
    ("RF", 92): (Path("docs/cbd-92-system-flow-technical-threat-model.md"), 12),
    ("AB", 93): (Path("docs/cbd-93-privacy-coercion-abuse-analysis.md"), 86),
    ("SG", 93): (Path("docs/cbd-93-privacy-coercion-abuse-analysis.md"), 97),
    ("EG", 93): (Path("docs/cbd-93-privacy-coercion-abuse-analysis.md"), 10),
    ("RI", 93): (Path("docs/cbd-93-privacy-coercion-abuse-analysis.md"), 19),
    ("RK", 94): (
        Path("docs/cbd-94-risk-mitigation-requirement-register.md"),
        21,
    ),
    ("SR", 94): (
        Path("docs/cbd-94-risk-mitigation-requirement-register.md"),
        147,
    ),
    ("RG", 94): (
        Path("docs/cbd-94-risk-mitigation-requirement-register.md"),
        16,
    ),
    ("VT", 94): (Path("docs/cbd-94-verification-review-inventory.md"), 270),
    ("ME", 94): (Path("docs/cbd-94-verification-review-inventory.md"), 15),
    ("SRV", 94): (Path("docs/cbd-94-verification-review-inventory.md"), 15),
    ("FX", 94): (Path("docs/cbd-94-verification-review-inventory.md"), 10),
    ("PR", 94): (Path("docs/cbd-94-verification-review-inventory.md"), 5),
    ("MON", 94): (Path("docs/cbd-94-verification-review-inventory.md"), 10),
}

REQUIRED_AREAS = (
    "Permissions",
    "Resource visibility",
    "Invitation and consent",
    "Role changes and ownership transfer",
    "Revocation, removal, and stale access",
    "Authentication assurance and sessions",
    "Alerts and acknowledgements",
    "Notification channels and previews",
    "Masking, derived data, search, reports, and inference",
    "Audit evidence",
    "Exports and downloaded custody",
    "Archival, deletion, restoration, and personal-account lifecycle",
    "Recovery, backups, secrets, and exceptional access",
    "Cross-budget isolation and correlation",
)

PERMITTED_OUTCOMES = {
    "Pass unchanged",
    "Pass with mitigation",
    "Blocked pending decision/evidence",
    "Out of CBD-14 scope",
}

REQUIRED_HEADINGS = {
    Path("docs/cbd-95-threat-model-package-manifest.md"): (
        "## 2. Frozen repository package",
        "## 3. Stable identifier inventory",
        "## 5. Package-wide invariants",
        "## 7. Evidence and limitation statement",
        "## 8. Change control and supersession",
    ),
    Path("docs/cbd-95-cbd-12-reconciliation-matrix.md"): (
        "## 2. Required-area coverage",
        "## 3. CBD-12 acceptance-criterion reconciliation",
        "## 4. Product Owner decision register",
        "## 5. Material conflicts and synchronization blockers",
        "## 7. Readiness recommendation",
    ),
    Path("docs/cbd-95-architecture-roadmap-follow-up-register.md"): (
        "## 3. Follow-up register",
        "## 4. Architecture workstreams and security boundaries",
        "## 5. Sequencing and dependency roadmap",
        "## 6. Product decisions requiring attention",
        "## 7. Release and completion rules",
    ),
    Path("docs/cbd-95-acceptance-criteria-traceability.md"): (
        "## 3. Deliverable traceability",
        "## 4. CBD-95 acceptance-criteria traceability",
        "## 5. CBD-14 acceptance-criteria traceability",
        "## 6. Bidirectional identifier and audit contract",
        "## 8. Review findings",
        "## 9. Evidence limitations",
        "## 10. Readiness recommendation",
        "## 11. Final approval evidence",
        "## 12. Change control",
    ),
}


@dataclass
class Audit:
    checks: int = 0
    failures: list[str] | None = None
    warnings: list[str] | None = None

    def __post_init__(self) -> None:
        self.failures = []
        self.warnings = []

    def check(self, condition: bool, message: str) -> None:
        self.checks += 1
        if not condition:
            assert self.failures is not None
            self.failures.append(message)

    def warn(self, condition: bool, message: str) -> None:
        if not condition:
            assert self.warnings is not None
            self.warnings.append(message)


def read(path: Path) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def git(*args: str) -> str:
    completed = subprocess.run(
        ["git", *args],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if completed.returncode != 0:
        detail = completed.stderr.strip() or completed.stdout.strip()
        raise RuntimeError(f"git {' '.join(args)} failed: {detail}")
    # Only trailing whitespace: `status --porcelain` encodes worktree-only
    # changes as a leading space (" M path"), which strip() would consume,
    # shifting the first line's path by one character.
    return completed.stdout.rstrip()


def expand_ids(text: str, prefix: str, issue: int) -> set[int]:
    """Expand individual, shortened range, and shortened slash ID syntax."""

    base = rf"{re.escape(prefix)}-{issue}-"
    values = {int(value) for value in re.findall(base + r"(\d{3})", text)}

    range_pattern = re.compile(
        base
        + r"(\d{3})\s*(?:\u2013|\u2014|\bthrough\b|\bto\b)\s*"
        + rf"(?:{re.escape(prefix)}-{issue}-)?(\d{{3}})",
        flags=re.IGNORECASE,
    )
    for start_text, end_text in range_pattern.findall(text):
        start, end = int(start_text), int(end_text)
        if start <= end:
            values.update(range(start, end + 1))

    slash_pattern = re.compile(base + r"(\d{3}(?:/\d{3})+)")
    for group in slash_pattern.findall(text):
        values.update(int(value) for value in group.split("/"))

    return values


def table_id_rows(text: str, prefix: str) -> list[tuple[int, list[str], int]]:
    rows: list[tuple[int, list[str], int]] = []
    pattern = re.compile(rf"^\|\s*(?:\*\*)?`?{re.escape(prefix)}-(\d{{3}})`?(?:\*\*)?\s*\|")
    for line_number, line in enumerate(text.splitlines(), start=1):
        match = pattern.match(line)
        if not match:
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        rows.append((int(match.group(1)), cells, line_number))
    return rows


def check_exact_numbers(
    audit: Audit, label: str, actual: set[int], expected: set[int]
) -> None:
    missing = sorted(expected - actual)
    extra = sorted(actual - expected)
    audit.check(
        actual == expected,
        f"{label}: expected exact set; missing={missing}, extra={extra}",
    )


def check_markdown_tables(audit: Audit, path: Path, text: str) -> None:
    current_width: int | None = None
    current_start = 0
    for line_number, line in enumerate(text.splitlines(), start=1):
        if line.startswith("|") and line.endswith("|"):
            width = len(re.findall(r"(?<!\\)\|", line)) - 1
            if current_width is None:
                current_width = width
                current_start = line_number
            else:
                audit.check(
                    width == current_width,
                    f"{path}:{line_number}: table width {width} differs from "
                    f"width {current_width} at line {current_start}",
                )
        else:
            current_width = None


def check_local_references(audit: Audit, text_by_path: dict[Path, str]) -> None:
    reference_pattern = re.compile(r"`((?:docs|scripts)/[^`\s]+)`")
    for source, text in text_by_path.items():
        for target_text in reference_pattern.findall(text):
            target_text = target_text.rstrip(".,;:)")
            target = Path(target_text)
            audit.check(
                (ROOT / target).exists(),
                f"{source}: referenced local path does not exist: {target}",
            )


def check_cbd95_citations(
    audit: Audit, text_by_path: dict[Path, str], defined: dict[str, set[int]]
) -> None:
    """Every CBD-95 id cited anywhere must resolve to a defined row.

    The set checks prove the defining tables are complete; this proves no
    document points at a row that was renumbered away or never existed.
    """
    for prefix, valid in defined.items():
        for path, text in text_by_path.items():
            unknown = sorted(expand_ids(text, prefix, 95) - valid)
            audit.check(
                not unknown,
                f"{path}: cites undefined {prefix}-95 ids: {unknown}",
            )


def check_unsupported_claims(audit: Audit, text_by_path: dict[Path, str]) -> None:
    claim_patterns = (
        r"guaranteed (?:secure|safe|private)",
        r"100% secure",
        r"completely anonymous",
        r"fully anonymous",
        r"(?:product|system|implementation) is proven secure",
        r"proves? (?:that )?(?:the )?(?:product|system|implementation) is secure",
        r"all (?:data|copies) (?:is|are|have been) deleted everywhere",
        r"certified compliant",
    )
    negative_markers = (
        "not ",
        "never ",
        "cannot ",
        "does not ",
        "do not ",
        "must not ",
        "without ",
        "prohibit",
    )
    for path, text in text_by_path.items():
        if path.suffix != ".md":
            continue
        lower = text.lower()
        for pattern in claim_patterns:
            for match in re.finditer(pattern, lower):
                context = lower[max(0, match.start() - 100) : match.start()]
                audit.check(
                    any(marker in context for marker in negative_markers),
                    f"{path}: unsupported assertive claim near {match.group(0)!r}",
                )


# Statements the traceability record makes *about* the package, which earlier
# revisions restated by hand and let drift away from the artifacts they
# summarize. Each pattern must match exactly once so a reworded section fails
# loudly instead of silently dropping out of the guard.
STATED_TOTAL_PATTERNS = (
    ("audit result block", r"CBD-95 AUDIT PASS: (\d[\d,]*) checks"),
    ("CBD-95-AC02", r"rather than asserted: (\d[\d,]*) checks"),
    ("final approval evidence", r"Python 3\.\d+\.\d+: (\d[\d,]*) checks"),
)


def check_documented_tally(
    audit: Audit, trace: str, outcome_counts: dict[str, int]
) -> None:
    """The record's prose must agree with the matrix it summarizes."""
    match = re.search(
        r"(\d+) Pass unchanged, (\d+) Pass with mitigation, "
        r"(\d+) Blocked, (\d+) Out of scope",
        trace,
    )
    audit.check(
        match is not None,
        "traceability record states no CBD-12 reconciliation tally",
    )
    if match is None:
        return
    stated = tuple(int(value) for value in match.groups())
    actual = (
        outcome_counts["Pass unchanged"],
        outcome_counts["Pass with mitigation"],
        outcome_counts["Blocked pending decision/evidence"],
        outcome_counts["Out of CBD-14 scope"],
    )
    audit.check(
        stated == actual,
        f"traceability tally {stated} disagrees with the matrix outcome "
        f"totals {actual} (unchanged/mitigation/blocked/out-of-scope)",
    )


def check_documented_totals(audit: Audit, trace: str) -> int | None:
    """Every stated check total must be the same number.

    The totals are restated in three places. Comparing them to each other is
    stable regardless of what the current run counts, and it is the exact
    defect that reached an approved revision: three statements, three numbers.
    """
    totals: dict[str, int] = {}
    for label, pattern in STATED_TOTAL_PATTERNS:
        found = re.findall(pattern, trace)
        audit.check(
            len(found) == 1,
            f"expected exactly one stated check total for {label}, found {len(found)}",
        )
        if len(found) == 1:
            totals[label] = int(found[0].replace(",", ""))
    if len(totals) != len(STATED_TOTAL_PATTERNS):
        return None
    distinct = set(totals.values())
    audit.check(
        len(distinct) == 1,
        f"stated check totals disagree: {totals}",
    )
    return next(iter(distinct)) if len(distinct) == 1 else None


def main() -> int:
    audit = Audit()

    for path in PACKAGE_FILES:
        audit.check((ROOT / path).is_file(), f"required package file missing: {path}")
    if audit.failures:
        for failure in audit.failures:
            print(f"FAIL {failure}")
        return 1

    text_by_path = {path: read(path) for path in PACKAGE_FILES}

    # Repository and scope controls.
    audit.check(Path(git("rev-parse", "--show-toplevel")) == ROOT, "script is not running in the expected repository root")
    # A registered document cannot change without its approved_sha256 changing
    # in the same commit -- policy: approved fails the publication contract as
    # unapproved-source-content the moment hash and body disagree -- so the
    # manifest is a mandatory consequence of package work, not an escape from
    # its scope. Nothing else outside PACKAGE_FILES is permitted.
    allowed_changes = {str(path).replace("\\", "/") for path in PACKAGE_FILES}
    allowed_changes.add("config/confluence-publication.json")
    status_lines = git("status", "--porcelain", "--untracked-files=all").splitlines()
    changed_paths: set[str] = set()
    for line in status_lines:
        if not line:
            continue
        raw_path = line[3:]
        if " -> " in raw_path:
            raw_path = raw_path.split(" -> ", 1)[1]
        changed_paths.add(raw_path.strip('"').replace("\\", "/"))
    # The rule is that CBD-95 work touches only CBD-95 files, so it has nothing
    # to say about a tree holding no CBD-95 change at all. Applying it there
    # failed the audit for any unrelated edit, which made `npm run gate` unusable
    # until the tree was committed -- CI never saw it, because CI checks out
    # clean. Enforce it when the package is actually being modified.
    touches_package = bool(changed_paths & allowed_changes)
    audit.check(
        not touches_package or changed_paths <= allowed_changes,
        f"CBD-95 package files are being changed alongside out-of-scope changes: "
        f"{sorted(changed_paths - allowed_changes)}",
    )

    # Frozen source hashes.
    for path, expected_blob in FROZEN_BLOBS.items():
        audit.check((ROOT / path).is_file(), f"frozen source file missing: {path}")
        if (ROOT / path).is_file():
            actual_blob = git("hash-object", str(path))
            audit.check(
                actual_blob == expected_blob,
                f"{path}: blob {actual_blob} does not match {expected_blob}",
            )

    # Stable upstream identifier sets.
    for (prefix, issue), (path, maximum) in SOURCE_FAMILIES.items():
        actual = expand_ids(read(path), prefix, issue)
        expected = set(range(1, maximum + 1))
        check_exact_numbers(audit, f"{prefix}-{issue}", actual, expected)

    approved_routes = read(Path("docs/cbd-94-acceptance-criteria-traceability.md"))
    # The traceability record routes CBD-95 outcomes to these families
    # transitively through CBD-94. Every family it leans on is checked here, so
    # a later CBD-94 revision cannot silently drop a leg while CBD-95 stays
    # green.
    for prefix, issue, maximum in (
        ("TH", 92, 45),
        ("AB", 93, 86),
        ("SG", 93, 97),
        ("RK", 94, 21),
        ("SR", 94, 147),
        ("VT", 94, 270),
        ("ME", 94, 15),
        ("SRV", 94, 15),
        ("FX", 94, 10),
        ("PR", 94, 5),
        ("MON", 94, 10),
        ("RG", 94, 16),
    ):
        check_exact_numbers(
            audit,
            f"approved reverse routes for {prefix}-{issue}",
            expand_ids(approved_routes, prefix, issue),
            set(range(1, maximum + 1)),
        )

    cbd93 = read(Path("docs/cbd-93-privacy-coercion-abuse-analysis.md"))
    retired_context = re.search(
        r"(?:SG-93-020.{0,180}retir|retir.{0,180}SG-93-020)",
        cbd93,
        flags=re.IGNORECASE | re.DOTALL,
    )
    audit.check(retired_context is not None, "SG-93-020 is not visibly marked retired")
    active_sg = expand_ids(cbd93, "SG", 93) - {20}
    audit.check(len(active_sg) == 96, f"active SG-93 count is {len(active_sg)}, expected 96")

    # CBD-95 row sets, uniqueness, schema, and outcomes.
    matrix_path = Path("docs/cbd-95-cbd-12-reconciliation-matrix.md")
    register_path = Path("docs/cbd-95-architecture-roadmap-follow-up-register.md")
    trace_path = Path("docs/cbd-95-acceptance-criteria-traceability.md")
    matrix = text_by_path[matrix_path]
    register = text_by_path[register_path]
    trace = text_by_path[trace_path]

    rc_rows = table_id_rows(matrix, "RC-95")
    fu_rows = table_id_rows(register, "FU-95")
    rv_rows = table_id_rows(matrix, "RV-95")
    ri_rows = table_id_rows(matrix, "RI-93")

    for label, rows, maximum in (
        ("RC-95", rc_rows, 36),
        ("FU-95", fu_rows, 30),
        ("RV-95", rv_rows, 8),
        ("RI-93 decision register", ri_rows, 19),
    ):
        numbers = [number for number, _, _ in rows]
        check_exact_numbers(audit, label, set(numbers), set(range(1, maximum + 1)))
        audit.check(
            len(numbers) == len(set(numbers)),
            f"{label}: duplicate authoritative table row definitions found",
        )

    defined_fu = {number for number, _, _ in fu_rows}

    rc_ac_numbers: set[int] = set()
    outcome_counts = {outcome: 0 for outcome in PERMITTED_OUTCOMES}
    for number, cells, line_number in rc_rows:
        audit.check(
            len(cells) == 6,
            f"{matrix_path}:{line_number}: RC-95 row must have 6 cells, found {len(cells)}",
        )
        if len(cells) != 6:
            continue
        ac_match = re.search(r"\bAC(\d{2})\b", cells[1])
        audit.check(ac_match is not None, f"{matrix_path}:{line_number}: missing CBD-12 AC number")
        if ac_match:
            ac_number = int(ac_match.group(1))
            rc_ac_numbers.add(ac_number)
            audit.check(
                ac_number == number,
                f"{matrix_path}:{line_number}: RC-95-{number:03d} maps AC{ac_number:02d}",
            )
        normalized_outcome = re.sub(r"[*_`]", "", cells[3]).strip()
        audit.check(
            normalized_outcome in PERMITTED_OUTCOMES,
            f"{matrix_path}:{line_number}: invalid outcome {normalized_outcome!r}",
        )
        if normalized_outcome in outcome_counts:
            outcome_counts[normalized_outcome] += 1
        audit.check(
            bool(re.search(r"(?:RK|SR|VT|NT|EM|PA)-\d{2}-", cells[2]))
            or "All `RK-94" in cells[2],
            f"{matrix_path}:{line_number}: no upstream evidence route",
        )
        audit.check(
            len(re.sub(r"[*_`]", "", cells[4]).strip()) >= 40,
            f"{matrix_path}:{line_number}: required action/effect is not substantive",
        )
        # Execution plan section 5.2: every row names the follow-up record
        # through which its remaining work closes.
        routed = expand_ids(cells[5], "FU", 95)
        audit.check(
            bool(routed) and routed <= defined_fu,
            f"{matrix_path}:{line_number}: follow-up route is empty or cites "
            f"undefined ids: {sorted(routed - defined_fu)}",
        )

    check_exact_numbers(audit, "CBD-12 AC", rc_ac_numbers, set(range(1, 37)))
    audit.check(outcome_counts["Pass unchanged"] == 2, "RC outcome total for Pass unchanged must be 2")
    audit.check(outcome_counts["Pass with mitigation"] == 34, "RC outcome total for Pass with mitigation must be 34")
    audit.check(outcome_counts["Blocked pending decision/evidence"] == 0, "RC blocked outcome total must be 0")
    audit.check(outcome_counts["Out of CBD-14 scope"] == 0, "RC out-of-scope outcome total must be 0")
    check_documented_tally(audit, trace, outcome_counts)

    for area in REQUIRED_AREAS:
        audit.check(
            re.search(rf"^\| {re.escape(area)} \|", matrix, flags=re.MULTILINE) is not None,
            f"required CBD-95 area missing from coverage table: {area}",
        )

    for number, cells, line_number in fu_rows:
        audit.check(
            len(cells) == 7,
            f"{register_path}:{line_number}: FU-95 row must have 7 cells, found {len(cells)}",
        )
        if len(cells) == 7:
            audit.check(cells[1] in {"P0", "P1", "P2", "P3"}, f"{register_path}:{line_number}: invalid priority")
            audit.check(len(cells[4]) >= 40, f"{register_path}:{line_number}: required work is not substantive")
            audit.check(len(cells[5]) >= 25, f"{register_path}:{line_number}: closure evidence is not substantive")
            audit.check(len(cells[6]) >= 20, f"{register_path}:{line_number}: open effect is not substantive")

    decided_ri = {
        number
        for number, cells, _ in ri_rows
        if len(cells) == 4 and re.search(r"\*\*Decided", cells[3])
    }
    audit.check(
        decided_ri == set(range(1, 20)),
        f"decided RI set is {sorted(decided_ri)}, expected 1 through 19",
    )
    decided_ri_010_markers = (
        "**Decided August 16, 2026 — add three bounded protections.**",
        "**A — block:**",
        "**B — decline choice:**",
        "Create no separate persistent-decline state",
        "**C — rate limit:**",
        "create no recipient-wide quota",
    )
    for marker in decided_ri_010_markers:
        audit.check(
            marker in matrix,
            f"matrix does not preserve the RI-93-010 decision marker: {marker}",
        )
    decided_ri_011_markers = (
        "**Decided August 16, 2026 — add a verified notification-only destination.**",
        "only after successful destination verification and atomic membership acceptance",
        "The invited channel remains invitation proof only",
        "the inviter cannot view the destination",
        "Failed, abandoned, replayed, or stale verification activates nothing",
    )
    for marker in decided_ri_011_markers:
        audit.check(
            marker in matrix,
            f"matrix does not preserve the RI-93-011 decision marker: {marker}",
        )
    decided_ri_012_markers = (
        "**Decided August 16, 2026 — add strict safety-channel routing.**",
        "mandatory authenticated in-app instance",
        "do not fall back to ordinary alert channels or other external destinations",
        "Other members cannot view, select, change, or infer the safety destination",
        "supersedes CBD-72 §6.3/CBD-91 §7.3",
    )
    for marker in decided_ri_012_markers:
        audit.check(
            marker in matrix,
            f"matrix does not preserve the RI-93-012 decision marker: {marker}",
        )
    decided_ri_013_markers = (
        "**Decided August 16, 2026 — add fail-closed atomic retirement.**",
        "Immediately quarantine it from new/queued notification and lifecycle delivery",
        "quarantine that authority immediately",
        "The compromised channel cannot approve retirement, replacement, reactivation, or recovery",
        "ordinary support cannot bypass it",
    )
    for marker in decided_ri_013_markers:
        audit.check(
            marker in matrix,
            f"matrix does not preserve the RI-93-013 decision marker: {marker}",
        )
    decided_ri_014_markers = (
        "**Decided August 16, 2026 — retain current eligibility with non-blaming copy.**",
        "Accountability Partners remain eligible",
        "Viewers remain categorically ineligible",
        "never label or imply that an identified person caused, owns, or must correct",
        "Actor attribution is excluded from the alert",
        "remains explicit and unaccepted",
    )
    for marker in decided_ri_014_markers:
        audit.check(
            marker in matrix,
            f"matrix does not preserve the RI-93-014 decision marker: {marker}",
        )
    decided_ri_015_markers = (
        "**Decided August 16, 2026 — adopt a tiered transparent semantic contract.**",
        "plain-language before/after role, profile, or scope class",
        "what access/state remains",
        "Actor identity appears only where already allowed",
        "without a last-activity date, precise inactivity interval, countdown",
        "all detail stays authenticated in-app",
    )
    for marker in decided_ri_015_markers:
        audit.check(
            marker in matrix,
            f"matrix does not preserve the RI-93-015 decision marker: {marker}",
        )
    decided_ri_016_markers = (
        "**Decided August 16, 2026 — adopt a normative cross-cutting semantic standard.**",
        "completed reauthentication or recorded consent is not proof of free or voluntary agreement",
        "control of a channel is not sole control",
        "delivered notification, downloaded package, screenshot, printout",
        "must not characterize another person's circumstances",
        "must not imply authority, accountability, safety, confidentiality",
        "Irreversible consequences are disclosed before",
    )
    for marker in decided_ri_016_markers:
        audit.check(
            marker in matrix,
            f"matrix does not preserve the RI-93-016 decision marker: {marker}",
        )
    decided_ri_017_markers = (
        "**Decided August 16, 2026 — adopt a bounded honest response for Private MVP.**",
        "cannot restore or transfer budget membership, role, ownership, connection authority",
        "escalation cannot override that product rule",
        "does not confirm a hidden space, membership, owner, or other-member state",
        "identify, contact, or mediate with another member",
        "recommend interpersonal contact",
        "Owner-managed invitation may be described only as a generic product boundary",
        "This approval is Private-MVP-only",
    )
    for marker in decided_ri_017_markers:
        audit.check(
            marker in matrix,
            f"matrix does not preserve the RI-93-017 decision marker: {marker}",
        )
    decided_ri_018_markers = (
        "**Decided August 16, 2026 — delete private data and pseudonymize retained shared history.**",
        "After the 30-day restoration window closes",
        "provider credentials/authorizations",
        "replace customer-visible attribution with “Former member”",
        "A restricted internal subject link may remain only where necessary",
        "Retain a minimal deletion ledger",
        "does not remove another member's authored content",
        "recipient-controlled copies",
    )
    for marker in decided_ri_018_markers:
        audit.check(
            marker in matrix,
            f"matrix does not preserve the RI-93-018 decision marker: {marker}",
        )
    decided_ri_019_markers = (
        "**Decided August 16, 2026 — notify without objection, veto, or delay.**",
        "may dissolve the exact budget-scoped joint projection immediately",
        "authenticated in-app pre-notice where the approved lifecycle and safety rules permit",
        "always receives an immediate post-outcome notice",
        "underlying account-to-space links remain unless separately removed",
        "Contributors receive no objection, veto, delay, acknowledgement, or approval state",
        "Re-association still requires materially new approved provider evidence or fresh unanimous confirmation",
        "notice failure does not preserve an incorrect or stale projection",
        "does not accept `AB-93-086`",
        "`RI-93-001–019` are fully decided",
        "No `RI-93-*` product choice remains open",
    )
    for marker in decided_ri_019_markers:
        audit.check(
            marker in matrix,
            f"matrix does not preserve the RI-93-019 decision marker: {marker}",
        )

    # Acceptance-criteria and finding coverage.
    for number in range(1, 7):
        audit.check(
            f"CBD-95-AC{number:02d}" in trace,
            f"CBD-95-AC{number:02d} is missing from traceability",
        )
    for number in range(1, 11):
        audit.check(
            f"CBD-14-AC{number:02d}" in trace,
            f"CBD-14-AC{number:02d} is missing from traceability",
        )
    for number in range(1, 9):
        audit.check(
            f"RV-95-{number:03d}" in trace,
            f"RV-95-{number:03d} is missing from the review record",
        )

    material_markers = (
        "content-free push/SMS",
        "user-created/paused/disabled eligible alerts",
        "comprehensive, fixed-field",
        "multiple Co-owners",
        "CBD-71 v1.0",
    )
    combined_review = matrix + "\n" + register + "\n" + trace
    for marker in material_markers:
        audit.check(marker in combined_review, f"material conflict marker missing: {marker}")

    limitation_markers = (
        "not legal",
        "penetration testing",
        "certification",
        "proof of security",
        "not implementation evidence",
        "not a release approval",
    )
    package_text = "\n".join(text_by_path.values()).lower()
    for marker in limitation_markers:
        audit.check(marker in package_text, f"required limitation is missing: {marker}")

    audit.check(
        "`RG-94-015`" in trace and "public-launch-only" in package_text,
        "RG-94-015 public-launch-only boundary is missing",
    )
    audit.check(
        "`RG-94-016`" in trace and "implementation" in trace and "launch" in trace,
        "RG-94-016 is not clearly separated from implementation/launch readiness",
    )

    # Markdown hygiene and local references.
    placeholder_pattern = re.compile(r"(?:\bTODO\b|\bTBD\b|\bFIXME\b|\?\?\?|\*\*\* Begin Patch|\*\*\* End Patch)")
    for path, text in text_by_path.items():
        audit.check(not text.startswith("\ufeff"), f"{path}: UTF-8 BOM present")
        for line_number, line in enumerate(text.splitlines(), start=1):
            audit.check(
                line == line.rstrip(),
                f"{path}:{line_number}: trailing whitespace",
            )
        if path.suffix == ".md":
            check_markdown_tables(audit, path, text)
            headings = [line.strip() for line in text.splitlines() if line.startswith("#")]
            duplicates = sorted({heading for heading in headings if headings.count(heading) > 1})
            audit.check(not duplicates, f"{path}: duplicate headings: {duplicates}")
        audit.check(
            placeholder_pattern.search(text) is None,
            f"{path}: placeholder or patch marker remains",
        )

    for path, headings in REQUIRED_HEADINGS.items():
        text = text_by_path[path]
        for heading in headings:
            audit.check(heading in text, f"{path}: required heading missing: {heading}")

    check_local_references(audit, text_by_path)
    check_cbd95_citations(
        audit,
        text_by_path,
        {
            "RC": {number for number, _, _ in rc_rows},
            "FU": defined_fu,
            "RV": {number for number, _, _ in rv_rows},
        },
    )
    check_unsupported_claims(audit, text_by_path)

    documented_total = check_documented_totals(audit, trace)
    # Must remain the last check performed: the documented total counts every
    # check this run makes, including this one.
    audit.check(
        documented_total is not None and documented_total == audit.checks + 1,
        f"documented check total {documented_total} does not match this run's "
        f"{audit.checks + 1}; rerun and restate it in all three places",
    )

    if audit.warnings:
        for warning in audit.warnings:
            print(f"WARN {warning}")
    if audit.failures:
        for failure in audit.failures:
            print(f"FAIL {failure}")
        print(
            f"CBD-95 AUDIT FAIL: {audit.checks} checks, "
            f"{len(audit.failures)} failures, {len(audit.warnings)} warnings"
        )
        return 1

    print(
        "CBD-95 AUDIT PASS: "
        f"{audit.checks} checks, 0 failures, {len(audit.warnings)} warnings; "
        "18 upstream families, 11 frozen blobs, 36 RC rows, 30 FU rows, "
        "8 RV findings, 19 RI decisions, 14 required areas, "
        "6 CBD-95 ACs, 10 CBD-14 ACs"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
