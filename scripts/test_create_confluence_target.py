"""Offline tests for create-confluence-target; no remote calls.

The property that matters is the empty body. A page created with any content --
including "<p></p>" -- fails its first publication with
ambiguous-structural-change, because reconcile() compares the live page against
an empty base. That is checked here against the publisher's own equivalence
function rather than against a hand-written expectation, so the test tracks the
publisher if its notion of empty ever changes.
"""

import contextlib
import importlib.util
import io
import json
import re
import unittest
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

spec = importlib.util.spec_from_file_location(
    "create_confluence_target", ROOT / "scripts/create-confluence-target.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

from publication import equivalent, reconcile, sections, PublicationError  # noqa: E402


class FakeClient(module.ConfluenceClient):
    """The real client with only the network replaced.

    An earlier version of this file built the request payload itself, which
    meant the empty-body assertions passed no matter what the script actually
    sent -- the test was checking the mock. Subclassing and stubbing only
    _request keeps create_empty and find_by_title running for real, so changing
    the body in the script fails these tests.
    """

    def __init__(self, existing=None):
        super().__init__("https://example.invalid", "nobody@example.invalid", "unused")
        self.existing = existing or {}
        self.created = []
        self.requests = []

    def _request(self, path, method="GET", payload=None):
        self.requests.append((method, path, payload))
        if method == "POST" and path == "/wiki/rest/api/content":
            self.created.append(payload)
            return {"id": f"9000{len(self.created)}"}
        if path.startswith("/wiki/rest/api/content/search"):
            title = urllib.parse.unquote(path.split("cql=", 1)[1].split("&", 1)[0])
            match = re.search(r'title="([^"]*)"', title)
            found = self.existing.get(match.group(1) if match else "", [])
            return {"results": [{"id": page} for page in found]}
        raise AssertionError(f"unexpected request {method} {path}")


def unpublished_documents(prefixed=True):
    """Unpublished paths, by default only those a doc_set can be inferred from.

    Not every unpublished document carries a cbd-NN- prefix -- docs/architecture.md
    does not -- and those legitimately require an explicit --doc-set, which is
    covered by its own test rather than worked around here.
    """
    data = json.loads((ROOT / "config/confluence-publication.json").read_text(encoding="utf-8"))
    paths = [e["path"] for e in data["documents"] if e["disposition"] == "unpublished"]
    selected = [p for p in paths if bool(re.match(r"docs/cbd-\d+-", p)) == prefixed]
    if not selected:
        raise AssertionError("no suitable unpublished document to test against")
    return selected


def quiet(*args, **kwargs):
    """run() prints the emitted rows for a human; tests want the return value."""
    with contextlib.redirect_stdout(io.StringIO()):
        return module.run(*args, **kwargs)


class CreateTargetTests(unittest.TestCase):
    def setUp(self):
        self.path = unpublished_documents()[0]

    def test_created_body_is_empty_by_the_publishers_definition(self):
        client = FakeClient()
        quiet([self.path], "CBD", "98415", False, client)
        body = client.created[0]["body"]["storage"]["value"]
        self.assertTrue(equivalent(body, ""),
                        "a created page must be empty by the publisher's own equivalence")

    def test_that_empty_body_actually_publishes(self):
        """The end the empty body exists for: a first publication must succeed."""
        client = FakeClient()
        quiet([self.path], "CBD", "98415", False, client)
        live = client.created[0]["body"]["storage"]["value"]
        desired = "<h1>A</h1><p>one</p><h2>B</h2><p>two</p>"
        self.assertEqual(reconcile("", live, desired), desired)

    def test_a_placeholder_body_would_have_failed(self):
        """The mistake this script prevents, pinned so it cannot be reintroduced."""
        placeholder = "<p>Placeholder. Content follows on the first publication run.</p>"
        with self.assertRaises(PublicationError):
            reconcile("", placeholder, "<h1>A</h1><p>one</p>")
        with self.assertRaises(PublicationError):
            reconcile("", "<p />", "<h1>A</h1><p>one</p>")

    def test_refuses_a_duplicate_title(self):
        title = module.document_title(ROOT / self.path)
        client = FakeClient(existing={title: ["123456"]})
        with self.assertRaises(module.CreateError):
            quiet([self.path], "CBD", "98415", False, client)
        self.assertEqual(client.created, [], "nothing may be created after a clash")

    def test_refuses_an_already_registered_document(self):
        data = json.loads((ROOT / "config/confluence-publication.json").read_text(encoding="utf-8"))
        registered = next(e["path"] for e in data["documents"] if e["disposition"] == "registered")
        client = FakeClient()
        with self.assertRaises(module.CreateError):
            quiet([registered], "CBD", "98415", False, client)
        self.assertEqual(client.created, [])

    def test_clash_in_a_later_document_creates_nothing_earlier(self):
        unpublished = unpublished_documents()
        if len(unpublished) < 2:
            self.skipTest("needs two unpublished documents")
        second_title = module.document_title(ROOT / unpublished[1])
        client = FakeClient(existing={second_title: ["123456"]})
        with self.assertRaises(module.CreateError):
            module.run(unpublished[:2], "CBD", "98415", False, client)
        self.assertEqual(client.created, [],
                         "a clash in the second document must not leave the first created")

    def test_a_document_without_a_cbd_prefix_needs_an_explicit_doc_set(self):
        other = unpublished_documents(prefixed=False)[0]
        client = FakeClient()
        with self.assertRaises(module.CreateError):
            quiet([other], "CBD", "98415", False, client)
        entries = quiet([other], "CBD", "98415", True, client, override_doc_set="handbook")
        self.assertEqual(entries[0]["doc_set"], "handbook")

    def test_dry_run_creates_nothing(self):
        client = FakeClient()
        quiet([self.path], "CBD", "98415", True, client)
        self.assertEqual(client.created, [])

    def test_emitted_entry_satisfies_the_manifest_shape(self):
        client = FakeClient()
        entries = quiet([self.path], "CBD", "98415", False, client)
        required = {"path", "disposition", "rationale", "authority", "reopen_when",
                    "target", "page_id", "expected_title", "doc_set", "order",
                    "depends_on", "policy", "approved_sha256"}
        self.assertEqual(set(entries[0]), required)
        self.assertEqual(entries[0]["disposition"], "registered")
        self.assertRegex(entries[0]["page_id"], r"^[0-9]+$")
        self.assertRegex(entries[0]["target"], r"^[a-z0-9-]+$")

    def test_emitted_title_matches_the_document_heading(self):
        client = FakeClient()
        entries = quiet([self.path], "CBD", "98415", False, client)
        first_line = (ROOT / self.path).read_text(encoding="utf-8").splitlines()[0]
        self.assertEqual(entries[0]["expected_title"], first_line[2:].strip())
        self.assertEqual(client.created[0]["title"], entries[0]["expected_title"])

    def test_emitted_sha_matches_the_document(self):
        client = FakeClient()
        entries = quiet([self.path], "CBD", "98415", False, client)
        self.assertEqual(entries[0]["approved_sha256"], module.sha256_of(ROOT / self.path))

    def test_order_continues_the_existing_sequence(self):
        data = json.loads((ROOT / "config/confluence-publication.json").read_text(encoding="utf-8"))
        highest = max(e["order"] for e in data["documents"] if e["disposition"] == "registered")
        client = FakeClient()
        entries = quiet([self.path], "CBD", "98415", False, client)
        self.assertEqual(entries[0]["order"], highest + 1)

    def test_a_document_without_a_heading_is_refused(self):
        stray = ROOT / "docs/.create-target-test-fixture.md"
        stray.write_text("no heading here\n", encoding="utf-8")
        try:
            with self.assertRaises(module.CreateError):
                module.document_title(stray)
        finally:
            stray.unlink()

    def test_converted_document_still_parses_into_sections(self):
        """Guards the assumption that desired content has headings to reconcile."""
        self.assertTrue(sections("<h1>A</h1><p>one</p>"))


if __name__ == "__main__":
    unittest.main()
