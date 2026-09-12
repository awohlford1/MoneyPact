#!/usr/bin/env python3
"""Enumerate every Jira issue link in the project and flag suspected inversions.

A Blocks link stored in the wrong direction is invisible in ordinary use: Jira
renders it as a normal dependency and nothing complains. CBD-95 `RV-95-006`
found fourteen of them in one early batch, including one that recorded CBD-76
as blocking CBD-95 when the CBD-95 package is the gate on CBD-76.

Every partial sweep during that investigation under-reported the batch — nine,
then twelve, then fourteen — because each query was scoped to issues already in
view. This script exists so the question is answered by enumeration rather than
by sampling.

Setup
-----
    export JIRA_BASE_URL=https://cobudget.atlassian.net   # optional, this is the default
    export JIRA_EMAIL=you@example.com
    export JIRA_API_TOKEN=...    # id.atlassian.com/manage-profile/security/api-tokens

Values are read from the environment first, then from an untracked `.env.local`
in the repository root, per `docs/development.md`. The token is never printed,
logged, or written to disk.

Usage
-----
    python scripts/audit-jira-links.py              # enumerate and check
    python scripts/audit-jira-links.py --all        # include non-Blocks links
    python scripts/audit-jira-links.py --project X  # another project key

Exit code is 0 when every Blocks link is either correctly ordered or explicitly
reviewed. It is 1 when an unreviewed suspect is found, and also when a REVIEWED
entry no longer matches a live link: an allowlist that has drifted from reality
is how a confirmed-correct verdict silently outlives the thing it described.

Reading direction
-----------------
Direction comes from the REST API. For issue X, a Blocks link carrying
`outwardIssue: Y` means "X blocks Y"; one carrying `inwardIssue: Y` means
"Y blocks X". This was validated against the known-true CBD-94 -> CBD-95
dependency, where CBD-94 is Done and CBD-95 consumes its frozen blobs.

Do not use Teamwork Graph to judge direction. It names the same relationships
in the opposite sense: querying CBD-95 there reports it *blocks* CBD-94 and
*is blocked by* CBD-76 and CBD-108, the inverse of the truth in all three
cases. An audit run through that tool would turn correct links into inverted
ones.

What the heuristic can and cannot do
------------------------------------
CBD work items are numbered in roughly the order they are worked, so a Blocks
link where the higher-numbered issue blocks the lower one is the signature of
the inverted batch. It is a signature, not a proof: a genuine dependency can
legitimately run that way, and four such links in this project were reviewed
and confirmed correct. Those are listed in REVIEWED below with the reason.

A flagged link is a candidate to check against the issues' own dependency text.
Never reverse one on the strength of the heuristic alone.
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from tool_config import ConfigurationError, load_tool_config

REPO_ROOT = Path(__file__).resolve().parent.parent
ENV_FILE = REPO_ROOT / ".env.local"

# Links whose direction looks inverted to the heuristic but which were read
# against the issues' own text and confirmed correct. Keyed by link id so a
# reused id cannot inherit the pass. The first four were confirmed by the
# Product Owner on August 16, 2026; 10177 was confirmed by Manager
# verification against both issues' acceptance criteria on 2026-09-12
# (record LINK10177-SCRUM-001).
REVIEWED: dict[int, str] = {
    10037: "CBD-91 blocks CBD-75 - CBD-75 copy depends on CBD-91 privacy findings",
    10038: "CBD-105 blocks CBD-19 - provider selection gates the database work",
    10052: "CBD-94 blocks CBD-62 - the requirement catalog gates lifecycle work",
    10069: "CBD-95 blocks CBD-76 - the CBD-95 package is the gate on CBD-76",
    10177: "CBD-253 blocks CBD-119 - the customer-managed key must exist before the instance is created with it",
}


def load_credentials() -> tuple[str, str, str]:
    """Environment first, then .env.local. Never echoes a value."""
    values: dict[str, str] = {}
    if ENV_FILE.is_file():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip('"').strip("'")

    try:
        config = load_tool_config("jira", values)
    except ConfigurationError as error:
        sys.exit(str(error))
    return config["JIRA_BASE_URL"], config["JIRA_EMAIL"], config["JIRA_API_TOKEN"]


def fetch_links(base: str, auth: str, project: str) -> dict[int, tuple[str, str, str]]:
    """Return {link_id: (blocker, blocked, link_type)} for the whole project.

    Only the issuelinks field is requested. The connector-independent REST
    projection keeps this to a few pages rather than the dozens that a full
    issue payload would need.
    """
    links: dict[int, tuple[str, str, str]] = {}
    jql = urllib.parse.quote(f"project={project} ORDER BY key ASC")
    token = None
    scanned = 0

    while True:
        url = f"{base}/rest/api/3/search/jql?jql={jql}&fields=issuelinks&maxResults=100"
        if token:
            url += f"&nextPageToken={urllib.parse.quote(token)}"
        request = urllib.request.Request(
            url, headers={"Authorization": f"Basic {auth}", "Accept": "application/json"}
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                payload = json.loads(response.read().decode())
        except urllib.error.HTTPError as error:  # pragma: no cover - network path
            sys.exit(f"Jira returned {error.code} for the search request.")

        batch = payload.get("issues", [])
        scanned += len(batch)
        for issue in batch:
            source = issue["key"]
            for link in issue["fields"].get("issuelinks") or []:
                if "outwardIssue" in link:
                    blocker, blocked = source, link["outwardIssue"]["key"]
                else:
                    blocker, blocked = link["inwardIssue"]["key"], source
                links[int(link["id"])] = (blocker, blocked, link["type"]["name"])

        token = payload.get("nextPageToken")
        if not token or not batch:
            break

    print(f"issues scanned: {scanned}")
    print(f"links found:    {len(links)}\n")
    return links


def issue_number(key: str) -> int:
    return int(key.split("-", 1)[1])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--project", default="CBD", help="project key (default: CBD)")
    parser.add_argument(
        "--all", action="store_true", help="also list non-Blocks links"
    )
    args = parser.parse_args()

    base, email, token = load_credentials()
    auth = base64.b64encode(f"{email}:{token}".encode()).decode()
    links = fetch_links(base, auth, args.project)
    if not links:
        print("No links found.")
        return 0

    blocks = {i: v for i, v in links.items() if v[2] == "Blocks"}
    suspects: list[tuple[int, str]] = []

    print(f"{'link':<8}{'relationship':<36}verdict")
    print("-" * 78)
    for link_id in sorted(blocks):
        blocker, blocked, _ = blocks[link_id]
        relationship = f"{blocker} blocks {blocked}"
        if issue_number(blocker) <= issue_number(blocked):
            verdict = "ok"
        elif link_id in REVIEWED:
            verdict = "reviewed - confirmed correct"
        else:
            verdict = "SUSPECT - higher blocks lower"
            suspects.append((link_id, relationship))
        print(f"{link_id:<8}{relationship:<36}{verdict}")

    if args.all:
        others = {i: v for i, v in links.items() if v[2] != "Blocks"}
        if others:
            print(f"\nnon-Blocks links ({len(others)}):")
            for link_id in sorted(others):
                blocker, blocked, kind = others[link_id]
                print(f"  {link_id:<8}{blocker} {kind} {blocked}")

    stale = sorted(set(REVIEWED) - set(blocks))
    if stale:
        print(
            "\nREVIEWED entries no longer present as Blocks links: "
            f"{stale}. Remove them so a reused id cannot inherit the pass."
        )

    print()
    if suspects:
        print(f"{len(suspects)} link(s) need review against the issues' own text:")
        for link_id, relationship in suspects:
            print(f"  {link_id}  {relationship}")
        print("\nA flag is a candidate, not a verdict. Confirm before reversing.")
    if suspects or stale:
        return 1

    print("No unreviewed suspects. Every Blocks link is ordered or explicitly reviewed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
