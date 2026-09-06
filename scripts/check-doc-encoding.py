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
a document's contents; a document that cannot be decoded is a finding, not a
crash. That is the whole difference between a guard and the defect it guards.

Two failure modes are reported:

* **Undecodable bytes.** Any byte sequence that is not valid UTF-8. In practice
  this is cp1252 punctuation pasted from a word processor -- 0x97 em dash,
  0x96 en dash, 0x92 right single quote -- which is why the report names the
  character cp1252 would have produced. That is nearly always the character the
  author intended, so it doubles as the fix.

* **A leading UTF-8 BOM.** U+FEFF decodes cleanly, so nothing downstream
  raises. It attaches itself to the first character of the file instead, and
  the first character of these documents is the `#` of the title heading. A
  BOM followed by `# CBD-13 ...` is not a Markdown heading, so the document
  silently loses its title in every renderer. A guard that only caught decode
  errors would pass this file and leave the defect in place.

Usage
-----
    python scripts/check-doc-encoding.py            # check docs/, exit 1 on any finding
    python scripts/check-doc-encoding.py --verbose  # also name every clean file
    python scripts/check-doc-encoding.py --path other/dir

Scope and limits
----------------
This checks *encoding*, not content: a file of valid UTF-8 mojibake decodes
without error and is not reported here. It is deliberately mechanical -- a file
either decodes or it does not -- so it has no exceptions, no allowlist and
nothing to tune. Standard library only, so it runs on a CI runner before any
dependency install, for the reason recorded in .github/workflows/ci.yml beside
the sibling documentation steps.
"""

from __future__ import annotations

import argparse
import sys
import unicodedata
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

BOM = b"\xef\xbb\xbf"

# How many undecodable byte runs to report per file. A document saved wholesale
# in cp1252 has one finding per non-ASCII character, and a hundred identical
# lines of report bury the other files. The suppressed count is printed, so
# nothing disappears silently.
MAX_FINDINGS_PER_FILE = 10

# Characters shown either side of the offending byte. Wide enough to identify
# the sentence, narrow enough to stay on one terminal line.
CONTEXT_CHARS = 40


@dataclass(frozen=True)
class Finding:
    kind: str
    """`decode` or `bom` -- which of the two failure modes this is."""
    line: int
    column: int
    """1-based character column within the line."""
    offset: int
    """Byte offset from the start of the file.

    This is what UnicodeDecodeError reports and therefore what a reader
    arriving from one of those tracebacks is already holding.
    """
    raw: bytes
    detail: str
    context: str


def display_path(file: Path) -> str:
    """Repo-relative POSIX path, falling back to absolute for a scan outside
    the repo -- `--path` accepts one, and the tests use a temp directory."""
    try:
        return file.relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return file.as_posix()


def line_and_column(data: bytes, offset: int) -> tuple[int, int]:
    """Locate a byte offset as (line, column), both 1-based.

    The column is counted in characters of the line's decoded prefix, not in
    bytes, so it matches where an editor puts the cursor. That prefix is by
    construction valid UTF-8 -- decoding stopped at `offset` -- so it decodes
    exactly.
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
    return f"{before}[{bad}]{after}".replace("\r", "")


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


def scan_file(data: bytes) -> tuple[list[Finding], int]:
    """Return one file's findings, plus how many were suppressed by the cap."""
    findings: list[Finding] = []
    suppressed = 0

    if data.startswith(BOM):
        # A BOM is invisible, so printing it in place would show the reader an
        # empty bracket. It is named instead, in front of the first line it
        # spoils -- which is the title heading in every document here.
        first_line = data[len(BOM):].split(b"\n", 1)[0].decode("utf-8", errors="replace")
        first_line = first_line.replace("\r", "")
        if len(first_line) > 2 * CONTEXT_CHARS:
            first_line = first_line[:2 * CONTEXT_CHARS] + "..."
        findings.append(Finding(
            kind="bom",
            line=1,
            column=1,
            offset=0,
            raw=BOM,
            detail="leading UTF-8 BOM (U+FEFF); it decodes cleanly but attaches "
                   "to the first character, so a title heading stops being a heading",
            context=f"[U+FEFF]{first_line}",
        ))

    # Walk the whole file rather than stopping at the first error: recovering at
    # `error.end` is what turns one finding per run into every finding in one
    # run. The offsets on UnicodeDecodeError are relative to the bytes handed to
    # decode(), so `position` rebases them onto the file.
    decode_findings = 0
    position = 0
    while position < len(data):
        try:
            data[position:].decode("utf-8")
        except UnicodeDecodeError as error:
            offset = position + error.start
            end = position + error.end
            if decode_findings >= MAX_FINDINGS_PER_FILE:
                suppressed += 1
            else:
                decode_findings += 1
                raw = data[offset:end]
                line, column = line_and_column(data, offset)
                hexed = " ".join(f"0x{byte:02x}" for byte in raw)
                detail = f"byte {hexed} is not valid UTF-8 ({error.reason})"
                reading = cp1252_reading(raw)
                if reading:
                    detail += f"; cp1252 reads it as {reading}"
                findings.append(Finding(
                    kind="decode",
                    line=line,
                    column=column,
                    offset=offset,
                    raw=raw,
                    detail=detail,
                    context=surrounding_text(data, offset, end),
                ))
            position = end
        else:
            break
    return findings, suppressed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--verbose", action="store_true", help="print every file checked, not only findings")
    parser.add_argument("--path", default="docs", help="directory to scan (default: docs)")
    args = parser.parse_args()

    # The report quotes characters -- em dashes, U+FFFD replacement marks --
    # that a Windows console's cp1252 code page cannot encode. Printing one
    # there raises UnicodeEncodeError from inside the guard, which is the same
    # class of failure this script exists to prevent, so the stream is forced
    # to UTF-8 and told never to let one unencodable character stop the run.
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    # An absolute --path replaces REPO_ROOT under pathlib's join rules anyway;
    # spelling it out keeps the tests' temp directory from looking accidental.
    candidate = Path(args.path)
    root = candidate if candidate.is_absolute() else REPO_ROOT / candidate
    if not root.exists():
        sys.exit(f"No such path: {args.path}")

    checked = 0
    bad_files = 0
    findings_total = 0
    for file in sorted(root.rglob("*.md")):
        if not file.is_file():
            continue
        checked += 1
        findings, suppressed = scan_file(file.read_bytes())
        where = display_path(file)
        if not findings:
            if args.verbose:
                print(f"ok    {where}: valid UTF-8, no BOM")
            continue
        bad_files += 1
        findings_total += len(findings) + suppressed
        for finding in findings:
            print(f"ENCODING {where}:{finding.line}:{finding.column}")
            print(f"      byte offset : {finding.offset}")
            print(f"      bytes       : {' '.join(f'0x{byte:02x}' for byte in finding.raw)}")
            print(f"      problem     : {finding.detail}")
            print(f"      context     : {finding.context}")
        if suppressed:
            print(f"      ... and {suppressed} further undecodable byte(s) in this file; "
                  "re-save the whole file as UTF-8")

    print(f"\n{checked} document(s) checked for encoding.")
    if bad_files:
        print(f"{findings_total} finding(s) in {bad_files} file(s). Re-save each file as "
              "UTF-8 without a BOM, keeping the character named above.")
        return 1
    print("No encoding drift.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
