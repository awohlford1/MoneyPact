#!/usr/bin/env python3
"""Check that no CBD-13 acceptance criterion still assumes the withdrawn event model.

Why this exists
---------------
`AN-92-001` disables product analytics and success-measure events for Private
MVP. The CBD-13 story family was originally written against a behavioural event
pipeline, and CBD-13's approved measurement conventions section 11 claims that
**every** criterion contradicting an approved contract is recorded and amended.

That claim was wrong three times. The first sweep covered the subtasks and
missed the parent story. The approval review caught the parent and was still an
eyeball pass, so it missed `CBD-77-AC05`, `CBD-80-AC01` and `CBD-80-AC06`. Each
sweep restated the claim by hand instead of deriving it -- the defect CBD-108
records at `OI-108-082`, arriving here independently.

So the claim is now computed. This script reads the live criteria and fails on
any that carries event-model language without an amendment sentence recording
which contract forced the change.

    python scripts/check-an92-criteria.py             # live Jira
    python scripts/check-an92-criteria.py --offline   # skip, for CI without credentials

`--offline` performs no check and says so. It exists because CI has no Jira
credentials, and a script that silently passes when it checked nothing is worse
than one that says it checked nothing.

Credentials come from the environment or .env.local, via the same loader
scripts/audit-jira-links.py uses. It reads Jira and writes nothing.
"""

from __future__ import annotations

import argparse
import base64
import importlib.util
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

# The CBD-13 story, the subtask that owns the conventions, and the five
# packages the conventions govern.
FAMILY = ("CBD-13", "CBD-368", "CBD-77", "CBD-78", "CBD-79", "CBD-80", "CBD-81")

# Terms AN-92-001 and AN-92-002 name, or that presuppose the withdrawn model.
#
# "consent" is deliberately narrow. CBD-79-AC04 measures *consent changes* --
# customers changing their own consent, which is a legitimate thing to count.
# What AN-92-002 rejects is a consent *basis* offered as authority to collect,
# so only that construction is suspect.
SUSPECT: dict[str, str] = {
    "event": r"\bevents?\b",
    "cohort": r"\bcohorts?\b",
    "funnel": r"\bfunnels?\b",
    "journey": r"\bjourneys?\b",
    "analytics": r"\banalytics\b",
    "behavioural capture": r"\bbehaviou?ral\b",
    "attribution": r"\battribution\b",
    "segmentation": r"\bsegment(?:ed|ation|s)?\b",
    "consent basis": r"\bconsent\b(?![^.]{0,40}\bchanges?\b)"
                     r"(?=[^.]{0,60}\b(?:basis|bases|banner|obtained|collect)\b)",
}

AMENDMENT = re.compile(r"amended\s+\w+\s+\d{1,2},\s+\d{4}", re.I)
AC_ID = re.compile(r"^(CBD-[0-9]+-AC[0-9]+)\s+—\s+(.*)$", re.DOTALL)


def load_credentials() -> tuple[str, str, str]:
    spec = importlib.util.spec_from_file_location(
        "audit_jira_links", REPO_ROOT / "scripts/audit-jira-links.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["audit_jira_links"] = module
    spec.loader.exec_module(module)
    return module.load_credentials()


def flatten(node) -> list[str]:
    """Return one string per top-level paragraph of an ADF document."""
    out: list[str] = []
    for block in (node or {}).get("content", []) or []:
        parts: list[str] = []

        def walk(n):
            if n.get("type") == "text":
                parts.append(n["text"])
            for child in n.get("content", []) or []:
                walk(child)

        walk(block)
        text = "".join(parts).strip()
        if text:
            out.append(text)
    return out


def fetch(base: str, auth: str, key: str) -> dict:
    request = urllib.request.Request(
        f"{base.rstrip('/')}/rest/api/3/issue/{key}?fields=customfield_10066,summary",
        headers={"Authorization": f"Basic {auth}"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        sys.exit(f"{key}: HTTP {exc.code} {exc.read().decode('utf-8', 'replace')[:200]}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--offline", action="store_true",
                        help="skip the check; CI has no Jira credentials")
    args = parser.parse_args()

    if args.offline:
        print("check-an92-criteria: skipped, --offline performs no check "
              "(it needs live Jira criteria).")
        return 0

    base, email, token = load_credentials()
    auth = base64.b64encode(f"{email}:{token}".encode()).decode()

    failures: list[str] = []
    checked = 0
    for key in FAMILY:
        issue = fetch(base, auth, key)
        for line in flatten(issue["fields"].get("customfield_10066")):
            match = AC_ID.match(line)
            identifier, body = match.groups() if match else (key, line)
            checked += 1
            found = [name for name, pattern in SUSPECT.items()
                     if re.search(pattern, body, re.I)]
            if found and not AMENDMENT.search(body):
                failures.append(
                    f"{identifier}: carries {found} with no amendment recorded\n"
                    f"    {body[:160]}")

    print(f"check-an92-criteria: {checked} criteria across {len(FAMILY)} issues")
    if failures:
        print(f"{len(failures)} unamended:")
        for failure in failures:
            print("  " + failure)
        print("\nAN-92-001 disables the behavioural event pipeline for Private MVP. "
              "Amend the criterion and record the contract that forced it, or "
              "narrow SUSPECT if the term is being used in a permitted sense.")
        return 1
    print("No criterion assumes the withdrawn event model.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
