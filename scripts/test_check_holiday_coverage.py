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
    FX-250-03  bound well clear of the boundary   expect PASS  (clear)
    FX-250-04  bound at year - 1                 expect FAIL  (already uncovered)
    FX-250-05  calendar literal renamed          expect FAIL  (unreadable)
    FX-250-06  bounds transposed                 expect FAIL  (incoherent range)
    FX-250-07  bound raised, datasetVersion stale expect FAIL (unverified bound)
    FX-250-08  uncovered-year throw deleted      expect FAIL  (refusal lost)
    FX-250-09  predicate upper bound dropped     expect FAIL  (refusal one-sided)
    FX-250-10  the real file, unmodified         expect PASS
    FX-250-11  uncovered-year throw commented out expect FAIL (refusal only in a comment)
    FX-250-12  bound+dataset raised, verifiedOn stale expect FAIL (unverified despite matching numbers)
    FX-250-13  bound+dataset raised, verifiedOn updated expect PASS (genuinely re-verified)

FX-250-01 and FX-250-02 are the load-bearing pair for CBD-250-AC01: they sit
either side of the single year where the horizon condition changes its answer.
Both are computed from `guard.LEAD_TIME_YEARS` rather than written as years,
so they followed the constant unchanged when the settled product horizon moved
it from 2 to 3. `HorizonBoundaryTests` records both rulings behind them, and
`GuardStructureTests.test_the_lead_time_matches_its_recorded_derivation` is
what stops the constant moving without its derivation moving too.

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

# Compiled from the source text rather than run through `_spec.loader`, which
# would consult __pycache__. That cache decides a .pyc is current by comparing
# the source's mtime and SIZE, and the mutation testing this suite exists to
# support routinely changes one character -- LEAD_TIME_YEARS 3 to 4, `<` to
# `<=`. Those edits leave the size identical, and a mutate-run-restore cycle
# can complete inside one mtime tick, so the loader serves the stale bytecode
# and the run silently measures the previous revision. That happened here: a
# harness run reported a guard restored byte-identical on disk while the next
# process still imported the mutant. A test suite that can read a different
# revision than the one on disk cannot prove anything about the one on disk.
#
# Only this test path was affected. The guard runs as __main__ from the
# command line and in the workflow, and __main__ is never cached.
exec(compile(SCRIPT.read_text(encoding="utf-8"), str(SCRIPT), "exec"), guard.__dict__)

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


def with_reverified_bound(through: int, verified_on: str | None = None) -> str:
    """FX-250-12/13: verifiedThrough and datasetVersion raised together.

    `verifiedFrom` is untouched -- this fixture exists to isolate
    `verified_on_moves_with_the_bounds`, so it must stay out of
    `verified_range_is_coherent` and `dataset_version_names_the_verified_range`
    (the raised bound and the raised dataset version agree with each other)
    and out of `coverage_horizon_is_clear` (`through` is anchored past the
    horizon by the caller). `verified_on` of None leaves `verifiedOn`
    unchanged from the real file, which is the defect; a real date there is
    the fix.
    """
    source = substitute(REAL_SOURCE, r"verifiedThrough: \d+,", f"verifiedThrough: {through},")
    source = substitute(source, r'datasetVersion: "frfs-\d+-\d+",',
                        f'datasetVersion: "frfs-{REAL_CALENDAR.verified_from}-{through}",')
    if verified_on is not None:
        source = substitute(source, r'verifiedOn: toISODate\("[\d-]+"\),',
                            f'verifiedOn: toISODate("{verified_on}"),')
    return source


# Anchored the same way as FX-250-03: past the later of today and the real
# bound, so it stays clear of the horizon condition whatever LEAD_TIME_YEARS
# is or whenever the calendar is extended.
_REVERIFY_THROUGH = max(NOW, REAL_CALENDAR.verified_through) + LEAD + 4

FIXTURES: dict[str, str] = {
    "FX-250-01": with_bound(NOW + LEAD - 1),
    "FX-250-02": with_bound(NOW + LEAD),
    # Well clear of the boundary, and deliberately NOT `NOW + LEAD + 1`.
    # That offset collided with the real bound the moment LEAD_TIME_YEARS
    # moved from 2 to 3 -- 2026 + 3 + 1 is 2030, which is exactly what the
    # calendar declares, so the fixture became a byte-identical copy of
    # FX-250-10 and asserted nothing while still passing. Anchoring past the
    # later of today and the real bound keeps it distinct whatever the
    # constant is and whenever the calendar is extended, which matters
    # because extending the calendar is the very action this guard demands.
    "FX-250-03": with_bound(max(NOW, REAL_CALENDAR.verified_through) + LEAD + 2),
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
    # The refusal text is still in the file, but commented out: a raw
    # substring test would read this as a live throw. Finding 7.
    "FX-250-11": substitute(
        REAL_SOURCE, r"throw new HolidayCoverageError\(year\);",
        "// throw new HolidayCoverageError(year); // TODO re-enable"),
    # Bound and dataset version raised together, consistently -- but
    # verifiedOn left exactly as it was. Finding 6.
    "FX-250-12": with_reverified_bound(_REVERIFY_THROUGH),
    "FX-250-13": with_reverified_bound(_REVERIFY_THROUGH, verified_on="2030-06-01"),
}

# Baselines for the one condition that compares two revisions instead of
# reading a single file: `verified_on_moves_with_the_bounds`. Every other
# fixture leaves this at None, which is exactly the "no prior revision" case
# the condition treats as silence rather than a finding.
BASELINES: dict[str, "guard.Calendar"] = {
    "FX-250-12": REAL_CALENDAR,
    "FX-250-13": REAL_CALENDAR,
}

# What each fixture is for. Also the vacuity check below.
MUST_FAIL = ("FX-250-01", "FX-250-04", "FX-250-05", "FX-250-06",
             "FX-250-07", "FX-250-08", "FX-250-09", "FX-250-11", "FX-250-12")
MUST_PASS = ("FX-250-02", "FX-250-03", "FX-250-10", "FX-250-13")

# A fixture that is supposed to carry a defect must not be a copy of the clean
# file. `substitute()` catches a pattern that stopped matching; it cannot catch
# an offset that happens to land on the value already there -- FX-250-03 became
# a byte-identical copy of FX-250-10 the moment the lead time moved from 2 to
# 3, because 2026 + 3 + 1 is exactly the 2030 the calendar declares. It kept
# passing and stopped proving anything.
#
# Only the must-fail fixtures are checked. A must-pass fixture coinciding with
# the real file is uninformative but not unsound -- the boundary fixture is
# entitled to land on the real bound -- and making that fatal would take the
# whole suite down at import over a harmless coincidence, which is a worse
# failure than the one it prevents.
_VACUOUS = [name for name in MUST_FAIL if FIXTURES[name] == REAL_SOURCE]
if _VACUOUS:
    raise AssertionError(
        f"{', '.join(_VACUOUS)} is byte-identical to the unmodified calendar but is "
        "meant to carry a defect, so it proves nothing. Re-anchor it away from the "
        "value the calendar currently declares.")

# Which condition each failing fixture exists to exercise. This mapping is what
# LoadBearingTests removes from the registry, one entry at a time.
CONDITION_FIXTURES: dict[str, str] = {
    "calendar_literal_is_readable": "FX-250-05",
    "verified_range_is_coherent": "FX-250-06",
    "dataset_version_names_the_verified_range": "FX-250-07",
    "verified_on_moves_with_the_bounds": "FX-250-12",
    "uncovered_years_are_still_refused": "FX-250-08",
    "coverage_horizon_is_clear": "FX-250-01",
}


def findings_for(fixture: str, year: int = NOW) -> list:
    return guard.evaluate(guard.subject_for(
        FIXTURES[fixture], year, fixture, baseline=BASELINES.get(fixture)))


class GuardStructureTests(unittest.TestCase):
    """The registry and the fixture set must stay in step with each other."""

    def test_every_registered_condition_has_a_fixture(self):
        registered = [condition.__name__ for condition in guard.CONDITIONS]
        self.assertEqual(sorted(registered), sorted(CONDITION_FIXTURES),
                         "a condition was added to or removed from the guard without "
                         "a fixture proving it is load-bearing")

    def test_the_lead_time_matches_its_recorded_derivation(self):
        """The constant is derived, so it must not drift away from its derivation.

        This pin is meant to be *updated*, not deleted. It fails loudly with
        the arithmetic and the decision behind it, so anyone moving the number
        has to say which term changed. Every other expectation in this suite
        is computed from the constant and will follow it silently; this is the
        one place that notices.
        """
        product_horizon_years = 2   # 24-month forward view, Executive, 2026-09-12
        owner_action_years = 1      # extend, verify, review, merge (CBD-68 10.3)
        self.assertEqual(
            LEAD, product_horizon_years + owner_action_years,
            "LEAD_TIME_YEARS no longer matches its recorded derivation.\n"
            "\n"
            "    lead time = (longest forward product horizon in years, rounded up)\n"
            "                + 1 year of owner action time\n"
            f"              = {product_horizon_years} + {owner_action_years} "
            f"= {product_horizon_years + owner_action_years}\n"
            f"    LEAD_TIME_YEARS is currently {LEAD}\n"
            "\n"
            "The first term is the product's longest forward projection horizon,\n"
            "settled by the Executive on 2026-09-12 at 24 months. It is the product\n"
            "horizon and not the uncovered year because assertHorizonCovered throws\n"
            "on ANY uncovered year inside a requested horizon, so a user is blocked\n"
            "a full horizon before the uncovered year arrives.\n"
            "\n"
            "A change is legitimate only if one of those two terms changed -- in\n"
            "practice, the product horizon moving. If it did: update the numbers in\n"
            "this test, the derivation beside LEAD_TIME_YEARS in\n"
            "check-holiday-coverage.py, the note in HorizonBoundaryTests, the\n"
            "coverage_horizon_is_clear docstring in check-holiday-coverage.py, and the\n"
            "cron comment in .github/workflows/holiday-coverage.yml, and record who\n"
            "decided and when. Two of those five sites were missed the last time this\n"
            "constant moved (CBD250-CORRECTION-002) -- both still named the old lead\n"
            "time and a year computed from it after the constant changed, which is\n"
            "exactly the drift this list exists to stop. If it did not, the constant\n"
            "is wrong, not this test: lowering it spends the notice the guard exists\n"
            "to create and raising it fires against years the Federal Reserve has\n"
            "not published.")

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

    Two rulings sit behind these fixtures, and they are independent of each
    other. AC01 and AC02 contradicted each other as drafted, and the
    Executive ruled AC02 the drafting error -- AC02 never stated a lead time,
    so correcting AC01 to match a number AC02 only implied would have
    ratified an off-by-one as policy. AC02's text was corrected to express
    its fixtures against the constant rather than in absolute relative years.

    Separately, and afterwards, the Executive settled the product's longest
    forward horizon at 24 months, which is the open first term of the
    derivation recorded beside `LEAD_TIME_YEARS`. That moved the constant
    from 2 to 3. It did not reverse the AC02 ruling: the constant moved
    because a product decision fed the derivation, not because AC02 won. The
    corrected AC02 text survives the change unaltered, which is exactly why
    it was phrased against the constant.

    Nothing here is pinned to a year. Every expectation in this class is
    computed from `guard.LEAD_TIME_YEARS`, which is why the move from 2 to 3
    flipped no expectation -- FX-250-01 and FX-250-02 simply follow the
    boundary. `test_the_boundary_moves_with_the_lead_time_and_nothing_else`
    is what makes that safe, and
    `GuardStructureTests.test_the_lead_time_matches_its_recorded_derivation`
    is what stops the constant moving without the derivation moving with it.
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

    def test_fx_250_11_a_commented_out_throw_is_not_a_live_refusal(self):
        """Finding 7: a raw substring match would have missed this."""
        findings = self.assert_only("FX-250-11", "uncovered_years_are_still_refused")
        self.assertIn("nothing throws", findings[0].problem)

    def test_fx_250_12_a_raised_bound_with_a_stale_verified_on_is_caught(self):
        """Finding 6: the bound and dataset version agree, but nobody re-checked."""
        findings = self.assert_only("FX-250-12", "verified_on_moves_with_the_bounds")
        self.assertIn("verifiedThrough moved", findings[0].problem)
        self.assertIn(REAL_CALENDAR.verified_on, findings[0].problem)

    def test_fx_250_13_a_raised_bound_with_a_fresh_verified_on_passes(self):
        self.assertEqual(findings_for("FX-250-13"), [])

    def test_verified_on_moves_with_the_bounds_is_silent_without_a_baseline(self):
        """No prior revision to compare against means no finding, not a guess.

        This is the condition function in isolation. Whether an owner actually
        sees that this run could not look -- the skip line -- is proved
        end to end in CommandLineTests, because that line is printed by
        main(), not by this function.
        """
        self.assertEqual(
            guard.evaluate(guard.subject_for(FIXTURES["FX-250-12"], NOW, "no-baseline")),
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

    def test_a_commented_out_throw_exits_non_zero(self):
        """Finding 7, end to end: a raw substring match would exit 0 here."""
        with tempfile.TemporaryDirectory(prefix="holiday-coverage-") as directory:
            path = self.write_fixture(directory, "FX-250-11")
            result = self.run_guard("--source", str(path), "--year", str(NOW))
            self.assertEqual(result.returncode, 1)
            self.assertIn("nothing throws", result.stdout)

    def run_git(self, *args, cwd: Path):
        return subprocess.run(
            ["git", *args], cwd=cwd, capture_output=True, text=True, encoding="utf-8",
            timeout=30, check=True)

    def make_baseline_repo(self, directory: str) -> tuple[Path, Path, str]:
        """A one-commit throwaway repository holding the real calendar.

        Returns the repo root, the tracked file's path, and the baseline
        commit's SHA -- the ref every push-path test below diffs against.
        """
        repo = Path(directory)
        self.run_git("init", "--quiet", cwd=repo)
        self.run_git("config", "user.email", "guard@example.invalid", cwd=repo)
        self.run_git("config", "user.name", "Guard Test", cwd=repo)

        source_path = repo / "business-day.ts"
        source_path.write_text(REAL_SOURCE, encoding="utf-8")
        self.run_git("add", "business-day.ts", cwd=repo)
        self.run_git("commit", "--quiet", "-m", "baseline", cwd=repo)
        base_sha = self.run_git("rev-parse", "HEAD", cwd=repo).stdout.strip()
        return repo, source_path, base_sha

    def test_a_raised_bound_without_reverification_is_caught_by_the_local_convenience(self):
        """Finding 6, through the previous-commit convenience `main()` falls
        back to with neither --base-ref nor --no-baseline-check.

        `verified_on_moves_with_the_bounds` only has something to compare
        against inside a git working tree, so this is the one condition that
        cannot be proved with a bare --source file the way every other
        fixture is. Building a throwaway repository is what actually exercises
        `previous_calendar`, not just the condition function in isolation.
        """
        with tempfile.TemporaryDirectory(prefix="holiday-coverage-git-") as directory:
            repo, source_path, _base_sha = self.make_baseline_repo(directory)

            # Deliberate violation: bound and dataset version raised together,
            # verifiedOn left untouched -- uncommitted, exactly like a working
            # change nobody has finished yet.
            source_path.write_text(FIXTURES["FX-250-12"], encoding="utf-8")
            result = self.run_guard("--source", str(source_path), "--year", str(NOW))
            self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
            self.assertIn("verified_on_moves_with_the_bounds", result.stdout)
            self.assertIn("verifiedThrough moved", result.stdout)

            # Restore: verifiedOn now moves with the bound.
            source_path.write_text(FIXTURES["FX-250-13"], encoding="utf-8")
            result = self.run_guard("--source", str(source_path), "--year", str(NOW))
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("Holiday coverage clear", result.stdout)

    def test_a_raised_bound_without_reverification_is_caught_on_the_push_path(self):
        """Finding 6 and F3, through the explicit --base-ref path a real push
        run takes -- comparing against the base of the change, not merely the
        previous commit touching the file.

        Two commits after the baseline: the first repeats F3's failure mode
        (bound and dataset raised together, verifiedOn stale) committed on its
        own, and the second is the fix. Both are compared against the same
        base ref, exactly as a push workflow diffs the whole range of pushed
        commits against the state before the push -- not each commit against
        its own immediate parent, which is what let a push land a raised bound
        in one commit and an unrelated comment edit in the next and pass.
        """
        with tempfile.TemporaryDirectory(prefix="holiday-coverage-git-") as directory:
            repo, source_path, base_sha = self.make_baseline_repo(directory)

            source_path.write_text(FIXTURES["FX-250-12"], encoding="utf-8")
            self.run_git("commit", "-aqm", "raise bound without reverifying", cwd=repo)
            result = self.run_guard("--source", str(source_path), "--year", str(NOW),
                                    "--base-ref", base_sha)
            self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
            self.assertIn(f"baseline: {base_sha}", result.stdout)
            self.assertIn("verified_on_moves_with_the_bounds", result.stdout)
            self.assertIn("verifiedThrough moved", result.stdout)

            source_path.write_text(FIXTURES["FX-250-13"], encoding="utf-8")
            self.run_git("commit", "-aqm", "reverify and record it", cwd=repo)
            result = self.run_guard("--source", str(source_path), "--year", str(NOW),
                                    "--base-ref", base_sha)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn(f"baseline: {base_sha}", result.stdout)
            self.assertIn("Holiday coverage clear", result.stdout)

    def test_an_unreadable_base_ref_on_the_push_path_is_a_finding_not_a_skip(self):
        """F1/(4): a push run declares a comparison is possible; failing to
        produce one must fail the run, not pass it quietly."""
        with tempfile.TemporaryDirectory(prefix="holiday-coverage-git-") as directory:
            _repo, source_path, _base_sha = self.make_baseline_repo(directory)
            bogus_ref = "0123456789abcdef0123456789abcdef01234567"
            result = self.run_guard("--source", str(source_path), "--year", str(NOW),
                                    "--base-ref", bogus_ref)
            self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
            self.assertIn("base_ref_is_readable", result.stdout)
            self.assertIn("skipped: no baseline", result.stdout)
            self.assertIn(bogus_ref, result.stdout)

    def test_schedule_and_dispatch_runs_declare_the_baseline_not_applicable(self):
        """(2): no push event means nothing to diff, stated up front rather
        than silently treated as clean."""
        with tempfile.TemporaryDirectory(prefix="holiday-coverage-git-") as directory:
            _repo, source_path, _base_sha = self.make_baseline_repo(directory)
            result = self.run_guard("--source", str(source_path), "--year", str(NOW),
                                    "--no-baseline-check")
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("not applicable", result.stdout)
            self.assertIn("verified_on_moves_with_the_bounds", result.stdout)
            self.assertIn("Holiday coverage clear", result.stdout)
            self.assertNotIn("skipped: no baseline", result.stdout)

    def test_verified_on_moves_with_the_bounds_prints_a_skip_line_without_a_baseline(self):
        """(3), replacing the silent assertion this fixture used to be proved
        by: with no --base-ref and no --no-baseline-check, a --source outside
        any git working tree cannot look, and must say so distinctly rather
        than printing the same thing a checked-and-clean run would."""
        with tempfile.TemporaryDirectory(prefix="holiday-coverage-") as directory:
            path = self.write_fixture(directory, "FX-250-12")
            result = self.run_guard("--source", str(path), "--year", str(NOW))
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("skipped: no baseline", result.stdout)
            self.assertNotIn("verified_on_moves_with_the_bounds", result.stdout)

        # Contrast with a genuinely checked-and-clean run of the very same
        # defect, baseline present: that run must neither say "skipped" nor
        # stay silent about the condition -- it reports the finding.
        with tempfile.TemporaryDirectory(prefix="holiday-coverage-git-") as directory:
            repo, source_path, base_sha = self.make_baseline_repo(directory)
            source_path.write_text(FIXTURES["FX-250-12"], encoding="utf-8")
            self.run_git("commit", "-aqm", "raise bound without reverifying", cwd=repo)
            checked_result = self.run_guard("--source", str(source_path), "--year", str(NOW),
                                            "--base-ref", base_sha)
            self.assertEqual(checked_result.returncode, 1,
                             checked_result.stdout + checked_result.stderr)
            self.assertNotIn("skipped: no baseline", checked_result.stdout)
            self.assertIn("verified_on_moves_with_the_bounds", checked_result.stdout)
            self.assertNotEqual(result.stdout, checked_result.stdout,
                               "a could-not-check run must not read identically to a "
                               "checked run of the same defect")

    def test_the_default_source_is_the_domain_calendar(self):
        """No --source: the guard reads the file the workflow cares about.

        Pinned to a year before the horizon so the assertion is about which
        file was read, not about how much coverage is left. Finding F6:
        --no-baseline-check makes this independent of the ambient
        checkout's git history and clone depth -- without it, this test's
        outcome depended on whatever commit history happened to be present
        for business-day.ts in whichever tree it ran from, which is not what
        it is testing.
        """
        calendar, _ = guard.parse_calendar(REAL_SOURCE)
        result = self.run_guard("--year", str(calendar.first_uncovered_year - LEAD - 1),
                                "--no-baseline-check")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn(guard.DEFAULT_SOURCE.as_posix(), result.stdout)
        self.assertIn("Holiday coverage clear", result.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
