#!/usr/bin/env python3
"""Check that every scanned document is decodable as UTF-8 without a BOM.

Why this exists
---------------
`check-doc-vocabulary.py` calls `file.read_text(encoding="utf-8")` inside its
scan loop. When one scanned file is cp1252-encoded, that call raises

    UnicodeDecodeError: 'utf-8' codec can't decode byte 0x97 in position 29

and the whole run dies. The traceback names the byte and the offset *within
that file*, but not the file, so the reader learns nothing about where to look.
Worse, the run stops at the first bad file: fixing it only reveals the next
one, one round trip at a time. Twenty records written by an editor that
defaults to the Windows code page cost twenty runs to find.

This guard runs first and answers the question the traceback does not: which
files, which lines, which bytes -- all of them, in one pass. It never raises on
a document, whatever the document contains and whether or not it can even be
opened; an unreadable or undecodable file is a finding, not a crash, and a
finding carries a remedy that is correct for its own failure mode. That is the
whole difference between a guard and the defect it guards.

Four failure modes are reported, each with its own fix line, because the fix
for one is actively wrong for another:

* **Undecodable bytes.** Any byte sequence that is not valid UTF-8. In practice
  this is cp1252 punctuation pasted from a word processor -- 0x97 em dash,
  0x96 en dash, 0x92 right single quote -- so the report names the character
  cp1252 would have produced. That is nearly always the character the author
  intended, which makes it the fix as well as the diagnosis.

* **A leading UTF-8 BOM.** U+FEFF decodes cleanly, so nothing downstream
  raises. It attaches itself to the first character of the file instead, and
  the first character of these documents is the `#` of the title heading. A
  BOM followed by `# CBD-13 ...` is not a Markdown heading, so the document
  silently loses its title in every renderer.

* **A whole file in UTF-16 or UTF-32**, recognised by its byte-order mark. This
  is reported on its own, without the byte-level findings, because the file is
  not damaged UTF-8 at all -- it is intact text in another encoding, and it
  needs converting rather than character-by-character repair. Telling the
  author to keep "the character named above" here would corrupt the file
  further, which is why this mode is separate.

* **A file that cannot be read.** A Windows editor holding an exclusive lock,
  a permission bit, or a file deleted between the directory walk and the read.
  A guard that stops on one of these is the defect it was written to remove.

Usage
-----
    python scripts/check-doc-encoding.py            # check docs/, exit 1 on any finding
    python scripts/check-doc-encoding.py --verbose  # also name every clean file
    python scripts/check-doc-encoding.py --path other/dir
    python scripts/check-doc-encoding.py --path docs/cbd-13-measurement-conventions.md

Scanning nothing is a failure, not a pass. A `--path` that matches no document
exits 1 and says so, for the reason .github/workflows/ci.yml records beside the
sibling freshness step: a green run that checked nothing is the most expensive
kind of false assurance.

Scope and limits
----------------
This checks *encoding*, not content: a file of valid UTF-8 mojibake decodes
without error and is not reported here.

A UTF-16 or UTF-32 file with no byte-order mark is only caught when its bytes
happen not to decode. A BOM-less UTF-16-LE file of pure ASCII decodes as valid
UTF-8 -- every second byte is a NUL, and NUL is legal UTF-8 -- so it passes
this guard clean and reaches a Markdown renderer as interleaved nulls. Catching
that needs content heuristics, which is a different and much noisier kind of
check than "these bytes either decode or they do not".

Otherwise it is deliberately mechanical, so it has no exceptions, no allowlist
and nothing to tune. Standard library only, so it runs on a CI runner before
any dependency install, for the reason recorded in .github/workflows/ci.yml
beside the sibling documentation steps.
"""

from __future__ import annotations

import argparse
import codecs
import sys
import unicodedata
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

BOM = b"\xef\xbb\xbf"

# Byte-order marks of the encodings an editor offers next to UTF-8, longest
# first so UTF-32-LE is never mistaken for UTF-16-LE, which is its prefix.
WIDE_BOMS: tuple[tuple[bytes, str], ...] = (
    (b"\xff\xfe\x00\x00", "UTF-32-LE"),
    (b"\x00\x00\xfe\xff", "UTF-32-BE"),
    (b"\xff\xfe", "UTF-16-LE"),
    (b"\xfe\xff", "UTF-16-BE"),
)

# How many undecodable byte runs to report per file. A document saved wholesale
# in cp1252 has one finding per non-ASCII character, and a hundred identical
# lines of report bury the other files. The suppressed count is printed, so
# nothing disappears silently.
MAX_FINDINGS_PER_FILE = 10

# Characters shown either side of the offending byte. Wide enough to identify
# the sentence, narrow enough to stay on one terminal line.
CONTEXT_CHARS = 40

# Name of the codec error handler registered below.
COLLECT = "check-doc-encoding-collect"


@dataclass(frozen=True)
class Finding:
    kind: str
    """`decode`, `bom`, `wide` or `unreadable`."""
    detail: str
    fix: str
    """What to do about this finding. Per-kind, never shared: the remedy for a
    stray cp1252 byte would destroy a UTF-16 file."""
    line: int | None = None
    column: int | None = None
    """1-based character column within the line, or None where a position is
    meaningless -- an unreadable file has no interior."""
    offset: int | None = None
    """Byte offset from the start of the file.

    This is what UnicodeDecodeError reports and therefore what a reader
    arriving from one of those tracebacks is already holding. It is also the
    authoritative locator: unlike the column it is exact in every case.
    """
    raw: bytes = b""
    context: str = ""


class ErrorCollector:
    """A codec error handler that records every bad run instead of raising.

    `bytes.decode` with a registered handler makes one pass over the file and
    hands the handler each invalid run in turn, with `start` and `end` already
    relative to the whole file. The obvious alternative -- catching
    UnicodeDecodeError and re-decoding `data[position:]` -- copies the
    remaining tail on every error, which is O(k*n) and turns a multi-megabyte
    file with a high error density into an unbounded CI step rather than a
    slow one. That is not a theoretical difference: a 5 MB pseudo-binary file
    named *.md did not finish in sixty seconds under the re-decoding loop.

    Detail is kept only up to the per-file cap; past it the run is counted and
    dropped, so a wholly binary file costs one integer per error rather than a
    list entry.
    """

    def __init__(self) -> None:
        self.runs: list[tuple[int, int, str]] = []
        self.total = 0

    def __call__(self, error: UnicodeDecodeError) -> tuple[str, int]:
        self.total += 1
        if len(self.runs) < MAX_FINDINGS_PER_FILE:
            self.runs.append((error.start, error.end, error.reason))
        # Drop the bad bytes and carry on from the end of the run. Nothing is
        # done with the decoded text, so the replacement is empty.
        return "", error.end


def display_path(file: Path) -> str:
    """Repo-relative POSIX path, falling back to absolute for a scan outside
    the repo -- `--path` accepts one, and the tests use a temp directory."""
    try:
        return file.relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return file.as_posix()


def line_and_column(data: bytes, offset: int) -> tuple[int, int]:
    """Locate a byte offset as (line, column), both 1-based.

    The line is exact. The column is counted in characters of the line's
    decoded prefix, which is exact for the first bad run on a line and can read
    low after that: an earlier invalid run of several bytes collapses to a
    single U+FFFD under `errors="replace"`, so a reader counting columns in an
    editor may find the character one or two positions further right. The byte
    offset printed beside it is exact in every case and is the locator to trust
    when they disagree; the column is there to put the reader on the right part
    of the line, not to be arithmetic.
    """
    line = data.count(b"\n", 0, offset) + 1
    start = data.rfind(b"\n", 0, offset) + 1
    column = len(data[start:offset].decode("utf-8", errors="replace")) + 1
    return line, column


def surrounding_text(data: bytes, offset: int, end: int) -> str:
    """The offending bytes in place, bracketed, with the rest of their line.

    Decoded with `errors="replace"` because by definition this text does not
    decode: the point is to show the reader the sentence to search for, not to
    round-trip the bytes.
    """
    start = data.rfind(b"\n", 0, offset) + 1
    stop = data.find(b"\n", end)
    stop = len(data) if stop == -1 else stop
    before = data[start:offset].decode("utf-8", errors="replace")
    bad = data[offset:end].decode("utf-8", errors="replace")
    after = data[end:stop].decode("utf-8", errors="replace")
    if len(before) > CONTEXT_CHARS:
        before = "..." + before[-CONTEXT_CHARS:]
    if len(after) > CONTEXT_CHARS:
        after = after[:CONTEXT_CHARS] + "..."
    return printable(f"{before}[{bad}]{after}")


def printable(text: str) -> str:
    """Escape control characters so a report cannot drive the terminal.

    A UTF-16 file's first line is half NUL bytes and a damaged file may hold
    anything at all; writing those through raw would at best garble the report
    and at worst move the cursor. Tab and carriage return are dropped rather
    than escaped -- they carry no information the reader needs here.
    """
    text = text.replace("\r", "").replace("\t", " ")
    return "".join(
        char if unicodedata.category(char) != "Cc" else f"\\x{ord(char):02x}"
        for char in text
    )


def first_line_text(data: bytes, encoding: str = "utf-8") -> str:
    """The file's first line, rendered for a report and never trusted.

    `encoding` is the file's real encoding when that is known, which for a
    UTF-16 or UTF-32 file is the only way to show the author a heading they
    recognise instead of a column of nulls. Enough bytes to fill the excerpt
    are decoded, trimmed to whole 4-byte groups so no code unit is split.
    """
    sample = data[: 8 * CONTEXT_CHARS]
    sample = sample[: len(sample) - len(sample) % 4]
    # Split on the line break before escaping, or the break itself is escaped
    # and the excerpt runs on past the end of the line.
    text = printable(sample.decode(encoding, errors="replace").split("\n", 1)[0])
    if len(text) > 2 * CONTEXT_CHARS:
        text = text[:2 * CONTEXT_CHARS] + "..."
    return text


def cp1252_reading(raw: bytes) -> str:
    """What cp1252 would have made of these bytes, when it can make anything.

    Almost every real instance of this defect is a document written or pasted in
    the Windows code page, so this names the character the author meant. An
    empty string means cp1252 does not define the byte either, and the caller
    then says nothing rather than guessing.
    """
    try:
        text = raw.decode("cp1252")
    except UnicodeDecodeError:
        return ""
    readings = []
    for char in text:
        try:
            readings.append(f"{char!r} U+{ord(char):04X} {unicodedata.name(char)}")
        except ValueError:
            readings.append(f"{char!r} U+{ord(char):04X}")
    return "; ".join(readings)


def scan_bytes(data: bytes) -> tuple[list[Finding], int]:
    """Return one file's findings, plus how many were suppressed by the cap."""
    for mark, encoding in WIDE_BOMS:
        if data.startswith(mark):
            # Reported alone. The rest of this file is intact text in another
            # encoding, not damaged UTF-8, so listing its bytes as individual
            # defects would describe it wrongly and invite a repair that
            # destroys it.
            hexed = " ".join(f"0x{byte:02x}" for byte in mark)
            return [Finding(
                kind="wide",
                line=1,
                column=1,
                offset=0,
                raw=mark,
                detail=f"{encoding} byte-order mark ({hexed}); the whole file is "
                       f"{encoding}, not UTF-8",
                fix=f"convert the file, e.g. `iconv -f {encoding} -t UTF-8`, or "
                    "re-save it as UTF-8 from the editor. Do not edit these bytes "
                    "by hand and do not treat them as a stray character",
                context=first_line_text(data[len(mark):], encoding),
            )], 0

    findings: list[Finding] = []

    if data.startswith(BOM):
        # A BOM is invisible, so printing it in place would show the reader an
        # empty bracket. It is named instead, in front of the first line it
        # spoils -- which is the title heading in every document here.
        findings.append(Finding(
            kind="bom",
            line=1,
            column=1,
            offset=0,
            raw=BOM,
            detail="leading UTF-8 BOM (U+FEFF); it decodes cleanly but attaches "
                   "to the first character, so a title heading stops being a heading",
            fix="re-save as UTF-8 without a BOM, i.e. strip the leading 0xef 0xbb 0xbf",
            context=f"[U+FEFF]{first_line_text(data[len(BOM):])}",
        ))

    # One pass over the file. The handler registry is process-global and this
    # script is single-threaded, so a fresh collector is registered per file
    # rather than reset in place -- there is no state to leak between files.
    collector = ErrorCollector()
    codecs.register_error(COLLECT, collector)
    data.decode("utf-8", errors=COLLECT)

    for offset, end, reason in collector.runs:
        raw = data[offset:end]
        line, column = line_and_column(data, offset)
        hexed = " ".join(f"0x{byte:02x}" for byte in raw)
        detail = f"byte {hexed} is not valid UTF-8 ({reason})"
        reading = cp1252_reading(raw)
        fix = "re-save the file as UTF-8"
        if reading:
            detail += f"; cp1252 reads it as {reading}"
            fix += "; the cp1252 character named above is almost always the one intended"
        findings.append(Finding(
            kind="decode",
            line=line,
            column=column,
            offset=offset,
            raw=raw,
            detail=detail,
            fix=fix,
            context=surrounding_text(data, offset, end),
        ))
    return findings, collector.total - len(collector.runs)


def scan_file(file: Path) -> tuple[list[Finding], int]:
    """Findings for one path, including the path itself being unusable.

    A file that cannot be read is a finding for the same reason a file that
    cannot be decoded is: the guard is the thing that must not stop.
    """
    try:
        data = file.read_bytes()
    except OSError as error:
        return [Finding(
            kind="unreadable",
            detail=f"cannot be read: {type(error).__name__}: {error.strerror or error}",
            fix="close whatever holds the file open, or fix its permissions, then "
                "re-run. Until it can be read, its encoding is unverified",
        )], 0
    return scan_bytes(data)


def documents(root: Path) -> list[Path]:
    """Every document `--path` names.

    A file is scanned as itself, whatever its suffix: a reader who names one
    file has asked about that file, and silently scanning nothing because it is
    not a directory is how a fixed-it-just-now check comes back green.
    """
    if root.is_file():
        return [root]
    return sorted(path for path in root.rglob("*.md") if path.is_file())


def report(where: str, finding: Finding) -> None:
    # Branch on the kind, not on whether a position happens to be set: a fifth
    # kind arriving without a position would otherwise silently print as
    # UNREADABLE, which would be a lie about what was wrong with the file.
    if finding.kind == "unreadable":
        print(f"UNREADABLE {where}")
    else:
        print(f"ENCODING {where}:{finding.line}:{finding.column}")
        print(f"      byte offset : {finding.offset}")
        print(f"      bytes       : {' '.join(f'0x{byte:02x}' for byte in finding.raw)}")
    print(f"      problem     : {finding.detail}")
    if finding.context:
        print(f"      context     : {finding.context}")
    print(f"      fix         : {finding.fix}")


def main() -> int:
    # Before argparse, not after: --help prints this module's docstring through
    # stdout, and a Windows console's cp1252 code page cannot encode the dashes
    # a sibling checker's docstring already contains. A guard whose --help
    # raises UnicodeEncodeError is the failure mode this script exists to end.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--verbose", action="store_true", help="print every file checked, not only findings")
    parser.add_argument("--path", default="docs", help="directory or file to scan (default: docs)")
    args = parser.parse_args()

    # An absolute --path replaces REPO_ROOT under pathlib's join rules anyway;
    # spelling it out keeps the tests' temp directory from looking accidental.
    candidate = Path(args.path)
    root = candidate if candidate.is_absolute() else REPO_ROOT / candidate
    if not root.exists():
        sys.exit(f"No such path: {args.path}")

    checked = 0
    bad_files = 0
    findings_total = 0
    for file in documents(root):
        checked += 1
        findings, suppressed = scan_file(file)
        where = display_path(file)
        if not findings:
            if args.verbose:
                print(f"ok    {where}: valid UTF-8, no BOM")
            continue
        bad_files += 1
        findings_total += len(findings) + suppressed
        for finding in findings:
            report(where, finding)
        if suppressed:
            print(f"MORE {where}: {suppressed} further undecodable byte sequence(s) "
                  "not shown; re-save the whole file as UTF-8")

    print(f"\n{checked} document(s) checked for encoding.")
    if not checked:
        # Saying plainly that it checked nothing rather than passing silently,
        # which is what the sibling freshness check does and for the same
        # reason: a green run over an empty scan list is worse than a red one.
        print(f"Nothing to check under {args.path}. Name a directory containing "
              "*.md documents, or a file.")
        return 1
    if bad_files:
        print(f"{findings_total} finding(s) in {bad_files} file(s). "
              "Apply the fix printed with each finding; they are not the same fix.")
        return 1
    print("No encoding drift.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
