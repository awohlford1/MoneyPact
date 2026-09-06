"""Prove check-doc-encoding.py by breaking what it protects.

Every fixture here is written into a temp directory and nowhere else. A
deliberately corrupt document must never exist inside docs/, or the repository
carries the defect the guard exists to catch for as long as the test runs.

The fixtures are the real defect, not a stand-in for it: cp1252 punctuation in
a heading -- `# CBD13-SOURCES-001 <0x97> Architecture` -- which is what an
editor defaulting to the Windows code page produces, and what made
check-doc-vocabulary.py die with a UnicodeDecodeError that named no file.
"""

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

SCRIPT = Path(__file__).resolve().parent / "check-doc-encoding.py"

# The heading from the records that motivated this guard. The dash is U+2014,
# which cp1252 encodes as the single byte 0x97 and UTF-8 as three bytes.
HEADING = "# CBD13-SOURCES-001 — Architecture"
BODY = HEADING + "\n\nOne ordinary ASCII paragraph.\n"

BOM = "\ufeff"  # written as an escape so the constant is visible in a diff


class CheckDocEncodingTests(unittest.TestCase):
    def run_guard(self, root, *args):
        result = subprocess.run(
            [sys.executable, str(SCRIPT), "--path", str(root), *args],
            capture_output=True, encoding="utf-8", errors="replace")
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
            self.assertIn("cbd13-sources-001.md", result.stdout)
            self.assertIn("0x97", result.stdout)
            # Line, byte offset and enough text to find the character.
            offset = BODY.encode("cp1252").index(b"\x97")
            self.assertIn("cbd13-sources-001.md:1:", result.stdout)
            self.assertIn(f"byte offset : {offset}", result.stdout)
            self.assertIn("CBD13-SOURCES-001", result.stdout)
            self.assertIn("EM DASH", result.stdout)

            document.write_bytes(BODY.encode("utf-8"))
            result = self.run_guard(root)
            self.assertEqual(result.returncode, 0)
            self.assertIn("No encoding drift.", result.stdout)
            self.assertIn("1 document(s) checked", result.stdout)

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
            self.assertIn("many.md:1:", result.stdout)
            self.assertIn("many.md:3:", result.stdout)
            self.assertEqual(result.stdout.count("ENCODING "), 3)

            # Past the per-file cap the findings are counted, never dropped.
            document.write_bytes(("— " * 25).encode("cp1252"))
            result = self.run_guard(root)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(result.stdout.count("ENCODING "), 10)
            self.assertIn("15 further undecodable byte(s)", result.stdout)
            self.assertIn("25 finding(s) in 1 file(s)", result.stdout)

    def test_utf16_document_is_reported_rather_than_crashing(self):
        """A neighbouring encoding the same editor produces, for the same reason."""
        with tempfile.TemporaryDirectory(prefix="doc-encoding-") as directory:
            root = Path(directory)
            document = root / "utf16.md"
            document.write_bytes(BODY.encode("utf-16"))
            result = self.run_guard(root)
            self.assertEqual(result.returncode, 1)
            self.assertIn("utf16.md", result.stdout)

            document.write_bytes(BODY.encode("utf-8"))
            self.assertEqual(self.run_guard(root).returncode, 0)

    def test_missing_path_is_refused(self):
        with tempfile.TemporaryDirectory(prefix="doc-encoding-") as directory:
            missing = Path(directory) / "absent"
            result = self.run_guard(missing)
            self.assertEqual(result.returncode, 1)
            self.assertIn("No such path", result.stderr)


if __name__ == "__main__":
    unittest.main()
