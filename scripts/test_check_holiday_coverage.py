"""Prove check-holiday-coverage.py by breaking what it protects (CBD-250).

Every fixture is derived from the real
`packages/budget-domain/src/schedule/business-day.ts` by one targeted
substitution, held in memory and in a temp directory, and never written back
into the package. Deriving from the real file rather than from a hand-written
stub is deliberate: a stub drifts, and a guard proved only against a stub is
proved against a file that no longer exists. Every substitution here asserts
that it actually matched, because a fixture that silently failed to introduce
its defect is a test that passes for no reason -- which is the same failure
mode, one level up, as the guard passing on a file it cannot parse.

Fixture identifiers, for the completion record:

    FX-250-01  bound at year + LEAD - 1          expect FAIL  (horizon reached)
    FX-250-02  bound at year + LEAD              expect PASS  (horizon boundary)
    FX-250-03  bound at year + LEAD + 1          expect PASS  (clear)
    FX-250-04  bound at year - 1                 expect FAIL  (already uncovered)
    FX-250-05  calendar literal renamed          expect FAIL  (unreadable)
    FX-250-06  bounds transposed                 expect FAIL  (incoherent range)
    FX-250-07  bound raised, datasetVersion stale expect FAIL (unverified bound)
    FX-250-08  uncovered-year throw deleted      expect FAIL  (refusal lost)
    FX-250-09  predicate upper bound dropped     expect FAIL  (refusal one-sided)
    FX-250-10  the real file, unmodified         expect PASS

FX-250-01 and FX-250-02 are the load-bearing pair for CBD-250-AC01: they sit
either side of the single year where the horizon condition changes its answer.
Both are computed from `guard.LEAD_TIME_YEARS` rather than written as years,
so they follow the constant if the open product-horizon decision recorded
beside it ever moves the lead time. `HorizonBoundaryTests` records the ruling
that settled which pair straddles the boundary.

The per-condition tests below are only half the proof. `LoadBearingTests`
removes each condition from the registry in turn and shows that its fixture
then passes clean, which is what makes "this fixture fails" mean "this
condition is the thing that catches it" rather than "something caught it".
"""

from __future__ import annotations

import importlib.util
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = Path(__file__).resolve().parent / "check-holiday-coverage.py"
CALENDAR = REPO_ROOT / "packages" / "budget-domain" / "src" / "schedule" / "business-day.ts"

# The guard's filename is hyphenated, so it is loaded by path.
_spec = importlib.util.spec_from_file_location("check_holiday_coverage", SCRIPT)
guard = importlib.util.module_from_spec(_spec)
# Registered before execution: @dataclass resolves its annotations through
# sys.modules and fails on a module that is not there yet.
sys.modules[_spec.name] = guard
_spec.loader.exec_module(guard)

REAL_SOURCE = CALENDAR.read_text(encoding="utf-8")
LEAD = guard.LEAD_TIME_YEARS

REAL_CALENDAR, _REAL_PARSE_PROBLEM = guard.parse_calendar(REAL_SOURCE)
if REAL_CALENDAR is None:
    # Import-time, not inside a test: every fixture below is built from this
    # file, so if the guard cannot read it there is nothing honest to run.
    raise AssertionError(
        f"{CALENDAR} is unreadable by the guard ({_REAL_PARSE_PROBLEM}); fixtures "
        "derived from it would prove nothing")

# Every fixture is evaluated as of this year rather than as of today, so the
# suite asserts the same thing in 2026 and in 2035. The guard's real run uses
# today's year; that is the one thing here that must not be pinned, and it is
# covered by the command-line tests at the bottom against a pinned source.
NOW = 2026


def substitute(source: str, pattern: str, replacement: str) -> str:
    """One substitution that must match exactly once.

    A fixture builder whose pattern stops matching produces a copy of the
    clean file. The test would then assert that a clean file fails, notice it
    does not, and report a broken guard -- or worse, assert that it passes and
    be right for the wrong reason. Failing here instead says plainly that the
    domain source moved and the fixture needs rewriting.
    """
    result, count = re.subn(pattern, replacement, source, count=2)
    if count != 1:
        raise AssertionError(
            f"fixture pattern {pattern!r} matched {count} time(s) in "
            f"{CALENDAR.name}, expected exactly 1; the domain source has changed "
            "shape and this fixture no longer introduces the defect it names")
    return result


def with_bound(year: int) -> str:
    """FX-250-01..04: the real file with coverage ending after `year`.

    `verifiedFrom` and `datasetVersion` move with the bound, so the fixture
    carries exactly one defect -- the horizon -- and not a second, unrelated
    incoherent range or provenance mismatch riding along with it. That matters
    for FX-250-04, whose bound is in the past.
    """
    start = min(REAL_CALENDAR.verified_from, year)
    source = substitute(REAL_SOURCE, r"verifiedFrom: \d+,", f"verifiedFrom: {start},")
    source = substitute(source, r"verifiedThrough: \d+,", f"verifiedThrough: {year},")
    return substitute(source, r'datasetVersion: "frfs-\d+-\d+",',
                      f'datasetVersion: "frfs-{start}-{year}",')


FIXTURES: dict[str, str] = {
    "FX-250-01": with_bound(NOW + LEAD - 1),
    "FX-250-02": with_bound(NOW + LEAD),
    "FX-250-03": with_bound(NOW + LEAD + 1),
    "FX-250-04": with_bound(NOW - 1),
    "FX-250-05": REAL_SOURCE.replace("FEDERAL_RESERVE_CALENDAR", "FED_CALENDAR"),
    # Transposed far enough into the future that the horizon condition stays
    # quiet, and with datasetVersion transposed to match: the fixture must
    # carry the incoherent range and nothing else.
    "FX-250-06": substitute(
        substitute(
            substitute(REAL_SOURCE, r"verifiedFrom: \d+,", f"verifiedFrom: {NOW + 10},"),
            r"verifiedThrough: \d+,", f"verifiedThrough: {NOW + 5},"),
        r'datasetVersion: "frfs-\d+-\d+",',
        f'datasetVersion: "frfs-{NOW + 10}-{NOW + 5}",'),
    # The bound raised on its own -- the realistic way somebody clears this
    # guard without doing the verification behind it.
    "FX-250-07": substitute(REAL_SOURCE, r"verifiedThrough: \d+,",
                            f"verifiedThrough: {NOW + 10},"),
    "FX-250-08": substitute(REAL_SOURCE, r"throw new HolidayCoverageError\(year\);",
                            "return; // fall through to weekday-only logic"),
    "FX-250-09": substitute(
        REAL_SOURCE, r" && year <= FEDERAL_RESERVE_CALENDAR\.verifiedThrough", ""),
    "FX-250-10": REAL_SOURCE,
}

# Which condition each failing fixture exists to exercise. This mapping is what
# LoadBearingTests removes from the registry, one entry at a time.
CONDITION_FIXTURES: dict[str, str] = {
    "calendar_literal_is_readable": "FX-250-05",
    "verified_range_is_coherent": "FX-250-06",
    "dataset_version_names_the_verified_range": "FX-250-07",
    "uncovered_years_are_still_refused": "FX-250-08",
    "coverage_horizon_is_clear": "FX-250-01",
}


def findings_for(fixture: str, year: int = NOW) -> list:
    return guard.evaluate(guard.subject_for(FIXTURES[fixture], year, fixture))


class GuardStructureTests(unittest.TestCase):
    """The registry and the fixture set must stay in step with each other."""

    def test_every_registered_condition_has_a_fixture(self):
        registered = [condition.__name__ for condition in guard.CONDITIONS]
        self.assertEqual(sorted(registered), sorted(CONDITION_FIXTURES),
                         "a condition was added to or removed from the guard without "
                         "a fixture proving it is load-bearing")

    def test_the_real_calendar_is_readable(self):
        """FX-250-10: the guard must understand the file it is pointed at.

        Failing here means the domain source changed shape and the guard has
        gone blind -- which is the fail-open state every other test assumes
        away.
        """
        calendar, problem = guard.parse_calendar(REAL_SOURCE)
        self.assertIsNone(problem)
        self.assertEqual(calendar.first_uncovered_year, calendar.verified_through + 1)
        self.assertLessEqual(calendar.verified_from, calendar.verified_through)


class HorizonBoundaryTests(unittest.TestCase):
    """CBD-250-AC01: the year the answer changes.

    AC01 and AC02 contradicted each other as drafted -- AC01 and the
    description's worked example ("a bound of 2030 warns from January 1,
    2029") put the boundary between a bound of `year + 1` (fails) and
    `year + 2` (passes), while AC02 asked for `year + 2` to fail and
    `year + 3` to pass, which is reachable only with a three-year lead time.
    The Executive ruled AC02 the drafting error: the lead time stays two and
    AC02's text was corrected to express the fixtures against the constant
    rather than in absolute relative years. FX-250-01 and FX-250-02 below are
    that corrected pair, and FX-250-03 is AC02's passing side, which agreed
    either way.

    The boundary is deliberately not pinned to a year here. Every expectation
    in this class derives from `guard.LEAD_TIME_YEARS`, so a future change to
    that constant moves these fixtures with it -- which is what the open
    product-horizon dependency recorded beside the constant will eventually
    require. `test_the_boundary_moves_with_the_lead_time_and_nothing_else` is
    what makes that safe: it proves the boundary is arithmetic on the one
    constant rather than a hardcoded year.
    """

    def test_fx_250_01_bound_at_the_horizon_fails(self):
        findings = findings_for("FX-250-01")
        self.assertEqual([finding.condition for finding in findings],
                         ["coverage_horizon_is_clear"])
        self.assertIn(str(NOW + LEAD), findings[0].problem)

    def test_fx_250_02_bound_one_year_beyond_the_horizon_passes(self):
        self.assertEqual(findings_for("FX-250-02"), [])

    def test_fx_250_03_bound_well_clear_passes(self):
        self.assertEqual(findings_for("FX-250-03"), [])

    def test_fx_250_04_already_exhausted_coverage_fails_loudly(self):
        findings = findings_for("FX-250-04")
        self.assertEqual([finding.condition for finding in findings],
                         ["coverage_horizon_is_clear"])
        self.assertIn("ALREADY UNCOVERED", findings[0].problem)

    def test_the_boundary_moves_with_the_lead_time_and_nothing_else(self):
        """The rule is arithmetic on one constant, not a hardcoded year."""
        for year in range(NOW, NOW + 12):
            for bound in range(year - 1, year + LEAD + 3):
                expected = (year + LEAD) >= (bound + 1)
                failed = bool(guard.evaluate(
                    guard.subject_for(with_bound(bound), year, "boundary-sweep")))
                self.assertEqual(failed, expected,
                                 f"bound {bound} evaluated in {year}: expected "
                                 f"{'fail' if expected else 'pass'}")

    def test_the_real_calendar_names_the_year_this_guard_starts_failing(self):
        """FX-250-10 at a pinned year: the real file, well before its horizon.

        Pinned rather than run as of today so this assertion means the same
        thing every year. What it proves is that the real source passes the
        whole registry when the horizon is clear, so a failure in a later year
        is the calendar's, not the guard's.
        """
        calendar, _ = guard.parse_calendar(REAL_SOURCE)
        safe_year = calendar.first_uncovered_year - LEAD - 1
        self.assertEqual(
            guard.evaluate(guard.subject_for(REAL_SOURCE, safe_year, "FX-250-10")), [])
        # And one year later it starts warning. This is the sentence the guard
        # prints on a clean run, asserted rather than trusted.
        self.assertEqual(
            [finding.condition for finding in guard.evaluate(
                guard.subject_for(REAL_SOURCE, safe_year + 1, "FX-250-10"))],
            ["coverage_horizon_is_clear"])


class ConditionTests(unittest.TestCase):
    """One deliberate defect per condition, each caught by that condition alone."""

    def assert_only(self, fixture: str, condition: str):
        findings = findings_for(fixture)
        self.assertTrue(findings, f"{fixture} introduced a defect the guard did not catch")
        self.assertEqual({finding.condition for finding in findings}, {condition},
                         f"{fixture} was meant to exercise {condition} alone")
        for finding in findings:
            self.assertTrue(finding.fix.strip(), "a finding must carry a remedy")
        return findings

    def test_fx_250_05_renamed_literal_is_not_a_silent_pass(self):
        findings = self.assert_only("FX-250-05", "calendar_literal_is_readable")
        self.assertIn("FEDERAL_RESERVE_CALENDAR", findings[0].problem)

    def test_fx_250_06_transposed_bounds_are_caught_as_an_empty_range(self):
        findings = self.assert_only("FX-250-06", "verified_range_is_coherent")
        self.assertIn("empty", findings[0].problem)

    def test_fx_250_07_bound_raised_without_reverification_is_caught(self):
        findings = self.assert_only(
            "FX-250-07", "dataset_version_names_the_verified_range")
        real_calendar, _ = guard.parse_calendar(REAL_SOURCE)
        self.assertIn(real_calendar.dataset_version, findings[0].problem)
        self.assertIn(str(NOW + 10), findings[0].problem)

    def test_fx_250_08_deleting_the_refusal_is_caught(self):
        findings = self.assert_only("FX-250-08", "uncovered_years_are_still_refused")
        self.assertIn("uncovered year", findings[0].problem)

    def test_fx_250_09_a_one_sided_predicate_is_caught(self):
        findings = self.assert_only("FX-250-09", "uncovered_years_are_still_refused")
        self.assertIn("verifiedThrough", findings[0].problem)

    def test_implausible_years_are_rejected_before_the_arithmetic(self):
        """A placeholder bound must not read as coverage a millennium deep."""
        source = substitute(REAL_SOURCE, r"verifiedThrough: \d+,", "verifiedThrough: 9999,")
        findings = guard.evaluate(guard.subject_for(source, NOW, "placeholder-bound"))
        self.assertIn("verified_range_is_coherent",
                      {finding.condition for finding in findings})

    def test_fx_250_10_the_unmodified_source_passes(self):
        calendar, _ = guard.parse_calendar(REAL_SOURCE)
        self.assertEqual(
            guard.evaluate(guard.subject_for(
                REAL_SOURCE, calendar.first_uncovered_year - LEAD - 1, "FX-250-10")),
            [])


class LoadBearingTests(unittest.TestCase):
    """Drop each condition in turn; its fixture must then pass clean.

    This is what distinguishes a guard from a script that happens to print
    something. A condition whose removal changes no outcome is decoration, and
    a fixture that still fails after its condition is removed was never proving
    what its name claims -- some other condition was carrying it.
    """

    def run_without(self, condition_name: str, fixture: str):
        kept = tuple(condition for condition in guard.CONDITIONS
                     if condition.__name__ != condition_name)
        self.assertEqual(len(kept), len(guard.CONDITIONS) - 1,
                         f"{condition_name} is not in the registry")
        original = guard.CONDITIONS
        guard.CONDITIONS = kept
        try:
            return findings_for(fixture)
        finally:
            guard.CONDITIONS = original

    def test_each_condition_is_the_only_thing_catching_its_fixture(self):
        for condition_name, fixture in CONDITION_FIXTURES.items():
            with self.subTest(condition=condition_name, fixture=fixture):
                self.assertTrue(
                    findings_for(fixture),
                    f"{fixture} does not fail the full guard at all")
                self.assertEqual(
                    self.run_without(condition_name, fixture), [],
                    f"removing {condition_name} left {fixture} still failing, so that "
                    "fixture does not prove the condition is load-bearing")

    def test_removing_a_condition_does_not_disturb_the_clean_source(self):
        """Sanity: the clean file passes with or without any one condition, so
        the test above is measuring the fixture's defect and nothing else."""
        for condition_name in CONDITION_FIXTURES:
            with self.subTest(condition=condition_name):
                self.assertEqual(self.run_without(condition_name, "FX-250-10"), [])


class CommandLineTests(unittest.TestCase):
    """The exit codes and the message an owner actually sees."""

    def run_guard(self, *args):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), *args],
            capture_output=True, encoding="utf-8", errors="replace", timeout=120)
        self.assertNotIn("Traceback", result.stdout + result.stderr,
                         "the guard crashed instead of reporting")
        return result

    def write_fixture(self, directory: str, fixture: str) -> Path:
        path = Path(directory) / f"{fixture}-business-day.ts"
        path.write_text(FIXTURES[fixture], encoding="utf-8")
        return path

    def test_a_failing_fixture_exits_non_zero_with_a_usable_message(self):
        with tempfile.TemporaryDirectory(prefix="holiday-coverage-") as directory:
            path = self.write_fixture(directory, "FX-250-01")
            result = self.run_guard("--source", str(path), "--year", str(NOW))
            self.assertEqual(result.returncode, 1)
            self.assertIn("HOLIDAY-COVERAGE", result.stdout)
            self.assertIn("coverage_horizon_is_clear", result.stdout)
            # The three things the reader needs: what ran out, when, and what
            # to do about it.
            self.assertIn(f"ends after {NOW + LEAD - 1}", result.stdout)
            self.assertIn(str(NOW + LEAD), result.stdout)
            self.assertIn("extend the calendar", result.stdout)
            self.assertIn("DIAGNOSTIC RUN", result.stdout)

    def test_the_restored_fixture_exits_zero(self):
        with tempfile.TemporaryDirectory(prefix="holiday-coverage-") as directory:
            path = self.write_fixture(directory, "FX-250-02")
            result = self.run_guard("--source", str(path), "--year", str(NOW))
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("Holiday coverage clear", result.stdout)

    def test_a_missing_source_fails_rather_than_checking_nothing(self):
        with tempfile.TemporaryDirectory(prefix="holiday-coverage-") as directory:
            result = self.run_guard("--source", str(Path(directory) / "absent.ts"))
            self.assertEqual(result.returncode, 1)
            self.assertIn("does not exist", result.stdout)

    def test_the_default_source_is_the_domain_calendar(self):
        """No --source: the guard reads the file the workflow cares about.

        Pinned to a year before the horizon so the assertion is about which
        file was read, not about how much coverage is left.
        """
        calendar, _ = guard.parse_calendar(REAL_SOURCE)
        result = self.run_guard("--year", str(calendar.first_uncovered_year - LEAD - 1))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn(guard.DEFAULT_SOURCE.as_posix(), result.stdout)
        self.assertIn("Holiday coverage clear", result.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
