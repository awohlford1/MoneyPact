#!/usr/bin/env python3
"""Create empty Confluence pages for documents that have no publication target.

Why this exists, and why it is not part of the publisher.

A document cannot be registered until a page exists to register it against, and
nothing in the toolchain made one. Creating eleven by hand meant eleven API
calls, and the pages were given placeholder text, which is the one thing that
does not work: a first publication reconciles the live page against an *empty*
base, so a page with any content in it fails with ambiguous-structural-change.
That cost a failed run and an owner-approved recovery record. The empty-body
requirement is the whole reason this script exists -- it is easy to get wrong
by hand and impossible to get wrong here.

This is an owner-run helper, deliberately outside the CBD-115 workflow. That
workflow remains the sole writer of page *content* and still creates no page,
so the statements to that effect in PUBLICATION.md stay true. Creation has to
be a human step regardless: the workflow runs with `contents: read` and cannot
write a new page id back into the manifest, so a person must review the
registration and commit it.

It writes nothing in the repository. It creates pages and prints the manifest
entry and TARGETS row for each, for you to review, edit and commit.

    python scripts/create-confluence-target.py --parent 98415 docs/cbd-99-thing.md

Add --dry-run to see the titles, duplicate checks and emitted rows without
creating anything.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from base64 import b64encode
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from tool_config import ConfigurationError, load_env_file, load_tool_config  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
MANIFEST = REPO_ROOT / "config/confluence-publication.json"
TARGET_SLUG = re.compile(r"^[a-z0-9-]+$")


class CreateError(Exception):
    pass


class ConfluenceClient:
    """The only thing that touches the network, so tests can replace it."""

    def __init__(self, base_url, email, api_token):
        self.base = base_url.rstrip("/")
        self.auth = b64encode(f"{email}:{api_token}".encode()).decode()

    def _request(self, path, method="GET", payload=None):
        headers = {"Authorization": f"Basic {self.auth}", "Accept": "application/json"}
        data = None
        if payload is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(payload).encode("utf-8")
        request = urllib.request.Request(self.base + path, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            # Remote bodies can echo the request, including the credential.
            raise CreateError(f"Confluence returned HTTP {error.code} for {method} {path}") from None

    def find_by_title(self, space, title):
        query = urllib.parse.quote(f'space="{space}" and type=page and title="{title}"')
        found = self._request(f"/wiki/rest/api/content/search?cql={query}&limit=5")
        return [page["id"] for page in found.get("results", [])]

    def create_empty(self, space, parent_id, title):
        # The empty body is the point. Not "<p></p>", not "<p />" -- the
        # publisher's reconcile() treats only an empty or whitespace-only body
        # as equivalent to the empty base a first publication compares against.
        page = self._request("/wiki/rest/api/content", method="POST", payload={
            "type": "page",
            "title": title,
            "space": {"key": space},
            "ancestors": [{"id": str(parent_id)}],
            "body": {"storage": {"value": "", "representation": "storage"}},
        })
        return page["id"]


def document_title(path):
    first = path.read_text(encoding="utf-8").splitlines()[0]
    if not first.startswith("# "):
        raise CreateError(f"{path.as_posix()}: first line is not a level-one heading")
    return first[2:].strip()


def sha256_of(path):
    return hashlib.sha256(path.read_text(encoding="utf-8").encode("utf-8")).hexdigest()


def manifest_state():
    data = json.loads(MANIFEST.read_text(encoding="utf-8"))
    by_path = {entry["path"]: entry for entry in data["documents"]}
    orders = [entry["order"] for entry in data["documents"] if entry["disposition"] == "registered"]
    targets = {entry["target"] for entry in data["documents"] if entry["disposition"] == "registered"}
    return by_path, (max(orders) + 1 if orders else 0), targets


def plan_document(path, by_path, taken_targets, override_target, override_doc_set):
    relative = path.relative_to(REPO_ROOT).as_posix() if path.is_absolute() else path.as_posix()
    entry = by_path.get(relative)
    if entry is None:
        raise CreateError(f"{relative}: not listed in the manifest")
    if entry["disposition"] != "unpublished":
        raise CreateError(f"{relative}: already {entry['disposition']}; it has a target")
    target = override_target or path.stem
    if not TARGET_SLUG.fullmatch(target):
        raise CreateError(f"{relative}: target {target!r} is not lowercase letters, digits and hyphens")
    if target in taken_targets:
        raise CreateError(f"{relative}: target {target!r} is already registered")
    doc_set = override_doc_set
    if doc_set is None:
        match = re.match(r"^(cbd-\d+)-", path.stem)
        if not match:
            raise CreateError(f"{relative}: cannot infer a doc_set from the name; pass --doc-set")
        doc_set = match.group(1)
    return {"path": relative, "target": target, "doc_set": doc_set, "title": document_title(path)}


def emit(plan, page_id, order):
    entry = {
        "path": plan["path"],
        "disposition": "registered",
        "rationale": "TODO: why this document is published and what limits automation.",
        "authority": "TODO: who approved this exact document against this exact target, and when.",
        "reopen_when": "TODO: what would withdraw this approval.",
        "target": plan["target"],
        "page_id": page_id,
        "expected_title": plan["title"],
        "doc_set": plan["doc_set"],
        "order": order,
        "depends_on": [],
        "policy": "approved",
        "approved_sha256": sha256_of(REPO_ROOT / plan["path"]),
    }
    row = (f'    Target(\n'
           f'        target="{plan["target"]}",\n'
           f'        doc_set="{plan["doc_set"]}",\n'
           f'        page_id="{page_id}",\n'
           f'        expected_title="{plan["title"]}",\n'
           f'        path="{plan["path"]}",\n'
           f'    ),')
    return entry, row


def run(paths, space, parent, dry_run, client, override_target=None, override_doc_set=None):
    by_path, next_order, taken = manifest_state()
    plans = []
    for raw in paths:
        path = Path(raw)
        if not (REPO_ROOT / path).is_file():
            raise CreateError(f"{path.as_posix()}: no such file")
        plan = plan_document(path, by_path, taken, override_target, override_doc_set)
        taken.add(plan["target"])
        plans.append(plan)

    # Every duplicate-title check runs before any page is created, so a clash in
    # the last document does not leave the earlier ones half-created.
    for plan in plans:
        existing = client.find_by_title(space, plan["title"])
        if existing:
            raise CreateError(f"{plan['path']}: a page titled {plan['title']!r} already exists ({', '.join(existing)})")

    entries, rows = [], []
    for offset, plan in enumerate(plans):
        if dry_run:
            page_id = f"<dry-run:{plan['target']}>"
            print(f"DRY  would create {plan['title']!r} in {space} under {parent}")
        else:
            page_id = client.create_empty(space, parent, plan["title"])
            print(f"created {page_id}  {plan['title']}")
        entry, row = emit(plan, page_id, next_order + offset)
        entries.append(entry)
        rows.append(row)

    print("\n--- config/confluence-publication.json entries (fill the TODO fields) ---")
    print(json.dumps(entries, indent=2, ensure_ascii=False))
    print("\n--- scripts/sync-confluence.py TARGETS rows ---")
    print("\n".join(rows))
    print("\nBoth surfaces must agree or the publication contract fails "
          "registry-manifest-drift. Review, edit and commit them yourself; "
          "this script writes nothing in the repository.")
    return entries


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("paths", nargs="+", help="repository-relative document paths")
    parser.add_argument("--space", default="CBD", help="space key (default: CBD)")
    parser.add_argument("--parent", required=True, help="parent page id")
    parser.add_argument("--target", help="target slug; defaults to the file stem")
    parser.add_argument("--doc-set", dest="doc_set", help="doc_set; inferred from a cbd-NN- prefix")
    parser.add_argument("--dry-run", action="store_true", help="check and emit without creating")
    args = parser.parse_args(argv)

    if args.target and len(args.paths) > 1:
        print("--target names one slug, so it takes exactly one document", file=sys.stderr)
        return 2
    try:
        config = load_tool_config("confluence", load_env_file())
        client = ConfluenceClient(config["CONFLUENCE_BASE_URL"], config["CONFLUENCE_EMAIL"],
                                  config["CONFLUENCE_API_TOKEN"])
        run(args.paths, args.space, args.parent, args.dry_run, client, args.target, args.doc_set)
    except (CreateError, ConfigurationError) as error:
        print(f"create-confluence-target: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
