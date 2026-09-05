#!/usr/bin/env python3
"""Check that closed vocabularies stay consistent wherever documents restate them.

Why this exists
---------------
The CBD-102 documents cross-reference each other by stable identifier —
`HG-102-*`, `WR-102-*`, `DM-102-*`, `CT-102-*` — and those references are easy
to verify mechanically: an identifier either resolves or it does not.

A *concept* is different. When the evidence register introduced the `UNPROVEN`
gate outcome and the matching `ELIGIBLE-PENDING-EVIDENCE` verdict, two other
documents kept enumerating the older three-verdict set. Every identifier still
resolved, so no existing check noticed. The stale enumerations were found by
reading a published Confluence page.

That is the same drift the CBD-9x registers exhibit, where each relation is
stated two or three times across documents. This script catches it for the
vocabularies where a partial list is always a mistake.

Usage
-----
    python scripts/check-doc-vocabulary.py            # check docs/, exit 1 on drift
    python scripts/check-doc-vocabulary.py --verbose  # also show every enumeration found

Scope and limits
----------------
This checks **closed** vocabularies only — sets where naming some members but
not all is a defect. It deliberately does not check vocabularies where a subset
is meaningful. Evidence classes are the clearest example: "Observed,
Contractual, or Attested" is a correct and intentional subset in the evidence
register's rubric-score table, so a completeness rule there would report
correct text as broken. A noisy guard gets ignored, which is worse than no
guard.

An enumeration is detected only when two or more distinct members appear joined
by list punctuation — a comma or a slash, optionally with `or`/`and`, backticks
and whitespace. Members joined by prose are not an enumeration: "the asymmetry
between `PASS` and `FAIL` is deliberate" names two members on purpose and is
left alone.

Adding a member to a vocabulary means updating VOCABULARIES below. The canonical
field records which document section owns the definition, so the authority is
never ambiguous.
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from fnmatch import fnmatch
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DOCS_DIR = REPO_ROOT / "docs"


@dataclass(frozen=True)
class Vocabulary:
    name: str
    members: tuple[str, ...]
    canonical: str
    """The document section that owns this definition and must be updated first."""
    applies_to: tuple[str, ...]
    """Filename globs this vocabulary governs.

    Scoping is not optional. CBD-94's verification inventory records results as
    Pass/Fail/Blocked/Not applicable — its own closed set, unrelated to the
    CBD-102 gate outcome. Without a scope, a CBD-102 vocabulary reports correct
    CBD-94 text as drift.
    """


VOCABULARIES: tuple[Vocabulary, ...] = (
    Vocabulary(
        name="eligibility-verdict",
        members=("ELIGIBLE", "ELIGIBLE-PENDING-EVIDENCE", "CONDITIONAL", "INELIGIBLE"),
        canonical="docs/cbd-102-evidence-register-and-exception-rules.md §3.3",
        applies_to=("cbd-10?-*.md", "cbd-130-*.md"),
    ),
    Vocabulary(
        name="gate-outcome",
        members=("PASS", "UNPROVEN", "FAIL"),
        canonical="docs/cbd-102-evidence-register-and-exception-rules.md §3.3",
        applies_to=("cbd-10?-*.md", "cbd-130-*.md"),
    ),
    # Single-letter members look noisy and are not, because of the pipe rule in
    # `paragraph_blocks`. Every place these letters appear *individually* is a
    # table cell -- the category map, the gate tables' Cat column, the rubric
    # weight header, the per-category billable units -- and a pipe is not list
    # glue, so no run forms across them. The only construction that produces a
    # run is a prose list of the categories, which is exactly the thing that
    # must name all six. Category N was added on August 16, 2026 and two such
    # lists kept naming five.
    Vocabulary(
        name="provider-category",
        members=("H", "I", "D", "E", "F", "N"),
        canonical="docs/cbd-102-provider-requirements-hard-gate-catalog.md §3",
        applies_to=("cbd-10?-*.md", "cbd-130-*.md"),
    ),
    # A two-member set carries no drift coverage: a run needs two distinct
    # members, which for such a set is already complete, so it can never be
    # partial. metric-class and connectivity-marker are registered for the
    # canonical record only, and the CBD-13 proof asserts that rather than
    # assuming it.
    # CBD-13 measurement sets. Every glob below is exact rather than "cbd-7?-*",
    # which would sweep in the approved CBD-73 through CBD-76 documents and
    # report their correct text as drift -- the failure the scoping note above
    # describes. CBD-77 through CBD-81 are added to each glob as they merge;
    # only cbd-13-*.md exists today.
    Vocabulary(
        name="metric-class",
        members=("aggregate-state", "reliability-telemetry"),
        canonical="docs/cbd-13-measurement-conventions.md §5",
        applies_to=("cbd-13-*.md", "cbd-77-*.md", "cbd-78-*.md"),
    ),
    Vocabulary(
        name="connectivity-marker",
        members=("CONN-REQUIRED", "MANUAL-OK"),
        canonical="docs/cbd-13-measurement-conventions.md §5",
        applies_to=("cbd-13-*.md", "cbd-77-*.md", "cbd-78-*.md"),
    ),
    Vocabulary(
        name="budget-cadence",
        members=("weekly", "monthly", "paycheck", "custom"),
        canonical="docs/cbd-13-measurement-conventions.md §9",
        applies_to=("cbd-13-*.md", "cbd-77-*.md", "cbd-78-*.md"),
    ),
    Vocabulary(
        name="invitation-state",
        members=("sent", "accepted", "expired", "revoked", "declined"),
        canonical="docs/cbd-13-measurement-conventions.md §9",
        applies_to=("cbd-13-*.md", "cbd-78-*.md"),
    ),
    Vocabulary(
        name="notification-state",
        members=("enqueued", "delivered", "failed", "suppressed", "duplicate", "late"),
        canonical="docs/cbd-13-measurement-conventions.md §9",
        applies_to=("cbd-13-*.md",),
    ),
    # The set CBD-13 section 9 calls the highest-risk one: it appears in CBD-79's
    # criteria, in the CBD-13 parent criteria, and will appear again in CBD-80
    # and CBD-81.
    Vocabulary(
        name="alert-quality-state",
        members=("duplicate", "late", "incorrect", "acknowledged", "dismissed"),
        canonical="docs/cbd-13-measurement-conventions.md §9",
        applies_to=("cbd-13-*.md",),
    ),
    Vocabulary(
        name="collaboration-action",
        members=("viewing", "editing", "acknowledgement", "commenting"),
        canonical="docs/cbd-13-measurement-conventions.md §9",
        applies_to=("cbd-13-*.md", "cbd-78-*.md"),
    ),
)

# Glue that makes a sequence of members a list rather than prose. A comma or a
# slash must be present: `or` and `and` alone are not enough, because naming two
# members in a sentence is ordinary writing, not an enumeration.
GLUE = re.compile(r"^[\s`*]*[,/][\s`*]*(?:or|and)?[\s`*]*$")


def surface_forms(member: str) -> tuple[str, ...]:
    """Canonical caps plus title case, e.g. UNPROVEN and Unproven.

    Both appear legitimately: tables use the caps identifier, the rubric's
    gate-versus-rubric comparison uses title case in prose.
    """
    title = "-".join(part.capitalize() for part in member.split("-"))
    return (member,) if title == member else (member, title)


def find_members(line: str, vocab: Vocabulary) -> list[tuple[int, int, str]]:
    """Locate members in a line, longest first so ELIGIBLE cannot shadow
    INELIGIBLE or ELIGIBLE-PENDING-EVIDENCE."""
    found: list[tuple[int, int, str]] = []
    for member in sorted(vocab.members, key=len, reverse=True):
        for form in surface_forms(member):
            for match in re.finditer(rf"(?<![A-Za-z-]){re.escape(form)}(?![A-Za-z-])", line):
                if any(start < match.end() and match.start() < end for start, end, _ in found):
                    continue
                found.append((match.start(), match.end(), member))
    return sorted(found)


def enumerations(line: str, vocab: Vocabulary) -> list[list[str]]:
    """Return each run of members joined only by list glue."""
    hits = find_members(line, vocab)
    runs: list[list[str]] = []
    current: list[str] = []
    for index, (start, end, member) in enumerate(hits):
        if not current:
            current = [member]
            continue
        previous_end = hits[index - 1][1]
        if GLUE.match(line[previous_end:start]):
            current.append(member)
        else:
            if len(set(current)) >= 2:
                runs.append(current)
            current = [member]
    if len(set(current)) >= 2:
        runs.append(current)
    return runs


def claimed_by_a_complete_neighbour(
    run: list[str], vocab: Vocabulary, line: str
) -> Vocabulary | None:
    """Return the vocabulary a run really belongs to, when it is not this one.

    Two registered sets can share adjacent members. `notification-state` ends
    `duplicate`, `late` and `alert-quality-state` begins with the same two, so a
    *complete* listing of either contains an apparent *partial* listing of the
    other and the checker reports correct text as drift.

    A run is not drift when every member in it also belongs to another
    vocabulary that is completely enumerated on the same line. The longer
    complete run is the real enumeration; the short one is its shadow.

    This can mask a genuinely incomplete enumeration whose members happen to be
    a subset of a complete neighbour on the same line. That trade is deliberate:
    the alternative is a guard that fails on correct text, which is worse than
    no guard because it gets switched off. CBD-108 section 4.77 records the
    same reasoning.
    """
    for other in VOCABULARIES:
        if other.name == vocab.name:
            continue
        if not set(run).issubset(other.members):
            continue
        for other_run in enumerations(line, other):
            if not set(other.members) - set(other_run):
                return other
    return None


def excluded_deliberately(missing: list[str], vocab: Vocabulary, line: str) -> bool:
    """True when the members absent from a run are named and explicitly excluded.

    "Invitations in any terminal state -- accepted, expired, revoked, or
    declined. `sent` is excluded" is correct writing: a proper subset with the
    remainder named and a reason given. The run is incomplete and the sentence
    is not, and reporting it as drift punishes exactly the precision this
    checker exists to encourage.

    So a run is not drift when every missing member appears in the same block
    inside an exclusion construction. This can mask a genuine omission that
    happens to sit near the word "excluded"; the trade is the same one the
    overlap rule takes, and for the same reason -- a guard that fails on
    correct text gets switched off.
    """
    if not any(re.search(marker, line, re.I) for marker in EXCLUSION_MARKERS):
        return False
    return all(find_members(line, vocab) and
               any(member == hit[2] for hit in find_members(line, vocab))
               for member in missing)


EXCLUSION_MARKERS = (
    r"\bis excluded\b", r"\bare excluded\b", r"\bexcludes?\b",
    r"\bomitted\b", r"\bnot counted\b", r"\bleaves? the denominator\b",
)


def paragraph_blocks(text: str) -> list[tuple[int, str]]:
    """Join consecutive non-blank lines, returning (starting line number, text).

    These documents are hard-wrapped at roughly 80 columns, so an enumeration
    routinely straddles a line break:

        1. **Eligibility verdict** — `ELIGIBLE`, `ELIGIBLE-PENDING-EVIDENCE`,
           `CONDITIONAL`, or `INELIGIBLE` per R1, ...

    Scanning line by line splits that into two apparently incomplete lists and
    reports correct text as drift. Joining is safe for tables because a pipe is
    not list glue, so members in adjacent table rows never form a run.
    """
    blocks: list[tuple[int, str]] = []
    start = 0
    buffer: list[str] = []
    for number, line in enumerate(text.splitlines(), start=1):
        if line.strip():
            if not buffer:
                start = number
            buffer.append(line.strip())
        elif buffer:
            blocks.append((start, " ".join(buffer)))
            buffer = []
    if buffer:
        blocks.append((start, " ".join(buffer)))
    return blocks


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--verbose", action="store_true", help="print every enumeration found, not only drift")
    parser.add_argument("--path", default="docs", help="directory to scan (default: docs)")
    args = parser.parse_args()

    root = REPO_ROOT / args.path
    if not root.exists():
        sys.exit(f"No such path: {args.path}")

    failures = 0
    checked = 0
    for file in sorted(root.rglob("*.md")):
        blocks = paragraph_blocks(file.read_text(encoding="utf-8"))
        for vocab in VOCABULARIES:
            if not any(fnmatch(file.name, glob) for glob in vocab.applies_to):
                continue
            for number, line in blocks:
                for run in enumerations(line, vocab):
                    named = set(run)
                    missing = [m for m in vocab.members if m not in named]
                    where = f"{file.relative_to(REPO_ROOT).as_posix()}:{number}"
                    if missing and excluded_deliberately(missing, vocab, line):
                        if args.verbose:
                            print(f"skip  {where}  {vocab.name}: missing members are "
                                  "named and explicitly excluded")
                        continue
                    if missing:
                        owner = claimed_by_a_complete_neighbour(run, vocab, line)
                        if owner is not None:
                            if args.verbose:
                                print(f"skip  {where}  {vocab.name}: run belongs to "
                                      f"{owner.name}, which is complete here")
                            continue
                    checked += 1
                    if missing:
                        failures += 1
                        print(f"DRIFT {where}")
                        print(f"      vocabulary : {vocab.name}")
                        print(f"      names      : {', '.join(dict.fromkeys(run))}")
                        print(f"      missing    : {', '.join(missing)}")
                        print(f"      canonical  : {vocab.canonical}")
                        print(f"      line       : {line.strip()[:160]}")
                    elif args.verbose:
                        print(f"ok    {where}  {vocab.name}: complete")

    print(f"\n{checked} enumeration(s) checked across {len(VOCABULARIES)} vocabularies.")
    if failures:
        print(f"{failures} incomplete. Update the enumeration, or update VOCABULARIES if the set itself changed.")
        return 1
    print("No vocabulary drift.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
