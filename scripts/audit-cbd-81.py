#!/usr/bin/env python3
"""Structural audit for the CBD-81 beta targets and review process package.

CBD-81 defines no metric and no source. It records operating rules -- baseline
profile, review cadence, owner, trigger -- for metrics that live in CBD-77,
CBD-78 and CBD-79, and it restates their class, connectivity and deferral status
in prose. Everything it says about the metric set is therefore a restatement of
somebody else's document, which is exactly the shape of claim that goes stale
without anyone editing it. The guards below read the siblings and compare.

What it checks, and why each guard exists:

* The section 4 matrix holds exactly the metrics the sibling packages define.
  A row for a metric that no longer exists assigns an owner to nothing; a metric
  with no row has no cadence, no trigger and no accountable owner, and nothing
  else in the repository would notice.

* Every count the package states is compared to what the siblings actually
  hold -- the totals, the per-package split, the aggregate-state/reliability-
  telemetry split and the connectivity set. None of them is pinned here. CBD-80
  learned this the hard way: a hardcoded total has to be edited on every
  amendment, which is the same restated-by-hand defect the audit exists to
  catch. The class split is derived from CBD-79's per-metric `Class` rows and
  the package-wide constants in CBD-77 and CBD-78.

* The deferral set is closed and checked both ways. The package states there
  are exactly four approved metric deferrals and names them; the matrix marks
  rows deferred. Those two must agree, or a metric is excused from beta evidence
  in one place and required in the other.

* MT-79-003, MT-79-008 and MT-79-010 are not deferred. Their exact bounds may
  stay unset at specification closure under CBD81-BOUNDS-001, and that closure
  exception is one edit away from reading like a fifth deferral. The package
  says repeatedly that it is not one. This guard is the reason to write the
  audit at all: a drafter who moves those rows into the deferred set removes
  three required metrics from beta evidence, and every remaining sentence in
  the package still parses.

* Every profile cited in the matrix is defined in the section 2 protocol table.
  A profile with no start, duration, minimum evidence or next decision is a
  cadence nobody can schedule.

* The four SYN-81 disclosure scenarios emit an identical external result. That
  identity *is* the generic-Withheld boundary approved under CBD81-PRIVACY-001:
  if one scenario's expected result diverges, the external record reveals which
  internal condition occurred, and the boundary is gone while the table still
  looks complete.

* Every DEC/DEF/DEP-81, SYN-81 and criterion identifier mentioned holds a row in
  its register, and the identifiers run 001 upward with no gaps. Derived, not
  listed, for the reason CBD-80 records: naming them means editing this file
  every time one is decided. A gap means a row was deleted or renamed.

* Traceability resolves both ways. Every criterion with a coverage row is served
  by at least one process section in the reverse map, every criterion cited in
  the reverse map has a coverage row, and every process section cited there
  exists as a heading in the process document.

Documentation integrity only. It measures nothing, implements no source, proves
no metric computable, and establishes no beta evidence, baseline or release.
"""

from __future__ import annotations

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
PROCESS = REPO_ROOT / "docs/cbd-81-beta-targets-and-review-process.md"
TRACE = REPO_ROOT / "docs/cbd-81-acceptance-criteria-traceability.md"
SIBLINGS = {
    "CBD-77": REPO_ROOT / "docs/cbd-77-activation-and-onboarding-metrics.md",
    "CBD-78": REPO_ROOT / "docs/cbd-78-engagement-and-retention-metrics.md",
    "CBD-79": REPO_ROOT / "docs/cbd-79-reliability-and-safety-metrics.md",
}

PROCESS_NAME = "docs/cbd-81-beta-targets-and-review-process.md"
TRACE_NAME = "docs/cbd-81-acceptance-criteria-traceability.md"

METRIC_HEADING = r"^### (MT-{n}-\d{{3}}) — "
MATRIX_ROW = re.compile(r"^\| (MT-7[789]-\d{3}) — ")
CLASS_ROW = re.compile(r"^\| Class \| `([a-z-]+)` \|", re.M)

# Counts are written as words in the prose and digits in one place. The audit
# never pins the value, only reads whichever form the document used.
NUMBER_WORDS = {
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
    "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
    "nineteen": 19, "twenty-eight": 28,
}

# The withdrawn behavioural event model. AN-92-001 disabled it before any of
# these packages were written, so its vocabulary in an operating row means the
# model leaked back in through a rule rather than through a metric definition.
EVENT_MODEL = {
    "analytics event": r"\banalytics event\b",
    "event catalog": r"\bevent catalog\b",
    "AE- prefix": r"\bAE-\d+-\d+\b",
    "idempotency key": r"\bidempotency[_ ]key\b",
    "cohort": r"\bcohorts?\b",
    "funnel": r"\bfunnels?\b",
}

# The disclosure rules that carry the approved privacy boundary. Each is pinned
# to the clause that states the rule, not to a sentence that happens to contain
# it, so a rewrite that keeps the rule passes and one that drops it fails.
DISCLOSURE_RULES = {
    "every availability state is a disclosure":
        "Every externally recorded availability state is a disclosure",
    "one generic withheld status": "all emit exactly",
    "no baseline credit for withholding":
        "Generic withholding earns no baseline credit",
    "no recovery by arithmetic": "No denominator manipulation",
    "two separate destinations": "Do not join the two",
    "no figures on unauthorized surfaces":
        "No figures enter Git, Confluence,",
    "individual inspection stays gated": "OP-92-003",
}

# Rows whose bounds may stay unset at specification closure under
# CBD81-BOUNDS-001. The exception is explicitly not a deferral, and each row
# must keep saying what it withholds until its prerequisites are verified.
LATER_BOUND = {
    "MT-79-003": ("Required beta evidence, not deferred",
                  "no rate, healthy status, numeric release, baseline start or credit"),
    "MT-79-008": ("Required beta evidence, not deferred",
                  "no rate, healthy status, numeric release, baseline start or credit"),
    "MT-79-010": ("Baseline only after interval, terminal-state, source, bucket "
                  "and release proof",
                  "no compliance or near-breach claim"),
}

# What a row excused from current Private MVP evidence must still deny itself.
# A deferral that stops saying these becomes an unavailable value that reads
# like a measured one. MT-78-006 inherits the denials from the four-week row
# rather than restating them, which is the repository's usual preference over
# restating a rule by hand, so an explicit inheritance satisfies the guard and
# the full language is required in section 2 below, where the authority lives.
DEFERRAL_DENIALS = ("no computation", "baseline credit")
DEFERRAL_INHERITANCE = "Same approved deferral"

# The section 2 paragraphs that carry the two approved deferral authorities.
# The matrix rows may abbreviate; these may not.
DEFERRAL_AUTHORITIES = {
    "CBD13-RETENTION-001":
        "receive no computation, numeric release or baseline credit",
    "CBD13-USABLE-TIME-001":
        "no computation, numerical release, baseline credit or successful timing claim",
}


class Audit:
    def __init__(self) -> None:
        self.checks = 0
        self.failures: list[str] = []

    def check(self, ok: bool, message: str) -> None:
        self.checks += 1
        if not ok:
            self.failures.append(message)


def number(token: str) -> int | None:
    """Read a count written as digits or as a word."""
    token = token.strip().lower()
    if token.isdigit():
        return int(token)
    return NUMBER_WORDS.get(token)


def cells(line: str) -> list[str]:
    return [c.strip() for c in line.strip().strip("|").split("|")]


def flatten(text: str) -> str:
    """Collapse whitespace so a prose check survives a rewrap.

    The documents are hard-wrapped, so a rule stated in prose is routinely
    split across two lines. A guard that matches the unwrapped string fails on
    a reflow that changed nothing, which teaches the next reader to loosen the
    guard rather than fix the document.
    """
    return re.sub(r"\s+", " ", text)


def section(text: str, number_label: str) -> str:
    """Return the body of `## <number_label>.` up to the next section heading."""
    start = re.search(rf"^## {re.escape(number_label)}\.? ", text, re.M)
    if not start:
        return ""
    end = re.search(r"^## ", text[start.end():], re.M)
    return text[start.start():start.end() + end.start()] if end else text[start.start():]


def table_after(text: str, header_fragment: str) -> list[list[str]]:
    """Return the body rows of the table whose header contains the fragment."""
    rows: list[list[str]] = []
    lines = text.splitlines()
    for index, line in enumerate(lines):
        if not line.startswith("|") or header_fragment not in line:
            continue
        for body in lines[index + 2:]:
            if not body.startswith("|"):
                break
            rows.append(cells(body))
        break
    return rows


def expand_ids(fragment: str) -> set[str]:
    """Expand the package's `MT-78-004/005/006` shorthand into full IDs."""
    found: set[str] = set()
    for match in re.finditer(r"\b(MT-7[789])-(\d{3}(?:/\d{3})*)\b", fragment):
        prefix = match.group(1)
        for number_part in match.group(2).split("/"):
            found.add(f"{prefix}-{number_part}")
    return found


def sibling_inventory(audit: Audit) -> tuple[dict[str, str], dict[str, set[str]], set[str]]:
    """Read the metric IDs, classes and connectivity the siblings actually define.

    Returns {metric: class}, {package: metric IDs} and the connectivity-required
    set. Nothing here is stated in CBD-81; it is what CBD-81's prose is checked
    against.
    """
    classes: dict[str, str] = {}
    by_package: dict[str, set[str]] = {}
    connectivity: set[str] = set()

    for package, path in SIBLINGS.items():
        text = path.read_text(encoding="utf-8")
        number_part = package.split("-")[1]
        headings = list(re.finditer(METRIC_HEADING.format(n=number_part), text, re.M))
        audit.check(bool(headings), f"{package}: no metric headings found -- check the pattern")
        by_package[package] = {match.group(1) for match in headings}

        # A package may declare its class once for every record, as CBD-77 and
        # CBD-78 do, or per record, as CBD-79 does because its records split
        # across two destinations. Read the per-record row where present and
        # fall back to the package constant, so neither form has to be pinned.
        constant = re.search(r"`Class: (aggregate-state|reliability-telemetry)`", text)
        for index, match in enumerate(headings):
            start = match.end()
            end = headings[index + 1].start() if index + 1 < len(headings) else len(text)
            body = text[start:end]
            row = CLASS_ROW.search(body)
            if row:
                classes[match.group(1)] = row.group(1)
            elif constant:
                classes[match.group(1)] = constant.group(1)
            else:
                audit.check(False, f"{package}: {match.group(1)} declares no class")
            if "CONN-REQUIRED" in body:
                connectivity.add(match.group(1))

    return classes, by_package, connectivity


def matrix_rows(text: str, audit: Audit) -> dict[str, dict[str, str]]:
    """Parse the section 4 operating matrix into {metric: parsed row}."""
    parsed: dict[str, dict[str, str]] = {}
    for line in text.splitlines():
        match = MATRIX_ROW.match(line)
        if not match:
            continue
        metric = match.group(1)
        row = cells(line)
        audit.check(len(row) == 4,
                    f"{PROCESS_NAME}: {metric} has {len(row)} columns, expected four")
        if len(row) != 4:
            continue
        audit.check(metric not in parsed,
                    f"{PROCESS_NAME}: {metric} holds more than one matrix row")
        for index, attribute in enumerate(("identifier and name", "owner",
                                           "profile and cadence", "trigger and response")):
            audit.check(bool(row[index]),
                        f"{PROCESS_NAME}: {metric} column {attribute!r} is empty")
        profile_cell = row[2]
        profile = profile_cell.split(";")[0].strip()
        profile = re.sub(r"^Future\s+", "", profile)
        profile = re.sub(r"\s+plus zero-failure guardrail$", "", profile)
        parsed[metric] = {
            "owner": row[1],
            "profile": profile,
            "profile_cell": profile_cell,
            "trigger": row[3],
            "deferred": "Private MVP deferred" in profile_cell,
            "line": line,
        }
    return parsed


def register_checks(audit: Audit, text: str, table: list[list[str]],
                    pattern: str, label: str, document: str) -> None:
    """Every identifier mentioned holds a row, and the rows run 001 upward.

    Derived rather than listed, for the reason CBD-80 records: naming the
    identifiers means editing this file whenever one is added or decided, which
    is the by-hand restatement the audit exists to prevent. Requiring contiguous
    numbering closes the gap a mention-only rule leaves open -- a row deleted
    when nothing else refers to it.
    """
    mentioned = set(re.findall(pattern, text))
    # A register cell carries the identifier plus its disposition -- "DEC-81-003
    # — approved specification-closure disposition" -- so the identifier is read
    # out of the cell rather than assumed to be the whole of it.
    tabled = set()
    for row in table:
        if not row:
            continue
        found = re.search(pattern, row[0])
        if found:
            tabled.add(found.group(0))
    audit.check(bool(mentioned), f"{document}: no {label} identifiers found at all")
    for identifier in sorted(mentioned):
        audit.check(identifier in tabled,
                    f"{document}: {identifier} is mentioned but holds no row in the "
                    f"{label} register -- an item tracked in prose is not tracked")
    numbers = sorted(int(re.search(r"(\d+)$", i).group(1)) for i in tabled
                     if re.fullmatch(pattern.replace("\\b", ""), i))
    audit.check(numbers == list(range(1, len(numbers) + 1)),
                f"{document}: {label} rows must run 001 upward with no gaps, got "
                f"{numbers} -- a gap means a row was deleted or renamed")


def main() -> int:
    audit = Audit()
    process = PROCESS.read_text(encoding="utf-8")
    trace = TRACE.read_text(encoding="utf-8")
    process_flat = flatten(process)

    classes, by_package, connectivity = sibling_inventory(audit)
    defined = set(classes)
    matrix = matrix_rows(process, audit)

    # --- the matrix is exactly the sibling metric set ------------------------
    for metric in sorted(defined - set(matrix)):
        audit.check(False,
                    f"{PROCESS_NAME}: {metric} is defined in a sibling package and holds "
                    "no matrix row, so it has no owner, cadence or trigger")
    for metric in sorted(set(matrix) - defined):
        audit.check(False,
                    f"{PROCESS_NAME}: {metric} holds a matrix row but no sibling package "
                    "defines it -- the row assigns an owner to nothing")

    # --- every count the package states agrees with the siblings -------------
    total = re.search(r"the existing (\S+) metrics", process)
    audit.check(total is not None,
                f"{PROCESS_NAME}: section 1 must state the metric total, so it can be "
                "compared to the siblings rather than trusted")
    if total:
        said = number(total.group(1))
        audit.check(said == len(defined),
                    f"{PROCESS_NAME}: states {total.group(1)} metrics; the sibling "
                    f"packages define {len(defined)}")

    split = re.search(r"inventory is exactly (\S+) CBD-77, (\S+) CBD-78 and (\S+) CBD-79 metrics",
                      trace)
    audit.check(split is not None,
                f"{TRACE_NAME}: section 3 must state the per-package inventory")
    if split:
        for token, package in zip(split.groups(), ("CBD-77", "CBD-78", "CBD-79")):
            audit.check(number(token) == len(by_package[package]),
                        f"{TRACE_NAME}: states {token} {package} metrics; that package "
                        f"defines {len(by_package[package])}")

    derived_classes = {
        "aggregate-state": {m for m, c in classes.items() if c == "aggregate-state"},
        "reliability-telemetry": {m for m, c in classes.items() if c == "reliability-telemetry"},
    }
    for document, text, patterns in (
        (TRACE_NAME, trace, {
            "aggregate-state": r"(\S+) aggregate-state metrics are",
            "reliability-telemetry": r"(\S+) reliability-telemetry metrics are",
        }),
        (PROCESS_NAME, process, {
            "aggregate-state": r"(\S+)\s+`aggregate-state` metrics",
            "reliability-telemetry": r"Only (\S+) `reliability-telemetry` metrics",
        }),
    ):
        for name, pattern in patterns.items():
            stated = re.search(pattern, text)
            audit.check(stated is not None,
                        f"{document}: must state how many metrics use the {name} destination")
            if stated:
                audit.check(number(stated.group(1)) == len(derived_classes[name]),
                            f"{document}: states {stated.group(1)} {name} metrics; the "
                            f"sibling packages class {len(derived_classes[name])} that way")

    audit.check(derived_classes["aggregate-state"] | derived_classes["reliability-telemetry"]
                == defined,
                "siblings: a metric is classed as neither aggregate-state nor "
                "reliability-telemetry, so its destination is undecided")

    stated_conn = re.search(r"Only (MT-79-\d{3}) through (MT-79-\d{3}) require connectivity",
                            trace)
    audit.check(stated_conn is not None,
                f"{TRACE_NAME}: section 3 must state the connectivity-dependent range")
    if stated_conn:
        first = int(stated_conn.group(1).rsplit("-", 1)[1])
        last = int(stated_conn.group(2).rsplit("-", 1)[1])
        claimed = {f"MT-79-{n:03d}" for n in range(first, last + 1)}
        audit.check(claimed == connectivity,
                    f"{TRACE_NAME}: claims {sorted(claimed)} require connectivity; CBD-79 "
                    f"marks {sorted(connectivity)} CONN-REQUIRED")
    audit.check(re.search(r"`MT-79-001` through `MT-79-005` are `CONN-REQUIRED`", process)
                is not None or bool(connectivity & set(matrix)),
                f"{PROCESS_NAME}: section 4 must name the connectivity-deferred rows")

    # --- profiles are defined before they are cited --------------------------
    profile_rows = table_after(process, "| Profile | Start and duration |")
    audit.check(bool(profile_rows),
                f"{PROCESS_NAME}: section 2 profile protocol table not found")
    profiles = {row[0].strip("` ") for row in profile_rows if row}
    for row in profile_rows:
        audit.check(len(row) == 4,
                    f"{PROCESS_NAME}: profile {row[0]!r} has {len(row)} columns, expected four")
        for index, attribute in enumerate(("profile", "start and duration",
                                           "minimum evidence and review", "next decision")):
            if index < len(row):
                audit.check(bool(row[index]),
                            f"{PROCESS_NAME}: profile {row[0]!r} has no {attribute}")
    for metric, row in sorted(matrix.items()):
        audit.check(row["profile"] in profiles,
                    f"{PROCESS_NAME}: {metric} cites profile {row['profile']!r}, which "
                    f"section 2 does not define -- a cadence nobody can schedule")

    stated_profiles = re.search(r"(\S+) approved profiles", trace)
    if stated_profiles:
        audit.check(number(stated_profiles.group(1)) == len(profiles),
                    f"{TRACE_NAME}: states {stated_profiles.group(1)} approved profiles; "
                    f"section 2 defines {len(profiles)}")

    # --- owners come from the categories the package approved ----------------
    owner_claim = re.search(r"exactly one ([a-z]+(?:, [a-z]+)*) or ([a-z]+) owner", trace)
    audit.check(owner_claim is not None,
                f"{TRACE_NAME}: CBD-81-AC02 must name the approved owner categories")
    if owner_claim:
        approved_owners = {o.strip() for o in owner_claim.group(1).split(",")}
        approved_owners.add(owner_claim.group(2).strip())
        for metric, row in sorted(matrix.items()):
            audit.check(row["owner"] in approved_owners,
                        f"{PROCESS_NAME}: {metric} names owner {row['owner']!r}, which is "
                        f"not one of the approved categories {sorted(approved_owners)}")

    # --- the deferral set is closed and agrees with the matrix ---------------
    # This is the guard the package most needs. A deferral excuses a metric from
    # current Private MVP evidence; the sentence stating how many there are and
    # the rows marking them deferred are written in different sections, and
    # nothing else in the repository compares them.
    deferral_claim = re.search(r"exactly (\S+) approved metric deferrals: ([^.]+)\.", process)
    audit.check(deferral_claim is not None,
                f"{PROCESS_NAME}: section 2 must state the closed deferral set, so the "
                "matrix can be checked against it")
    matrix_deferred = {m for m, row in matrix.items() if row["deferred"]}
    if deferral_claim:
        named = expand_ids(deferral_claim.group(2))
        said = number(deferral_claim.group(1))
        audit.check(said == len(named),
                    f"{PROCESS_NAME}: states {deferral_claim.group(1)} deferrals and names "
                    f"{len(named)}: {sorted(named)}")
        audit.check(named == matrix_deferred,
                    f"{PROCESS_NAME}: section 2 names {sorted(named)} as the approved "
                    f"deferrals; the section 4 matrix marks {sorted(matrix_deferred)} "
                    "deferred -- a metric excused in one section and required in the other")
        for metric in sorted(named):
            audit.check(metric in defined,
                        f"{PROCESS_NAME}: deferral names {metric}, which no sibling defines")

    for metric in sorted(matrix_deferred):
        trigger = matrix[metric]["trigger"]
        missing = [phrase for phrase in DEFERRAL_DENIALS if phrase not in trigger.lower()]
        audit.check(not missing or DEFERRAL_INHERITANCE in trigger,
                    f"{PROCESS_NAME}: deferred {metric} must keep denying itself {missing}, "
                    f"or inherit the denials with {DEFERRAL_INHERITANCE!r} -- an unavailable "
                    "value that stops saying so reads like a measured one")

    # The abbreviating rows above lean on section 2, so section 2 may not
    # abbreviate. Each approved deferral authority states the full denial there.
    protocol = flatten(section(process, "2"))
    for authority, denial in DEFERRAL_AUTHORITIES.items():
        audit.check(authority in protocol,
                    f"{PROCESS_NAME}: section 2 must name the deferral authority {authority}")
        audit.check(denial in protocol,
                    f"{PROCESS_NAME}: section 2 must state the {authority} denial -- {denial!r}")

    # --- the closure exception has not become a fifth deferral ---------------
    # CBD81-BOUNDS-001 lets the freshness and lateness bounds stay unset at
    # specification closure. The package says in four places that this is not a
    # deferral. One edit to a profile cell would make it one, removing three
    # required metrics from beta evidence while every other sentence still
    # parses, so the rows are checked directly.
    for metric, required in LATER_BOUND.items():
        if metric not in matrix:
            audit.check(False, f"{PROCESS_NAME}: {metric} holds no matrix row")
            continue
        audit.check(not matrix[metric]["deferred"],
                    f"{PROCESS_NAME}: {metric} is marked Private MVP deferred; the "
                    "CBD81-BOUNDS-001 later-bound exception is a closure-stage exception, "
                    "not a deferral, and this row is required beta evidence")
        trigger = matrix[metric]["trigger"]
        for phrase in required:
            audit.check(phrase in trigger,
                        f"{PROCESS_NAME}: {metric} must retain {phrase!r}")
    audit.check("closure-stage exception is not a Private MVP applicability deferral"
                in process_flat,
                f"{PROCESS_NAME}: section 2 must state that the later-bound exception is "
                "not an applicability deferral")

    # --- the disclosure boundary -------------------------------------------
    for label, needle in DISCLOSURE_RULES.items():
        audit.check(needle in process_flat,
                    f"{PROCESS_NAME}: section 3 must state the rule -- {label}")

    evidence_rows = table_after(process, "| Permitted evidence state |")
    audit.check(bool(evidence_rows),
                f"{PROCESS_NAME}: section 3 permitted evidence state table not found")
    for row in evidence_rows:
        audit.check(len(row) == 2 and all(row),
                    f"{PROCESS_NAME}: permitted evidence state {row[0]!r} carries no treatment")

    decision_rows = table_after(process, "| Decision | Accepted specification rule |")
    audit.check(bool(decision_rows),
                f"{PROCESS_NAME}: section 5 decision table not found")
    for row in decision_rows:
        audit.check(len(row) == 2 and all(row),
                    f"{PROCESS_NAME}: beta decision {row[0]!r} carries no rule")

    # --- the four disclosure scenarios are indistinguishable -----------------
    # The identity of these cells is the approved boundary, not a formatting
    # nicety: the whole point of CBD81-PRIVACY-001 is that the external record
    # cannot reveal which internal condition occurred. A scenario whose expected
    # result diverges defeats it while the table still looks complete.
    syn_rows = table_after(trace, "| Scenario | Synthetic internal condition |")
    audit.check(bool(syn_rows), f"{TRACE_NAME}: section 5 synthetic scenario table not found")
    results = set()
    for row in syn_rows:
        audit.check(len(row) == 3 and all(row),
                    f"{TRACE_NAME}: scenario {row[0]!r} is missing a condition or result")
        if len(row) == 3:
            results.add(row[2])
    audit.check(len(results) <= 1,
                f"{TRACE_NAME}: the synthetic scenarios emit {len(results)} distinct external "
                "results; identical output across every withheld condition is the approved "
                f"boundary, so a difference discloses the condition -- {sorted(results)}")
    register_checks(audit, trace, syn_rows, r"\bSYN-81-\d{3}\b", "SYN-81 scenario", TRACE_NAME)

    # --- decision and criterion registers resolve ----------------------------
    decision_register = table_after(process, "| ID | Decision brief and options |")
    audit.check(bool(decision_register),
                f"{PROCESS_NAME}: section 6 decision register table not found")
    for prefix in ("DEC", "DEF", "DEP"):
        register_checks(audit, process + trace, decision_register,
                        rf"\b{prefix}-81-\d{{3}}\b", f"{prefix}-81", PROCESS_NAME)
    for row in decision_register:
        audit.check(len(row) == 3 and all(row),
                    f"{PROCESS_NAME}: decision {row[0]!r} carries no brief or no gate")

    own_criteria = table_after(trace, "| Criterion | Package evidence |")
    parent_criteria = table_after(trace, "| Criterion | Existing definition evidence")
    audit.check(bool(own_criteria), f"{TRACE_NAME}: section 1 coverage table not found")
    audit.check(bool(parent_criteria), f"{TRACE_NAME}: section 2 parent review table not found")
    register_checks(audit, trace, own_criteria, r"\bCBD-81-AC\d{2}\b", "CBD-81 criterion",
                    TRACE_NAME)
    register_checks(audit, trace, parent_criteria, r"\bCBD-13-AC\d{2}\b", "CBD-13 criterion",
                    TRACE_NAME)
    for label, rows in (("section 1", own_criteria), ("section 2", parent_criteria)):
        for row in rows:
            audit.check(len(row) == 3 and all(row),
                        f"{TRACE_NAME}: {label} row {row[0]!r} carries no evidence or "
                        "no disposition")

    # --- reverse traceability resolves both ways -----------------------------
    reverse = table_after(trace, "| Process section | Criteria served |")
    audit.check(bool(reverse), f"{TRACE_NAME}: section 3 reverse traceability table not found")
    served: set[str] = set()
    headings = set(re.findall(r"^## (\d+(?:\.\d+)?)\. ", process, re.M))
    headings |= set(re.findall(r"^## (\d+\.\d+) ", process, re.M))
    for row in reverse:
        audit.check(len(row) == 2 and all(row),
                    f"{TRACE_NAME}: reverse traceability row {row[0]!r} serves no criteria")
        if len(row) != 2:
            continue
        # "6.1 — approved lifecycle meanings" and "Companion section 5 — ...".
        # A companion row points at this document, not the process document.
        cited = re.match(r"(\d+(?:\.\d+)?) —", row[0])
        if cited:
            audit.check(cited.group(1) in headings,
                        f"{TRACE_NAME}: reverse traceability cites process section "
                        f"{cited.group(1)}, which the process document does not have")
        for family, index in re.findall(r"\bCBD-(81|13)-AC(\d{2})\b", row[1]):
            served.add(f"CBD-{family}-AC{index}")
        # The table writes runs as "CBD-81-AC01/AC03/AC05", so the trailing
        # members carry no family of their own and are attached to the last one.
        for run in re.finditer(r"\bCBD-(81|13)-AC\d{2}((?:/AC\d{2})+)", row[1]):
            for index in re.findall(r"AC(\d{2})", run.group(2)):
                served.add(f"CBD-{run.group(1)}-AC{index}")

    for rows, family in ((own_criteria, "CBD-81"), (parent_criteria, "CBD-13")):
        for row in rows:
            criterion = row[0].strip("`~ ")
            if not criterion.startswith(family):
                continue
            audit.check(criterion in served,
                        f"{TRACE_NAME}: {criterion} claims coverage but no process section "
                        "in the reverse map serves it")
    tabled = {row[0].strip("`~ ") for row in own_criteria + parent_criteria if row}
    for criterion in sorted(served):
        audit.check(criterion in tabled,
                    f"{TRACE_NAME}: the reverse map serves {criterion}, which holds no "
                    "coverage row")

    # --- the withdrawn event model has not returned --------------------------
    for metric, row in sorted(matrix.items()):
        for name, pattern in EVENT_MODEL.items():
            audit.check(not re.search(pattern, row["line"], re.I),
                        f"{PROCESS_NAME}: {metric}'s operating row uses the withdrawn "
                        f"event model ({name})")

    # --- the companion documents describe the same package -------------------
    versions = []
    for document, text in ((PROCESS_NAME, process), (TRACE_NAME, trace)):
        stated = re.search(r"^Version ([\d.]+),", text, re.M)
        audit.check(stated is not None, f"{document}: no document version stated")
        if stated:
            versions.append(stated.group(1))
    audit.check(len(set(versions)) <= 1,
                f"companion documents state different versions: {versions}")

    print(f"CBD-81 documentation audit: {audit.checks} checks")
    print(f"Failures: {len(audit.failures)}")
    for failure in audit.failures:
        print(f"  - {failure}")
    if not audit.failures:
        # Says only what stays true. The package is a set of operating rules for
        # metrics none of which is computable yet, so a result line naming a
        # particular blocker would go stale the moment that one cleared.
        print("Result: PASS (documentation integrity only; no metric is measured, no "
              "baseline has started, and the gates recorded in sections 2, 3 and 6 "
              "remain binding)")
    return 1 if audit.failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
