#!/usr/bin/env python3
"""Warn before Federal Reserve holiday coverage becomes a constraint (CBD-250).

Why this exists
---------------
`packages/budget-domain/src/schedule/business-day.ts` carries a deliberately
bounded holiday dataset. PD-68-05 requires that an uncovered year block
confirmation rather than "silently use weekday-only logic", and the domain
package honours that: asking about an uncovered year raises
`HolidayCoverageError` instead of guessing.

That refusal is correct and it is also a cliff. `FEDERAL_RESERVE_CALENDAR` is
verified through a fixed year; the day a schedule reaches past it, business-day
adjustment stops answering and confirmation stops working -- for a real user,
on a real payday, with no warning beforehand. The failure is loud at the moment
it happens and completely silent for the years leading up to it, which is the
worst possible shape: nobody is told while there is still time to act.

This guard converts that silence into a lead time. It reads the verified range
out of the domain source, computes the first uncovered year, and fails while
that year is still `LEAD_TIME_YEARS` away -- long before any user meets it.

It also refuses four ways the warning itself could be lost:

* the calendar literal renamed, moved or reshaped, so a text-reading guard
  finds nothing and passes green on a file it no longer understands;
* a bound advanced without the dataset version that records which published
  schedule was checked, which is a bound nobody verified;
* a bound or dataset version advanced without `verifiedOn` moving too, which
  is the same unverified bound wearing a consistent-looking pair of numbers --
  *when there is a prior revision to compare against*; see below;
* the uncovered-year refusal deleted from the domain package, which would turn
  the loud cliff into exactly the quiet wrong answer PD-68-05 forbids.

A guard that only knows how to read one shape of file must fail, not pass, when
the file stops having that shape.

The third bullet is the one condition that needs two revisions, not one, so it
behaves differently depending on how this script was invoked:

* on a `push` run, the workflow passes `--base-ref` (the commit before the
  push, or the merge-base with the default branch when there is none) and the
  condition compares the working copy against that ref's blob. A base ref that
  cannot be read is itself a finding here, not silence -- a push run declares
  that a comparison is possible, and failing to produce one is exactly the
  "cannot look" state this guard exists to make loud.
* on a `schedule` or `workflow_dispatch` run, the workflow passes
  `--no-baseline-check`: there is no push event and therefore nothing to diff,
  and the guard prints a distinct "not applicable" line and treats the
  condition as satisfied on that basis rather than guessing.
* run locally with neither flag, the previous file-touching commit is used as
  a convenience, and every path where that lookup fails prints a distinct
  "skipped: no baseline" line -- never the silent, unlabelled pass a checked
  and clean run produces.

No runtime and no external Python dependency: this reads the TypeScript as
text with the standard library only. One condition, `verified_on_moves_with_the_bounds`,
additionally shells out to a read-only local `git` for the base-ref and
previous-commit lookups described above; every other condition never touches
git and keeps working verbatim on a runner with no git binary, a bare
`--source` file, or a shallow, historyless checkout -- that one condition
simply reports "not applicable" or "skipped" instead in those cases, rather
than a pass it cannot back up.

Usage
-----
    python scripts/check-holiday-coverage.py              # exit 1 on any finding
    python scripts/check-holiday-coverage.py --verbose    # also print the range read
    python scripts/check-holiday-coverage.py --source <path>   # diagnostic only
    python scripts/check-holiday-coverage.py --year 2029       # diagnostic only
    python scripts/check-holiday-coverage.py --base-ref <ref>        # push runs
    python scripts/check-holiday-coverage.py --no-baseline-check     # schedule/dispatch runs

`--source` and `--year` exist so a fixture can be checked and so an owner can
ask "when does this start failing" without waiting for the calendar to roll.
Both print a DIAGNOSTIC banner and neither belongs in a scheduled run: a CI
invocation carrying `--year` is a guard that has been quietly silenced.

`--base-ref` and `--no-baseline-check` are mutually exclusive and both are
about `verified_on_moves_with_the_bounds` only -- the one condition that needs
a prior revision. `--base-ref <ref>` compares the working copy against that
ref's blob (the workflow's push run passes the pre-push commit or a
merge-base); an unreadable ref is then a finding, because a push run asserts a
comparison is possible. `--no-baseline-check` declares up front that no such
comparison exists for this run (the workflow's schedule and workflow_dispatch
runs, which have no change to diff); the condition prints "not applicable" and
is satisfied on that basis. Neither flag falls back to the previous-commit
convenience described in `previous_calendar`.

Scope and limits
----------------
This checks the *declared* range, not the dates. It does not fetch the Federal
Reserve schedule, does not verify that the computed holidays are right, and
cannot tell a re-verified bound from a bound someone simply raised. Proving the
dates is the domain package's own test suite; proving the source is a human
reading the published schedule and recording it in `datasetVersion` and
`verifiedOn`. This guard only guarantees that somebody is asked in time.
"""

from __future__ import annotations

import argparse
import datetime as _datetime
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

DEFAULT_SOURCE = Path("packages/budget-domain/src/schedule/business-day.ts")

# How far ahead the guard looks. This value is DERIVED, not chosen:
#
#     lead time = (longest forward horizon the product offers, in years,
#                  rounded up) + 1 year of owner action time
#
#     24-month product horizon -> 2, plus 1 year of action time = 3
#
# FIRST TERM -- the product offers a 24-month forward view. Decided by the
# Executive on 2026-09-12. It has to be the product horizon rather than the
# uncovered year itself, because a user is blocked well before the uncovered
# year arrives: `assertHorizonCovered` in paycheck-period.ts throws if *any*
# year in a requested horizon is uncovered, not merely the last one.
#
#     for (let year = first; year <= last; year += 1) {
#       if (!isYearCovered(year)) { throw new HolidayCoverageError(year); }
#     }
#
# So with coverage through 2030, a 24-month view stops working in January
# 2029 -- two years ahead of 2031, not on it. The guard has to fire before
# the first blocked user, not before the boundary.
#
# SECOND TERM -- the extension work. Read the published Federal Reserve
# Financial Services schedule, extend the range, update datasetVersion and
# verifiedOn, review, merge. CBD-68 Section 10.3 requires verification before
# activation, so it is reviewed owner work rather than a constant bump. It is
# still only days of work; a year of margin against days is deliberate slack,
# because the warning is worthless if it lands in the middle of the cycle it
# was meant to start.
#
# The two terms together give the guard a fixed property: it fires one year
# before the first user could be blocked, whatever the product horizon is. At
# 3, with the bound at 2030, it fails from 1 January 2028 and the first
# 24-month view breaks in January 2029.
#
# Changing this number legitimately means one of the two terms changed --
# in practice, the product's forward horizon moving. Recompute from the
# formula; do not pick a number. Lowering it otherwise spends the notice this
# guard exists to create. Raising it otherwise eventually fires against years
# the Federal Reserve has not published: it publishes only a rolling
# five-year window, which caps this constant below 5 whatever the product
# horizon becomes.
LEAD_TIME_YEARS = 3

CALENDAR_LITERAL = "FEDERAL_RESERVE_CALENDAR"

# `frfs-2026-2030` -- the publisher, then the range the dataset claims. The
# range is the part this guard reads back.
DATASET_VERSION_RANGE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*?-(\d{4})-(\d{4})$")

CALENDAR_BLOCK = re.compile(
    r"export\s+const\s+" + CALENDAR_LITERAL + r"\s*:[^=]*=\s*\{(?P<body>.*?)\n\};",
    re.DOTALL,
)

COVERAGE_PREDICATE = re.compile(
    r"function\s+isYearCovered\s*\([^)]*\)[^{]*\{(?P<body>.*?)\n\}",
    re.DOTALL,
)

# Years outside this range are a typo or a placeholder, not a decision. 1900
# predates the Federal Reserve's published schedules entirely and 2200 is past
# any date arithmetic this product performs.
PLAUSIBLE_YEARS = range(1900, 2201)


@dataclass(frozen=True)
class Calendar:
    """The provenance record as declared in the domain source."""

    dataset_version: str
    verified_from: int
    verified_through: int
    verified_on: str

    @property
    def first_uncovered_year(self) -> int:
        return self.verified_through + 1


@dataclass(frozen=True)
class Subject:
    """One thing to check: a source text, read as of a particular year."""

    path: str
    source: str
    year: int
    calendar: Calendar | None
    parse_problem: str | None
    # The calendar as it stood before this change, when one is available. Only
    # `verified_on_moves_with_the_bounds` reads this; every other condition
    # judges `calendar` alone. None means no honest comparison is possible --
    # no prior revision, no git, or a diagnostic source outside any repository
    # -- not that the calendar is wrong.
    baseline: Calendar | None = None


@dataclass(frozen=True)
class Finding:
    condition: str
    problem: str
    fix: str


def parse_calendar(source: str) -> tuple[Calendar | None, str | None]:
    """Read the provenance literal, or say precisely why it could not be read.

    Returning the reason rather than raising is what keeps a reshaped file a
    finding instead of a traceback -- and what keeps it from being a pass.
    """
    block = CALENDAR_BLOCK.search(source)
    if block is None:
        return None, (
            f"no `export const {CALENDAR_LITERAL}: ... = {{ ... }};` literal was found"
        )

    body = block.group("body")
    numbers: dict[str, int] = {}
    for field in ("verifiedFrom", "verifiedThrough"):
        match = re.search(rf"\b{field}\s*:\s*(-?\d+)\s*,", body)
        if match is None:
            return None, f"{CALENDAR_LITERAL} declares no integer `{field}`"
        numbers[field] = int(match.group(1))

    version = re.search(r"\bdatasetVersion\s*:\s*[\"']([^\"']*)[\"']\s*,", body)
    if version is None:
        return None, f"{CALENDAR_LITERAL} declares no string `datasetVersion`"

    verified_on = re.search(
        r"\bverifiedOn\s*:\s*(?:toISODate\()?[\"'](\d{4}-\d{2}-\d{2})[\"']", body)
    if verified_on is None:
        return None, f"{CALENDAR_LITERAL} declares no ISO `verifiedOn` date"

    return Calendar(
        dataset_version=version.group(1),
        verified_from=numbers["verifiedFrom"],
        verified_through=numbers["verifiedThrough"],
        verified_on=verified_on.group(1),
    ), None


def calendar_literal_is_readable(subject: Subject) -> list[Finding]:
    """The provenance literal must still be there and still be readable.

    Without this the guard fails open. Rename the export, wrap it in a factory,
    or move it to a JSON file, and every other condition here has nothing to
    look at -- a text-reading check over a file it cannot parse reports no
    findings, which reads exactly like coverage being fine.
    """
    if subject.parse_problem is None:
        return []
    return [Finding(
        condition="calendar_literal_is_readable",
        problem=f"the holiday provenance record could not be read: {subject.parse_problem}",
        fix=f"restore the `{CALENDAR_LITERAL}` object literal with integer "
            "`verifiedFrom` and `verifiedThrough`, a string `datasetVersion` and an "
            "ISO `verifiedOn`; if the record legitimately moved, update this guard's "
            "reader in the same change -- do not leave it reading a shape that is gone",
    )]


def verified_range_is_coherent(subject: Subject) -> list[Finding]:
    """The declared range must describe a real span of years.

    A transposed edit -- 2030 into verifiedFrom, 2026 left in verifiedThrough --
    produces an empty range. Every year is then uncovered, `isYearCovered`
    returns false for all of them, and the horizon arithmetic below reads a
    first uncovered year in the past, which would otherwise be reported as a
    confusing coverage warning rather than as the broken edit it is.
    """
    calendar = subject.calendar
    if calendar is None:
        return []

    findings = []
    for name, value in (("verifiedFrom", calendar.verified_from),
                        ("verifiedThrough", calendar.verified_through)):
        if value not in PLAUSIBLE_YEARS:
            findings.append(Finding(
                condition="verified_range_is_coherent",
                problem=f"{name} is {value}, which is not a plausible calendar year "
                        f"({PLAUSIBLE_YEARS.start}-{PLAUSIBLE_YEARS.stop - 1})",
                fix=f"set {name} to the four-digit year actually verified against the "
                    "published Federal Reserve Financial Services schedule",
            ))
    if findings:
        return findings

    if calendar.verified_from > calendar.verified_through:
        return [Finding(
            condition="verified_range_is_coherent",
            problem=f"the verified range is empty: verifiedFrom {calendar.verified_from} "
                    f"is after verifiedThrough {calendar.verified_through}, so no year is "
                    "covered and every holiday adjustment throws",
            fix="the two bounds are almost certainly transposed; restore "
                "verifiedFrom <= verifiedThrough",
        )]
    return []


def dataset_version_names_the_verified_range(subject: Subject) -> list[Finding]:
    """The dataset version must name the same years the bounds claim.

    CBD-68 Section 10.2 asks for a dataset version alongside the covered years
    so a stored adjustment can be traced to the publication it came from. That
    only works while the two agree. The realistic drift is a bound raised to
    clear this guard without the verification behind it: `verifiedThrough`
    moves to 2032 and `datasetVersion` still says `frfs-2026-2030`, which is the
    record saying plainly that 2031 and 2032 were never checked against
    anything. Catching the mismatch is what stops this guard from being
    satisfiable by editing one integer.
    """
    calendar = subject.calendar
    if calendar is None:
        return []

    match = DATASET_VERSION_RANGE.match(calendar.dataset_version)
    if match is None:
        return [Finding(
            condition="dataset_version_names_the_verified_range",
            problem=f"datasetVersion {calendar.dataset_version!r} does not name a year "
                    "range, so the bounds cannot be traced to a published schedule",
            fix="use `<publisher>-<firstYear>-<lastYear>`, e.g. "
                f"`frfs-{calendar.verified_from}-{calendar.verified_through}`",
        )]

    stated = (int(match.group(1)), int(match.group(2)))
    actual = (calendar.verified_from, calendar.verified_through)
    if stated != actual:
        return [Finding(
            condition="dataset_version_names_the_verified_range",
            problem=f"datasetVersion {calendar.dataset_version!r} covers "
                    f"{stated[0]}-{stated[1]} but the bounds claim {actual[0]}-{actual[1]}; "
                    "the years in the gap are asserted by no recorded dataset",
            fix="re-verify against the published Federal Reserve Financial Services "
                "schedule, then update datasetVersion and verifiedOn together with the "
                "bounds -- a bound moved on its own is a year nobody checked",
        )]
    return []


def verified_on_moves_with_the_bounds(subject: Subject) -> list[Finding]:
    """A raised bound or a changed dataset version must carry a new `verifiedOn`.

    `dataset_version_names_the_verified_range` catches a bound moved on its
    own, with `datasetVersion` left stale. It has nothing to say about the
    edit right next to that one: both numbers moved together, consistently,
    but `verifiedOn` did not -- which is what typing the right-looking values
    without re-reading the published Federal Reserve Financial Services
    schedule that day looks like. CBD-68 Section 10.3 asks for verification
    before activation; a verification that happened would have a new date
    behind it.

    This condition alone needs two revisions, so it can only judge what
    `subject.baseline` was actually given -- it never goes looking for one
    itself. `subject.baseline` is None, and this condition reports nothing,
    in three different situations that main() distinguishes out loud on
    stdout even though they land the same way here:

    * `--base-ref` named a ref this run could not read. That case is raised
      as a separate finding before evaluation ever reaches this condition --
      see `resolve_baseline` -- so by the time this function runs, a None
      baseline here means the ref genuinely had no readable calendar to
      compare (a shape this file predates, say), not that reading it failed.
    * `--no-baseline-check` was given: a schedule or workflow_dispatch run
      declaring there is no push to diff, printed as "not applicable".
    * neither flag was given and the previous-commit convenience found
      nothing (first revision, no git, no history for this path, or a
      diagnostic `--source` outside any repository), printed as "skipped:
      no baseline".

    None of those three is "the calendar is wrong", so none of them is a
    finding; they are also never silent, because a checked-and-clean run and
    a could-not-check run must never print the same thing.
    """
    calendar = subject.calendar
    baseline = subject.baseline
    if calendar is None or baseline is None:
        return []
    if calendar.verified_on != baseline.verified_on:
        return []

    moved = []
    if calendar.verified_through > baseline.verified_through:
        moved.append(f"verifiedThrough moved {baseline.verified_through} -> "
                     f"{calendar.verified_through}")
    if calendar.dataset_version != baseline.dataset_version:
        moved.append(f"datasetVersion moved {baseline.dataset_version!r} -> "
                     f"{calendar.dataset_version!r}")
    if not moved:
        return []

    return [Finding(
        condition="verified_on_moves_with_the_bounds",
        problem=f"{'; '.join(moved)}, but verifiedOn is still {calendar.verified_on!r}: "
                "the record claims a moved bound with no new verification date behind it",
        fix="re-verify against the published Federal Reserve Financial Services schedule "
            "on the day you make this change and set verifiedOn to that date -- a bound "
            "or dataset version that moved without verifiedOn moving too is a value "
            "nobody actually rechecked",
    )]


def uncovered_years_are_still_refused(subject: Subject) -> list[Finding]:
    """The domain package must still refuse an uncovered year.

    This guard's entire value rests on the refusal existing. PD-68-05 requires
    an uncovered year to block confirmation and not fall back to weekday-only
    logic. Delete the throw, or narrow the predicate to test only the lower
    bound, and running out of coverage stops being a loud failure and becomes a
    plausible wrong payday -- the exact outcome CBD-98 is tracking, arriving
    without even the warning this script gives. A lead-time warning about a
    cliff that has been quietly paved over is worse than no warning.

    The "commented out" check this condition does is narrow and is not a
    comment parser: a line is excluded only when its stripped text starts
    with `//`. A `/* ... */` block comment around the throw, or a trailing
    `// disabled` after live code on the same line, is not detected by this
    condition and still counts as a live refusal. That is a real gap, not a
    hidden one: this guard reads TypeScript as text with no external
    dependency (see the module docstring), and a full comment grammar is out
    of scope for that trade.
    """
    source = subject.source
    findings = []

    if "class HolidayCoverageError" not in source:
        findings.append(Finding(
            condition="uncovered_years_are_still_refused",
            problem="HolidayCoverageError is no longer declared",
            fix="restore the error type; PD-68-05 requires an uncovered year to block "
                "confirmation rather than fall back to weekday-only logic",
        ))
    throw_is_live = any(
        "throw new HolidayCoverageError(" in line
        for line in source.splitlines()
        if not line.strip().startswith("//")
    )
    if not throw_is_live:
        findings.append(Finding(
            condition="uncovered_years_are_still_refused",
            problem="nothing throws HolidayCoverageError any more, so an uncovered year "
                    "is answered instead of refused",
            fix="restore the assertion that throws on an uncovered year",
        ))

    predicate = COVERAGE_PREDICATE.search(source)
    if predicate is None:
        findings.append(Finding(
            condition="uncovered_years_are_still_refused",
            problem="no `isYearCovered` predicate was found",
            fix="restore the coverage predicate, or update this guard in the same change "
                "if the refusal legitimately moved",
        ))
    else:
        body = predicate.group("body")
        missing = [bound for bound in ("verifiedFrom", "verifiedThrough")
                   if bound not in body]
        if missing:
            findings.append(Finding(
                condition="uncovered_years_are_still_refused",
                problem=f"isYearCovered no longer tests {' and '.join(missing)}, so years "
                        "outside the verified range are treated as covered",
                fix="restore both bounds in the predicate; a one-sided test makes the "
                    "upper cliff silent, which is the failure this guard exists to prevent",
            ))
    return findings


def coverage_horizon_is_clear(subject: Subject) -> list[Finding]:
    """The first uncovered year must stay more than the lead time away.

    CBD-250-AC01. The horizon is `year + LEAD_TIME_YEARS`; the guard fails when
    it reaches the first uncovered year, which is `verifiedThrough + 1`. This is
    written against `LEAD_TIME_YEARS` rather than a year, because the number is
    derived (see the constant's definition above) and has already changed once
    -- a worked example pinned here would drift the moment it changed again,
    exactly as the two-year, 1 January 2029 example this docstring used to
    carry did after the derivation moved the constant from 2 to 3.
    """
    calendar = subject.calendar
    if calendar is None:
        return []

    first_uncovered = calendar.first_uncovered_year
    horizon = subject.year + LEAD_TIME_YEARS
    if horizon < first_uncovered:
        return []

    already = subject.year >= first_uncovered
    urgency = (
        f"{first_uncovered} is ALREADY UNCOVERED and the current year is {subject.year}: "
        "holiday adjustment is failing for real schedules now"
        if already else
        f"the {LEAD_TIME_YEARS}-year lead horizon from {subject.year} reaches "
        f"{horizon}, at or past the first uncovered year {first_uncovered}"
    )
    return [Finding(
        condition="coverage_horizon_is_clear",
        problem=f"Federal Reserve holiday coverage ends after {calendar.verified_through}; "
                f"{urgency}. Any business-day adjustment landing in {first_uncovered} "
                "raises HolidayCoverageError and blocks confirmation (CBD-68 Section 10.3)",
        fix="extend the calendar: check the published Federal Reserve Financial Services "
            f"schedule for {first_uncovered} onward, raise verifiedThrough, and update "
            "datasetVersion and verifiedOn to record what was checked and when. Do not "
            f"raise {LEAD_TIME_YEARS} in LEAD_TIME_YEARS to clear this -- that spends the "
            "notice period instead of using it (CBD-98)",
    )]


# The registry is the guard. Every condition is load-bearing and each is proved
# so in scripts/test_check_holiday_coverage.py: for each entry there is a
# fixture that only that entry catches, and a test that removes the entry and
# shows the fixture then passes clean.
CONDITIONS = (
    calendar_literal_is_readable,
    verified_range_is_coherent,
    dataset_version_names_the_verified_range,
    verified_on_moves_with_the_bounds,
    uncovered_years_are_still_refused,
    coverage_horizon_is_clear,
)


def subject_for(source: str, year: int, path: str = str(DEFAULT_SOURCE),
                baseline: Calendar | None = None) -> Subject:
    calendar, parse_problem = parse_calendar(source)
    return Subject(path=path, source=source, year=year,
                   calendar=calendar, parse_problem=parse_problem, baseline=baseline)


def _read_git_blob(ref: str, relative_path: str, repo_root: Path) -> str | None:
    """`git show <ref>:<path>`, or None on any failure. Never raises."""
    try:
        result = subprocess.run(
            ["git", "show", f"{ref}:{relative_path}"],
            cwd=repo_root, capture_output=True, text=True, encoding="utf-8",
            timeout=10, check=False)
    except (OSError, ValueError):
        return None
    if result.returncode != 0:
        return None
    return result.stdout


def _git_repo_root(source_path: Path) -> tuple[Path | None, str | None]:
    """The repository containing `source_path`, and its path relative to it.

    Returns `(None, None)` when there is no repository to find -- no `git`
    binary, or the path is not inside a working tree -- which is a caller's
    signal to treat that as "nothing to compare against" rather than raise.
    """
    try:
        toplevel = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            cwd=source_path.parent, capture_output=True, text=True, encoding="utf-8",
            timeout=10, check=False)
    except (OSError, ValueError):
        return None, None
    if toplevel.returncode != 0:
        return None, None
    repo_root = Path(toplevel.stdout.strip())
    try:
        relative = source_path.resolve().relative_to(repo_root.resolve()).as_posix()
    except (OSError, ValueError):
        return None, None
    return repo_root, relative


def read_base_ref_calendar(base_ref: str, source_path: Path) -> tuple[Calendar | None, str | None]:
    """The calendar as declared at `base_ref`, for an explicit `--base-ref` run.

    Returns `(calendar, None)` on success. Returns `(None, reason)` in two
    different shapes the caller must not confuse:

    * the blob itself could not be read (no repository here, the ref does not
      exist, or `git show` failed for any other reason) -- `reason` is set and
      non-empty, and this is a finding on a push run: `--base-ref` was given
      because a comparison was supposed to be possible.
    * the blob was read but does not parse as a calendar (the file predates
      this literal at that revision, say) -- `reason` is also set, but this is
      reported as a skip, not a finding: the ref was readable, there is simply
      nothing of this shape in it yet.
    """
    repo_root, relative = _git_repo_root(source_path)
    if repo_root is None:
        return None, f"base ref {base_ref!r} could not be read: not inside a git working tree"

    blob = _read_git_blob(base_ref, relative, repo_root)
    if blob is None:
        return None, f"base ref {base_ref!r} could not be read for {relative}"

    calendar, problem = parse_calendar(blob)
    if problem is not None:
        return None, f"base ref {base_ref!r} does not have a readable calendar at {relative}: {problem}"
    return calendar, None


def previous_calendar(source_path: Path, current_source: str) -> tuple[Calendar | None, str | None]:
    """The calendar as it stood before this change, read from git history.

    Best effort only, and a reason rather than a finding on any failure: no
    `git` binary, the path is not inside a git working tree, the file has no
    commit history, or git could not be run for any other reason. Those are
    all "nothing to compare against", not "the calendar is wrong" -- a
    fixture written to a bare temp directory hits this path every time and
    that must not read as a defect. Returns `(calendar, None)` on success and
    `(None, reason)` when there is nothing honest to compare against.

    Compares the *file*, not the commit graph: if the working copy already
    matches its most recent commit, there is no pending edit to judge, so this
    steps back one commit further and treats that as the baseline instead.
    """
    repo_root, relative = _git_repo_root(source_path)
    if repo_root is None:
        return None, "not inside a git working tree"

    try:
        log = subprocess.run(
            ["git", "log", "--format=%H", "-2", "--", relative],
            cwd=repo_root, capture_output=True, text=True, encoding="utf-8",
            timeout=10, check=False)
    except (OSError, ValueError):
        return None, "git could not be run"
    if log.returncode != 0:
        return None, "git log failed"
    commits = [line.strip() for line in log.stdout.splitlines() if line.strip()]
    if not commits:
        return None, f"no commit history for {relative}"

    newest = _read_git_blob(commits[0], relative, repo_root)
    if newest is not None and newest == current_source:
        if len(commits) < 2:
            return None, f"only one commit touches {relative} and it matches the working copy"
        candidate = _read_git_blob(commits[1], relative, repo_root)
    else:
        candidate = newest
    if candidate is None:
        return None, f"the prior commit touching {relative} could not be read"

    calendar, problem = parse_calendar(candidate)
    if problem is not None:
        return None, f"the prior revision of {relative} does not have a readable calendar: {problem}"
    return calendar, None


@dataclass(frozen=True)
class Baseline:
    """What `verified_on_moves_with_the_bounds` may compare against, plus the
    line that must be printed to say how this run decided that."""

    calendar: Calendar | None
    note: str
    finding: Finding | None = None


def resolve_baseline(base_ref: str | None, no_baseline_check: bool,
                     source_path: Path, current_source: str) -> Baseline:
    """Decide how (or whether) this run can judge `verified_on_moves_with_the_bounds`.

    Exactly one of three modes, chosen by the caller's flags:

    * `base_ref` given (a push run): read that ref's blob. An unreadable ref
      is a finding -- a push run asserts a comparison is possible -- carried
      on `Baseline.finding` so `main()` can fold it into the run's exit code.
      A readable ref with nothing calendar-shaped in it is a skip, not a
      finding: see `read_base_ref_calendar`.
    * `no_baseline_check` set (a schedule or workflow_dispatch run): there is
      no push to diff, so the condition is declared not applicable and
      exits 0 on that basis.
    * neither given (local convenience): fall back to the previous
      file-touching commit, and report a skip line when that finds nothing.
    """
    if base_ref is not None:
        calendar, reason = read_base_ref_calendar(base_ref, source_path)
        if calendar is not None:
            return Baseline(calendar, note=f"baseline: {base_ref} ({source_path.name})")
        assert reason is not None
        if "could not be read" in reason:
            finding = Finding(
                condition="base_ref_is_readable",
                problem=f"verified_on_moves_with_the_bounds cannot run: {reason}",
                fix="a push run must be able to read its base ref's blob; check that "
                    "the workflow checked out full history (fetch-depth: 0) and passed "
                    "a real commit or the zero-SHA merge-base fallback",
            )
            return Baseline(None, note=f"skipped: no baseline ({reason})", finding=finding)
        return Baseline(None, note=f"skipped: no baseline ({reason})")

    if no_baseline_check:
        return Baseline(None, note="not applicable: no baseline comparison on this trigger "
                                    "(schedule or workflow_dispatch has no push to diff "
                                    "against) -- verified_on_moves_with_the_bounds is not "
                                    "evaluated on this run")

    calendar, reason = previous_calendar(source_path, current_source)
    if calendar is not None:
        return Baseline(calendar, note="")
    return Baseline(None, note=f"skipped: no baseline ({reason})")


def evaluate(subject: Subject) -> list[Finding]:
    """Every finding from every registered condition, in registry order."""
    findings: list[Finding] = []
    for condition in CONDITIONS:
        findings.extend(condition(subject))
    return findings


def report(subject: Subject, finding: Finding) -> None:
    print(f"HOLIDAY-COVERAGE {subject.path}")
    print(f"      condition   : {finding.condition}")
    print(f"      problem     : {finding.problem}")
    print(f"      fix         : {finding.fix}")


def main(argv: list[str] | None = None) -> int:
    # Before argparse: --help prints this docstring, and a Windows console's
    # cp1252 code page cannot encode every character a docstring may carry. A
    # guard whose --help raises UnicodeEncodeError is not a working guard.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", default=str(DEFAULT_SOURCE),
                        help="calendar source to read (diagnostic; default: "
                             f"{DEFAULT_SOURCE.as_posix()})")
    parser.add_argument("--year", type=int, default=None,
                        help="evaluate as of this year (diagnostic; default: today)")
    parser.add_argument("--verbose", action="store_true",
                        help="print the range that was read even when it is clear")
    baseline_mode = parser.add_mutually_exclusive_group()
    baseline_mode.add_argument("--base-ref", default=None,
                        help="compare against this git ref's blob for "
                             "verified_on_moves_with_the_bounds (push runs); an "
                             "unreadable ref is a finding")
    baseline_mode.add_argument("--no-baseline-check", action="store_true",
                        help="declare that no baseline comparison exists for this run "
                             "(schedule/workflow_dispatch); prints 'not applicable' "
                             "instead of attempting the previous-commit convenience")
    args = parser.parse_args(argv)

    candidate = Path(args.source)
    source_path = candidate if candidate.is_absolute() else REPO_ROOT / candidate
    try:
        display = source_path.relative_to(REPO_ROOT).as_posix()
    except ValueError:
        display = source_path.as_posix()

    if Path(args.source) != DEFAULT_SOURCE or args.year is not None:
        # Named loudly, because both overrides can turn a real failure into a
        # green run. A scheduled run that carries either is not a check.
        print("DIAGNOSTIC RUN -- not a valid scheduled check: "
              f"source={display} year={args.year if args.year is not None else 'today'}\n")

    if not source_path.is_file():
        # Checking nothing is a failure, not a pass: the file being gone is the
        # loudest possible version of the calendar being unreadable.
        print(f"HOLIDAY-COVERAGE {display}")
        print("      condition   : calendar_literal_is_readable")
        print("      problem     : the calendar source does not exist, so coverage is "
              "unverified")
        print("      fix         : restore the file, or point --source at it and update "
              "this guard's default in the same change")
        return 1

    try:
        source = source_path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as error:
        print(f"HOLIDAY-COVERAGE {display}")
        print("      condition   : calendar_literal_is_readable")
        print("      problem     : the calendar source could not be read: "
              f"{type(error).__name__}: {error}")
        print("      fix         : until it can be read, its coverage is unverified")
        return 1

    year = args.year if args.year is not None else _datetime.date.today().year
    baseline = resolve_baseline(args.base_ref, args.no_baseline_check, source_path, source)
    if baseline.note:
        print(baseline.note)
    subject = subject_for(source, year, display, baseline=baseline.calendar)
    findings = evaluate(subject)
    if baseline.finding is not None:
        findings = [baseline.finding, *findings]

    if findings:
        for finding in findings:
            report(subject, finding)
        print(f"\n{len(findings)} finding(s) in {display}. "
              f"Checked as of {year} with a {LEAD_TIME_YEARS}-year lead time.")
        return 1

    calendar = subject.calendar
    assert calendar is not None  # no parse problem means a calendar was read
    if args.verbose:
        print(f"dataset        : {calendar.dataset_version}")
        print(f"verified       : {calendar.verified_from}-{calendar.verified_through} "
              f"on {calendar.verified_on}")
        print(f"first uncovered: {calendar.first_uncovered_year}")
        print(f"lead horizon   : {year} + {LEAD_TIME_YEARS} = {year + LEAD_TIME_YEARS}")
    print(f"Holiday coverage clear in {display}: verified through {calendar.verified_through} "
          f"({calendar.dataset_version}); the first uncovered year "
          f"{calendar.first_uncovered_year} is beyond the {LEAD_TIME_YEARS}-year horizon "
          f"{year + LEAD_TIME_YEARS}. This guard starts failing in "
          f"{calendar.first_uncovered_year - LEAD_TIME_YEARS}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
