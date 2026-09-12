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

It also refuses three ways the warning itself could be lost:

* the calendar literal renamed, moved or reshaped, so a text-reading guard
  finds nothing and passes green on a file it no longer understands;
* a bound advanced without the dataset version that records which published
  schedule was checked, which is a bound nobody verified;
* the uncovered-year refusal deleted from the domain package, which would turn
  the loud cliff into exactly the quiet wrong answer PD-68-05 forbids.

A guard that only knows how to read one shape of file must fail, not pass, when
the file stops having that shape.

No runtime and no external dependency: this reads the TypeScript as text with
the standard library only, so it runs on a bare runner with no install step and
cannot be broken by a build.

Usage
-----
    python scripts/check-holiday-coverage.py              # exit 1 on any finding
    python scripts/check-holiday-coverage.py --verbose    # also print the range read
    python scripts/check-holiday-coverage.py --source <path>   # diagnostic only
    python scripts/check-holiday-coverage.py --year 2029       # diagnostic only

`--source` and `--year` exist so a fixture can be checked and so an owner can
ask "when does this start failing" without waiting for the calendar to roll.
Both print a DIAGNOSTIC banner and neither belongs in a scheduled run: a CI
invocation carrying `--year` is a guard that has been quietly silenced.

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


def uncovered_years_are_still_refused(subject: Subject) -> list[Finding]:
    """The domain package must still refuse an uncovered year.

    This guard's entire value rests on the refusal existing. PD-68-05 requires
    an uncovered year to block confirmation and not fall back to weekday-only
    logic. Delete the throw, or narrow the predicate to test only the lower
    bound, and running out of coverage stops being a loud failure and becomes a
    plausible wrong payday -- the exact outcome CBD-98 is tracking, arriving
    without even the warning this script gives. A lead-time warning about a
    cliff that has been quietly paved over is worse than no warning.
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
    if "throw new HolidayCoverageError(" not in source:
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
    it reaches the first uncovered year, which is `verifiedThrough + 1`. With a
    two-year lead time and a bound of 2030, the first uncovered year is 2031 and
    the horizon reaches it on 1 January 2029.
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
    uncovered_years_are_still_refused,
    coverage_horizon_is_clear,
)


def subject_for(source: str, year: int, path: str = str(DEFAULT_SOURCE)) -> Subject:
    calendar, parse_problem = parse_calendar(source)
    return Subject(path=path, source=source, year=year,
                   calendar=calendar, parse_problem=parse_problem)


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
    subject = subject_for(source, year, display)
    findings = evaluate(subject)

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
