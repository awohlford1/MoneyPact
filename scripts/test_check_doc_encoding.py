"""Prove check-doc-encoding.py by breaking what it protects.

Every fixture here is written into a temp directory and nowhere else. A
deliberately corrupt document must never exist inside docs/, or the repository
carries the defect the guard exists to catch for as long as the test runs.

The fixtures are the real defect, not a stand-in for it: cp1252 punctuation in
a heading -- `# CBD13-SOURCES-001 <0x97> Architecture` -- which is what an
editor defaulting to the Windows code page produces, and what made
check-doc-vocabulary.py die with a UnicodeDecodeError that named no file.

Two of these tests exist because of a specific way this guard has already been
wrong. `test_large_dense_file_finishes` pins the fix for a re-decoding loop
that did not finish a 5 MB file in sixty seconds -- an unbounded CI step, which
is a worse failure than the traceback the guard replaced. `test_wide_encodings`
pins the diagnosis and the remedy, not merely that the file is named: an
earlier version called a UTF-16 file's byte-order mark a stray cp1252
character, and following its advice would have corrupted the file further.
"""

import importlib.util
import io
import random
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parent / "check-doc-encoding.py"

# The heading from the records that motivated this guard. The dash is U+2014,
# which cp1252 encodes as the single byte 0x97 and UTF-8 as three bytes.
HEADING = "# CBD13-SOURCES-001 — Architecture"
BODY = HEADING + "\n\nOne ordinary ASCII paragraph.\n"

BOM = "\ufeff"  # written as an escape so the constant is visible in a diff

# The guard's filename is hyphenated, so it is loaded by path for the few
# assertions that are about a function rather than about the command.
_spec = importlib.util.spec_from_file_location("check_doc_encoding", SCRIPT)
guard = importlib.util.module_from_spec(_spec)
# Registered before execution: @dataclass resolves its annotations through
# sys.modules, and fails on a module that is not there yet.
sys.modules[_spec.name] = guard
_spec.loader.exec_module(guard)


class CheckDocEncodingTests(unittest.TestCase):
    def run_guard(self, root, *args):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--path", str(root), *args],
            capture_output=True, encoding="utf-8", errors="replace", timeout=60)
        # A guard that dies is the defect, not the check. Any traceback here
        # means the script crashed on a document instead of reporting it.
        self.assertNotIn("Traceback", result.stdout + result.stderr)
        return result

    def test_cp1252_document_fails_and_the_utf8_equivalent_passes(self):
        with tempfile.TemporaryDirectory(prefix="doc-encoding-") as directory:
            root = Path(directory)
            document = root / "cbd13-sources-001.md"

            document.write_bytes(BODY.encode("cp1252"))
            # The fixture is genuinely what breaks the sibling checker: the same
            # call check-doc-vocabulary.py makes must raise on it.
            with self.assertRaises(UnicodeDecodeError):
                document.read_text(encoding="utf-8")

            result = self.run_guard(root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("0x97", result.stdout)
            # Line, column, byte offset and enough text to find the character.
            # The em dash is the 21st character of the heading, so a reader
            # counting columns in an editor lands on it.
            offset = BODY.encode("cp1252").index(b"\x97")
            self.assertIn("cbd13-sources-001.md:1:21", result.stdout)
            self.assertIn(f"byte offset : {offset}", result.stdout)
            self.assertIn("CBD13-SOURCES-001", result.stdout)
            self.assertIn("EM DASH", result.stdout)
            self.assertIn("re-save the file as UTF-8", result.stdout)

            document.write_bytes(BODY.encode("utf-8"))
            result = self.run_guard(root)
            self.assertEqual(result.returncode, 0)
            self.assertIn("No encoding drift.", result.stdout)
            self.assertIn("1 document(s) checked", result.stdout)

    def test_crlf_line_endings_do_not_shift_lines_or_leak_into_context(self):
        with tempfile.TemporaryDirectory(prefix="doc-encoding-") as directory:
            root = Path(directory)
            document = root / "crlf.md"
            text = HEADING + "\r\n\r\nSecond ’paragraph’ here.\r\n"
            document.write_bytes(text.encode("cp1252"))

            result = self.run_guard(root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("crlf.md:1:21", result.stdout)
            # Line 3 under CRLF, not line 2 and not line 5.
            self.assertIn("crlf.md:3:8", result.stdout)
            self.assertIn("0x92", result.stdout)
            # A carriage return in the context line would break the report's
            # own formatting; the guard strips it.
            for line in result.stdout.splitlines():
                self.assertNotIn("\r", line)
            self.assertIn("Second [", result.stdout)

            document.write_bytes(text.encode("utf-8"))
            result = self.run_guard(root)
            self.assertEqual(result.returncode, 0)
            self.assertIn("No encoding drift.", result.stdout)

    def test_leading_bom_fails_and_passes_once_removed(self):
        with tempfile.TemporaryDirectory(prefix="doc-encoding-") as directory:
            root = Path(directory)
            document = root / "cbd13-sources-002.md"

            document.write_bytes((BOM + BODY).encode("utf-8"))
            # A BOM decodes cleanly, so nothing downstream raises; only this
            # guard notices that the title heading is no longer a heading.
            self.assertTrue(document.read_text(encoding="utf-8").startswith(BOM))

            result = self.run_guard(root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("cbd13-sources-002.md:1:1", result.stdout)
            self.assertIn("BOM", result.stdout)
            self.assertIn("U+FEFF", result.stdout)
            self.assertIn("strip the leading 0xef 0xbb 0xbf", result.stdout)

            document.write_bytes(BODY.encode("utf-8"))
            result = self.run_guard(root)
            self.assertEqual(result.returncode, 0)
            self.assertIn("No encoding drift.", result.stdout)

    def test_every_offending_file_is_named_in_one_run(self):
        """The defect being guarded against is stopping at the first file."""
        with tempfile.TemporaryDirectory(prefix="doc-encoding-") as directory:
            root = Path(directory)
            (root / "records").mkdir()
            broken = ["a-first.md", "records/b-second.md", "records/c-third.md"]
            for name in broken:
                (root / name).write_bytes(BODY.encode("cp1252"))
            (root / "records/d-bom.md").write_bytes((BOM + BODY).encode("utf-8"))
            (root / "z-clean.md").write_bytes(BODY.encode("utf-8"))
            # Not a Markdown document, and not this guard's business.
            (root / "notes.txt").write_bytes(BODY.encode("cp1252"))

            result = self.run_guard(root)
            self.assertEqual(result.returncode, 1)
            for name in broken:
                self.assertIn(Path(name).name, result.stdout)
            self.assertIn("d-bom.md", result.stdout)
            self.assertNotIn("z-clean.md", result.stdout)
            self.assertNotIn("notes.txt", result.stdout)
            self.assertIn("in 4 file(s)", result.stdout)
            self.assertIn("5 document(s) checked", result.stdout)

            for name in broken:
                (root / name).write_bytes(BODY.encode("utf-8"))
            (root / "records/d-bom.md").write_bytes(BODY.encode("utf-8"))
            result = self.run_guard(root)
            self.assertEqual(result.returncode, 0)
            self.assertIn("No encoding drift.", result.stdout)

    def test_every_bad_byte_in_a_file_is_located_and_the_rest_capped(self):
        with tempfile.TemporaryDirectory(prefix="doc-encoding-") as directory:
            root = Path(directory)
            document = root / "many.md"
            lines = [HEADING, "", "Quote ’s and an en dash – here.", ""]
            document.write_bytes("\n".join(lines).encode("cp1252"))

            result = self.run_guard(root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("0x97", result.stdout)   # em dash, line 1
            self.assertIn("0x92", result.stdout)   # right single quote, line 3
            self.assertIn("0x96", result.stdout)   # en dash, line 3
            self.assertIn("many.md:1:21", result.stdout)
            self.assertIn("many.md:3:7", result.stdout)
            self.assertEqual(result.stdout.count("ENCODING "), 3)

            # Past the per-file cap the findings are counted, never dropped.
            document.write_bytes(("— " * 25).encode("cp1252"))
            result = self.run_guard(root)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(result.stdout.count("ENCODING "), 10)
            self.assertIn("15 further undecodable byte sequence(s)", result.stdout)
            self.assertIn("25 finding(s) in 1 file(s)", result.stdout)

            document.write_bytes(("— " * 25).encode("utf-8"))
            self.assertEqual(self.run_guard(root).returncode, 0)

    def test_wide_encodings_are_diagnosed_as_themselves_not_as_stray_bytes(self):
        """A UTF-16 file is intact text in another encoding, not damaged UTF-8.

        Naming the file is not enough. An earlier version of this guard called
        the byte-order mark an invalid byte and told the author to keep "the
        character cp1252 reads there" -- following that advice corrupts the
        file. The remedy has to be right, so the remedy is what is asserted.
        """
        cases = [("utf-16-le", "UTF-16-LE"), ("utf-16-be", "UTF-16-BE"),
                 ("utf-32-le", "UTF-32-LE"), ("utf-32-be", "UTF-32-BE")]
        with tempfile.TemporaryDirectory(prefix="doc-encoding-") as directory:
            root = Path(directory)
            document = root / "wide.md"
            for codec, label in cases:
                with self.subTest(encoding=label):
                    # Write the BOM explicitly: the "-le"/"-be" codecs omit it.
                    mark = {"UTF-16-LE": b"\xff\xfe", "UTF-16-BE": b"\xfe\xff",
                            "UTF-32-LE": b"\xff\xfe\x00\x00",
                            "UTF-32-BE": b"\x00\x00\xfe\xff"}[label]
                    document.write_bytes(mark + BODY.encode(codec))

                    result = self.run_guard(root)
                    self.assertEqual(result.returncode, 1)
                    self.assertIn("wide.md:1:1", result.stdout)
                    self.assertIn(f"{label} byte-order mark", result.stdout)
                    self.assertIn(f"the whole file is {label}, not UTF-8", result.stdout)
                    self.assertIn(f"iconv -f {label} -t UTF-8", result.stdout)
                    # One finding about the file, not a catalogue of its bytes,
                    # and no cp1252 reading of a mark that is not cp1252.
                    self.assertEqual(result.stdout.count("ENCODING "), 1)
                    self.assertNotIn("cp1252", result.stdout)
                    self.assertIn("1 finding(s) in 1 file(s)", result.stdout)
                    # The excerpt is decoded in the file's own encoding, so the
                    # author sees their heading rather than a column of nulls,
                    # and no raw control byte reaches the terminal.
                    self.assertIn("# CBD13-SOURCES-001", result.stdout)
                    self.assertNotIn("\x00", result.stdout)

            document.write_bytes(BODY.encode("utf-8"))
            result = self.run_guard(root)
            self.assertEqual(result.returncode, 0)
            self.assertIn("No encoding drift.", result.stdout)

    def test_a_single_file_as_path_is_scanned_rather_than_silently_skipped(self):
        """Pointing the guard at one file must not pass by checking nothing."""
        with tempfile.TemporaryDirectory(prefix="doc-encoding-") as directory:
            document = Path(directory) / "bad.md"
            document.write_bytes(BODY.encode("cp1252"))

            result = self.run_guard(document)
            self.assertEqual(result.returncode, 1)
            self.assertIn("bad.md:1:21", result.stdout)
            self.assertIn("1 document(s) checked", result.stdout)

            document.write_bytes(BODY.encode("utf-8"))
            result = self.run_guard(document)
            self.assertEqual(result.returncode, 0)
            self.assertIn("1 document(s) checked", result.stdout)
            self.assertIn("No encoding drift.", result.stdout)

    def test_scanning_nothing_fails_rather_than_passing_silently(self):
        with tempfile.TemporaryDirectory(prefix="doc-encoding-") as directory:
            root = Path(directory)
            (root / "notes.txt").write_bytes(BODY.encode("utf-8"))
            result = self.run_guard(root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("0 document(s) checked", result.stdout)
            self.assertIn("Nothing to check", result.stdout)
            self.assertNotIn("No encoding drift.", result.stdout)

    def test_an_unreadable_file_is_a_finding_not_a_crash(self):
        """A locked or vanished file must not stop the run either.

        Reading a directory is the portable way to make read_bytes() raise:
        IsADirectoryError on POSIX, PermissionError on Windows, both OSError,
        which is the same class an editor's exclusive lock produces.
        """
        with tempfile.TemporaryDirectory(prefix="doc-encoding-") as directory:
            unreadable = Path(directory)
            with self.assertRaises(OSError):
                unreadable.read_bytes()

            findings, suppressed = guard.scan_file(unreadable)
            self.assertEqual(suppressed, 0)
            self.assertEqual([finding.kind for finding in findings], ["unreadable"])
            self.assertIn("cannot be read", findings[0].detail)

            # And end to end: exit 1, a named file, no traceback.
            output = io.StringIO()
            with patch.object(guard, "documents", return_value=[unreadable]), \
                    patch.object(guard.sys, "argv", ["check-doc-encoding.py"]), \
                    redirect_stdout(output):
                status = guard.main()
            self.assertEqual(status, 1)
            self.assertIn("UNREADABLE", output.getvalue())
            self.assertIn(unreadable.name, output.getvalue())
            self.assertIn("1 finding(s) in 1 file(s)", output.getvalue())

    def test_large_dense_file_finishes(self):
        """A 5 MB pseudo-binary *.md must be reported, not hang the pipeline.

        The re-decoding loop this replaced copied the remaining tail on every
        error run -- O(k*n) -- and did not finish this fixture in sixty
        seconds. CI has no per-step timeout, so that was an unbounded step.
        """
        with tempfile.TemporaryDirectory(prefix="doc-encoding-") as directory:
            root = Path(directory)
            # Seeded, and prefixed with ASCII so the random bytes can never
            # accidentally open with a UTF-16 or UTF-32 byte-order mark.
            payload = b"# Notes\n" + random.Random(20260905).randbytes(5 * 1024 * 1024)
            (root / "big.md").write_bytes(payload)

            started = time.monotonic()
            result = self.run_guard(root)   # subprocess timeout=60 fails the test
            elapsed = time.monotonic() - started

            self.assertEqual(result.returncode, 1)
            self.assertLess(elapsed, 30, f"took {elapsed:.1f}s; the O(k*n) loop is back")
            self.assertEqual(result.stdout.count("ENCODING "), 10)
            self.assertIn("further undecodable byte sequence(s)", result.stdout)

    def test_missing_path_is_refused(self):
        with tempfile.TemporaryDirectory(prefix="doc-encoding-") as directory:
            missing = Path(directory) / "absent"
            result = self.run_guard(missing)
            self.assertEqual(result.returncode, 1)
            self.assertIn("No such path", result.stderr)


if __name__ == "__main__":
    unittest.main()
