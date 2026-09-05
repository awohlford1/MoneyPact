"""Synthetic API fixtures and isolated Git repositories; never load real secrets."""

import copy
import io
import json
import subprocess
import sys
import tempfile
import unittest
import urllib.error
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import MagicMock, Mock, patch

import publication as p
import publication_transport as transport
import publish_confluence as runner
from publication_contract import check, validate_workflow

HEAD = "a" * 40
BASE = "<h1>Title</h1>\n<p>Old</p>\n<h2>Other</h2>\n<p>Keep</p>"
DESIRED = BASE.replace("Old", "New")


def entry(name="one", page="100", order=0, body="body", dependencies=None):
    return {"path": "docs/" + name + ".md", "disposition": "registered",
            "rationale": "Approved source for this registered fixture page.",
            "authority": "Owner approval recorded in this synthetic fixture.",
            "reopen_when": "Owner approves a replacement source and target mapping.",
            "target": name, "page_id": page, "expected_title": "Fixture " + name,
            "doc_set": "fixture", "order": order, "depends_on": dependencies or [],
            "policy": "approved", "approved_sha256": p.sha256(body)}


def manifest(entries=None):
    return {"schema": 1, "bootstrap_sha": HEAD, "documents": entries or [entry()], "retained_pages": []}


def page(body=BASE, version=7, target=None):
    target = target or entry()
    return {"id": target["page_id"], "title": target["expected_title"], "status": "current",
            "version": {"number": version}, "body": {"storage": {"value": body}}}


class MemoryAPI:
    def __init__(self, body=BASE):
        self.body, self.version = body, 7
        self.gets, self.puts = [], []

    def get(self, identity):
        self.gets.append(identity)
        return page(self.body, self.version)

    def put(self, target, body, version, head):
        self.puts.append((target, body, version, head))
        self.body, self.version = body, version


def workflow_run(identity=1, head=HEAD, attempt=1, status="completed", conclusion="failure"):
    return {"id": identity, "run_attempt": attempt, "event": "push", "head_branch": "main",
            "status": status, "conclusion": conclusion, "repository": {"full_name": "awohlford1/CoBudget"},
            "path": ".github/workflows/publish-confluence.yml", "head_sha": head}


def workflow_jobs(run, conclusion="failure", step_status="completed"):
    return {"total_count": 1, "jobs": [{"run_id": run["id"], "head_sha": run["head_sha"],
            "name": "Approved merged documentation publication", "status": "completed",
            "conclusion": "success" if conclusion == "success" else "failure",
            "steps": [{"name": "Publish approved selected documents", "status": step_status,
                       "conclusion": conclusion}]}]}


def mock_history(runs, jobs):
    history = object.__new__(transport.WorkflowHistory)
    history.client = Mock()
    history.client.request.side_effect = [{"total_count": len(runs), "workflow_runs": runs}, *jobs]
    return history


EMPTY_RECOVERY = {"schema": 1, "reconciled_attempts": []}


class ManifestTests(unittest.TestCase):
    def validate(self, value, bodies=None, targets=None):
        bodies = bodies or {"docs/one.md": "body"}
        return p.validate_manifest(value, set(bodies), bodies, targets)

    def test_valid_and_repository_inventory(self):
        self.validate(manifest())
        check()

    def test_missing_extra_duplicate_paths(self):
        for mutate in (lambda m: m["documents"].append(entry()),
                       lambda m: m["documents"].clear(),
                       lambda m: m["documents"][0].update(path="docs/extra.md")):
            value = manifest()
            mutate(value)
            with self.subTest(value=value), self.assertRaises(p.PublicationError):
                self.validate(value)

    def test_duplicate_keys_pages_and_orders(self):
        bodies = {"docs/one.md": "body", "docs/two.md": "body"}
        for field in ("target", "page_id", "order"):
            value = manifest([entry(), entry("two", "200", 1)])
            value["documents"][1][field] = value["documents"][0][field]
            with self.subTest(field=field), self.assertRaises(p.PublicationError):
                self.validate(value, bodies)

    def test_unpublished_requires_specific_complete_disposition(self):
        value = manifest()
        row = value["documents"][0]
        for field in ("target", "page_id", "expected_title", "doc_set", "order", "depends_on", "policy", "approved_sha256"):
            row.pop(field)
        row["disposition"] = "unpublished"
        self.validate(value)
        for field in ("authority", "rationale", "reopen_when"):
            changed = copy.deepcopy(value)
            changed["documents"][0][field] = "Not published"
            with self.subTest(field=field), self.assertRaises(p.PublicationError):
                self.validate(changed)
        row["page_id"] = "100"
        with self.assertRaises(p.PublicationError):
            self.validate(value)

    def test_approval_hash_and_held_policy(self):
        value = manifest()
        with self.assertRaisesRegex(p.PublicationError, "unapproved-source"):
            self.validate(value, {"docs/one.md": "changed"})
        value["documents"][0].update(policy="held", approved_sha256=None)
        self.validate(value)
        value["documents"][0]["approved_sha256"] = "unapproved"
        with self.assertRaises(p.PublicationError):
            self.validate(value)

    def test_missing_cyclic_duplicate_dependencies(self):
        for dependencies in (["unknown"], ["one"], ["one", "one"]):
            with self.subTest(dependencies=dependencies), self.assertRaises(p.PublicationError):
                self.validate(manifest([entry(dependencies=dependencies)]))

    def test_registry_title_mismatch(self):
        target = entry()
        target["expected_title"] = "Wrong"
        with self.assertRaisesRegex(p.PublicationError, "registry-manifest-drift"):
            self.validate(manifest(), targets=[target])

    def test_duplicate_json_keys_and_malformed(self):
        for raw in ('{"a":1,"a":2}', '{'):
            with self.subTest(raw=raw), self.assertRaises(p.PublicationError):
                p.json_object(raw)

    def test_invalid_retained_metadata_types(self):
        for field in ("former_path", "page_id", "expected_title", "authority", "rationale"):
            value = manifest()
            retained = {"former_path": "docs/gone.md", "page_id": "200", "expected_title": "Gone",
                        "authority": "Owner approved retention", "rationale": "Source retired; live page retained"}
            retained[field] = None
            value["retained_pages"].append(retained)
            with self.subTest(field=field), self.assertRaises(p.PublicationError):
                self.validate(value)

    def test_schema_and_target_fields_are_strict(self):
        for field, invalid in (("page_id", "١٢٣"), ("expected_title", " title "), ("doc_set", "line\nbreak"),
                               ("order", True), ("depends_on", "one")):
            value = manifest()
            value["documents"][0][field] = invalid
            with self.subTest(field=field), self.assertRaises(p.PublicationError):
                self.validate(value)
        value = manifest()
        value["schema"] = True
        with self.assertRaises(p.PublicationError):
            self.validate(value)


class SelectionTests(unittest.TestCase):
    def test_one_modified_plus_required_baselines_only(self):
        rows = [entry(), entry("two", "200", 1, dependencies=["one"]), entry("unrelated", "300", 2)]
        value = manifest(rows)
        bodies = {row["path"]: "body" for row in rows}
        desired = dict(bodies, **{"docs/two.md": "modified"})
        chosen = p.select_documents(value, value, bodies, desired)
        self.assertEqual([row[0]["target"] for row in chosen], ["one", "two"])
        self.assertEqual(chosen[0][1:], ("body", "body"))

    def test_no_change_no_selection(self):
        self.assertEqual(p.select_documents(manifest(), manifest(), {"docs/one.md": "body"}, {"docs/one.md": "body"}), [])

    def test_new_and_rename_preserve_page_identity(self):
        old = manifest()
        new = manifest([entry("renamed")])
        new["documents"][0].update(target="one", expected_title="Fixture one")
        self.assertEqual(p.select_documents(old, new, {"docs/one.md": "body"}, {"docs/renamed.md": "body"}), [])
        chosen = p.select_documents(old, new, {"docs/one.md": "body"}, {"docs/renamed.md": "new"})
        self.assertEqual(chosen[0][1:], ("body", "new"))
        new["documents"].append(entry("new", "200", 1))
        chosen = p.select_documents(old, new, {"docs/one.md": "body"}, {"docs/renamed.md": "body", "docs/new.md": "new"})
        self.assertEqual(chosen[0][1:], ("", "new"))

    def test_deleted_target_requires_explicit_retention_no_remote_delete(self):
        old, new = manifest(), manifest()
        new["documents"] = []
        with self.assertRaisesRegex(p.PublicationError, "retained-page"):
            p.select_documents(old, new, {"docs/one.md": "body"}, {})
        new["retained_pages"] = [{"page_id": "100", "former_path": "docs/one.md"}]
        self.assertEqual(p.select_documents(old, new, {"docs/one.md": "body"}, {}), [])

    def test_retarget_keeps_old_page_and_title_changes_require_live_validation(self):
        old, new = manifest(), manifest()
        new["documents"][0]["page_id"] = "200"
        new["retained_pages"] = [{"former_path": "docs/one.md", "page_id": "100", "expected_title": "Old page",
                                  "authority": "Owner approved target replacement", "rationale": "Old page retained after migration"}]
        p.validate_manifest(new, {"docs/one.md"}, {"docs/one.md": "body"})
        selected = p.select_documents(old, new, {"docs/one.md": "body"}, {"docs/one.md": "body"})
        self.assertEqual(selected[0][0]["page_id"], "200")
        self.assertEqual(selected[0][1], "")
        new = manifest()
        new["documents"][0]["expected_title"] = "Renamed title"
        selected = p.select_documents(old, new, {"docs/one.md": "body"}, {"docs/one.md": "body"})
        self.assertEqual(len(selected), 1)
        self.assertEqual(selected[0][1:], ("body", "body"))

    def test_held_changed_and_held_dependency_fail(self):
        value = manifest()
        value["documents"][0]["policy"] = "held"
        with self.assertRaisesRegex(p.PublicationError, "awaits-approval"):
            p.select_documents(value, value, {"docs/one.md": "old"}, {"docs/one.md": "new"})
        value["documents"].append(entry("two", "200", 1, dependencies=["one"]))
        with self.assertRaisesRegex(p.PublicationError, "baseline-awaits-approval"):
            p.select_documents(value, value, {"docs/one.md": "same", "docs/two.md": "old"}, {"docs/one.md": "same", "docs/two.md": "new"})


class ReconciliationTests(unittest.TestCase):
    def test_meaningful_whitespace_edits_conflict_without_put(self):
        for original, human in (
                ('<p>Old total 1 000</p>', '<p>Old total 1&#160;000</p>'),
                ('<p>Old A B</p>', '<p>Old A\u2003B</p>'),
                ('<p style="white-space: pre-wrap">Old A B</p>', '<p style="white-space: pre-wrap">Old A  B</p>'),
                ('<div class="preserve"><span>Old A B</span></div>', '<div class="preserve"><span>Old A  B</span></div>'),
                ('<div>Old <b>A</b> <b>B</b></div>', '<div>Old <b>A</b><b>B</b></div>')):
            base, live = '<h1>Title</h1>' + original, '<h1>Title</h1>' + human
            self.assertFalse(p.equivalent(base, live))
            api = MemoryAPI(live)
            with self.subTest(original=original), self.assertRaisesRegex(p.PublicationError, 'overlapping-live-edit'):
                p.execute_plan(api, [(entry(), base, base.replace('Old', 'New'))], HEAD, lambda row: None)
            self.assertEqual(api.puts, [])

    def test_whitespace_only_desired_change_is_not_skipped(self):
        base = '<h1>Title</h1><p>A B</p>'
        desired = base.replace('A B', 'A\u00a0B')
        api = MemoryAPI(base)
        p.execute_plan(api, [(entry(), base, desired)], HEAD, lambda row: None)
        self.assertEqual(api.body, desired)
        self.assertEqual(len(api.puts), 1)

    def test_only_proven_interblock_whitespace_is_ignored(self):
        self.assertTrue(p.equivalent('<p>A</p>\n<h2>B</h2>\n', '<p>A</p><h2>B</h2>'))
        for left, right in [('<b>A</b> <b>B</b>', '<b>A</b><b>B</b>'),
                            (' <span>A</span>', '<span>A</span>'),
                            ('<span>A</span> ', '<span>A</span>'),
                            ('<div style="display:inline">A</div> <div>B</div>', '<div style="display:inline">A</div><div>B</div>'),
                            ('<div class="inline">A</div> <div>B</div>', '<div class="inline">A</div><div>B</div>'),
                            ('<p>A</p>\u00a0<p>B</p>', '<p>A</p><p>B</p>')]:
            with self.subTest(left=left):
                self.assertFalse(p.equivalent(left, right))

    def test_unrelated_live_section_byte_preserved(self):
        live = BASE.replace("<p>Keep</p>", '<p class="local"><em>Human edit</em></p>')
        self.assertEqual(p.reconcile(BASE, live, DESIRED), live.replace("Old", "New"))

    def test_overlap_is_real_conflict(self):
        with self.assertRaises(p.PublicationError) as raised:
            p.reconcile(BASE, BASE.replace("Old", "Human"), DESIRED)
        self.assertEqual(raised.exception.code, "overlapping-live-edit")
        self.assertEqual(raised.exception.section, ((1, "Title"),))

    def test_already_applied_noop(self):
        self.assertEqual(p.reconcile(BASE, DESIRED, DESIRED), DESIRED)

    def test_semantics_include_links_attributes_code_and_inline_space(self):
        for left, right in [('<a href="/a">x</a>', '<a href="/b">x</a>'),
                            ("<pre>a  b</pre>", "<pre>a b</pre>"),
                            ("<p><b>A</b> <b>B</b></p>", "<p><b>A</b><b>B</b></p>"),
                            ('<td colspan="2">x</td>', '<td colspan="3">x</td>')]:
            with self.subTest(left=left):
                self.assertFalse(p.equivalent(left, right))

    def test_only_local_ids_and_interblock_formatting_are_ignored(self):
        self.assertTrue(p.equivalent('<p data-local-id="123">A &amp; B</p>\n', '<p>A &#38; B</p>'))

    def test_unknown_malformed_duplicate_nested_and_empty_headings(self):
        for body in ('<ac:structured-macro/>', '<p>oops', '<p></div>', '<!--comment-->',
                     '<h1>A</h1><h1>A</h1>', '<div><h2>Nested</h2></div>', '<h1> </h1>',
                     '<p class="a" class="b">x</p>', '<!DOCTYPE html>', '<?xml x?>',
                     '<p>oops</p><', '<p>A & B</p>', '<p>&unknown;</p>'):
            with self.subTest(body=body), self.assertRaises(p.PublicationError):
                p.sections(body)

    def test_missing_or_reordered_live_headings_fail_closed(self):
        for body in (BASE.replace("<h2>Other</h2>", ""), '<h2>Other</h2><h1>Title</h1>'):
            with self.subTest(body=body), self.assertRaises(p.PublicationError):
                p.reconcile(BASE, body, DESIRED)

    def test_structure_change_preserves_unchanged_raw_markup(self):
        base = '<h1>Title</h1><p>Same</p>'
        live = '<h1 data-local-id="123">Title</h1><p>Same</p>'
        desired = base + '<h2>New</h2><p>Added</p>'
        self.assertEqual(p.reconcile(base, live, desired), live + '<h2>New</h2><p>Added</p>')
        with self.assertRaises(p.PublicationError):
            p.reconcile(base, live.replace("Same", "Human"), desired)

    def test_size_limit_and_actual_cbd70_catalog(self):
        with self.assertRaisesRegex(p.PublicationError, "manual-handling-size"):
            p.bounded("x" * (p.MAX_BODY + 1))
        source = (p.ROOT / "docs/cbd-70-scenario-catalog.md").read_text(encoding="utf-8")
        storage = p.converter()(source)
        self.assertGreater(len(storage), 50000)
        self.assertLess(len(storage.encode()), p.MAX_BODY)
        self.assertEqual(p.reconcile(storage, storage, storage), storage)


class ExecutionTests(unittest.TestCase):
    def test_changed_and_transitive_baselines_remain_strict_gates(self):
        rows = [entry(), entry('two', '200', 1, dependencies=['one']),
                entry('three', '300', 2, dependencies=['two'])]
        before = {row['path']: BASE for row in rows}
        desired = {row['path']: DESIRED for row in rows}
        selected = p.select_documents(manifest(rows), manifest(rows), before, desired)
        self.assertTrue(selected[0][0]['required_baseline'])
        self.assertTrue(selected[1][0]['required_baseline'])
        self.assertNotIn('required_baseline', selected[2][0])
        for live in (BASE.replace('Keep', 'Human baseline divergence'),
                     DESIRED.replace('Keep', 'Human baseline divergence')):
            api = MemoryAPI(live)
            with self.subTest(live=live), self.assertRaisesRegex(p.PublicationError, 'baseline-not-current'):
                p.execute_plan(api, selected, HEAD, lambda row: None)
            self.assertEqual(api.puts, [])
            self.assertEqual(api.gets, ['100'])
        # A baseline that reconciles exactly to its approved source can update.
        api = MemoryAPI(BASE)
        p.execute_plan(api, selected[:1], HEAD, lambda row: None)
        self.assertEqual(api.body, DESIRED)

    def test_failed_readback_cannot_be_reclassified_by_workflow_retry(self):
        for damaged in (DESIRED.replace('Keep', 'DAMAGED'),
                        DESIRED.replace('<h2>', '<h2 data-local-id="changed">')):
            api = Mock()
            api.get.side_effect = [page(), page(), page(damaged, 8)]
            with self.subTest(damaged=damaged), self.assertRaises(p.PublicationError):
                self.execute(api)
            failed = workflow_run()
            current = workflow_run(2, status='in_progress', conclusion=None)
            history = mock_history([current, failed], [workflow_jobs(failed)])
            with patch.object(runner, 'Confluence') as credentials:
                with self.assertRaisesRegex(p.PublicationError, 'requires-reviewed-reconciliation'):
                    history.safe_heads(2, 1, HEAD, EMPTY_RECOVERY)
                credentials.assert_not_called()

    def execute(self, api, before=BASE, after=DESIRED, baseline=False):
        rows = []
        p.execute_plan(api, [(dict(entry(), baseline_only=baseline), before, after)], HEAD, rows.append)
        return rows

    def test_update_expected_version_and_verified_readback(self):
        api = MemoryAPI()
        rows = self.execute(api)
        self.assertEqual(len(api.puts), 1)
        self.assertEqual(api.puts[0][2:], (8, HEAD))
        self.assertEqual(api.gets, ["100"] * 3)
        self.assertEqual((rows[0]["action"], rows[0]["prior_version"], rows[0]["stored_version"], rows[0]["verified"]), ("update", 7, 8, True))

    def test_noop_and_recovery_after_interrupted_put(self):
        api = MemoryAPI(DESIRED)
        rows = self.execute(api)
        self.assertEqual(api.puts, [])
        self.assertEqual(rows[0]["action"], "no-op")
        self.assertEqual(api.version, 7)

    def test_bad_identity_baseline_overlap_stop_dependent_without_put(self):
        for first in (dict(page(), id="200"), dict(page(), title="Wrong"),
                      dict(page(), status="trashed"), page(BASE.replace("Old", "Human")), {}):
            api = Mock()
            api.get.return_value = first
            rows = []
            with self.subTest(first=first), self.assertRaises(p.PublicationError):
                p.execute_plan(api, [(entry(), BASE, DESIRED), (entry("two", "200", 1), BASE, DESIRED)], HEAD, rows.append)
            api.put.assert_not_called()
            self.assertEqual(api.get.call_count, 1)
            self.assertFalse(rows[0]["verified"])
        api = MemoryAPI(BASE.replace("Old", "Human"))
        with self.assertRaisesRegex(p.PublicationError, "baseline-not-current"):
            self.execute(api, BASE, BASE, baseline=True)
        self.assertEqual(api.puts, [])

    def test_semantic_no_change_is_not_mistaken_for_a_required_baseline(self):
        api = MemoryAPI(BASE.replace("Keep", "Human addition"))
        rows = self.execute(api, BASE, BASE)
        self.assertEqual(rows[0]["action"], "no-op")
        self.assertEqual(api.puts, [])
        self.assertIn("Human addition", api.body)

    def test_preput_version_and_same_version_body_race(self):
        for reread in (page(BASE, 8), page(DESIRED, 7)):
            api = Mock()
            api.get.side_effect = [page(), reread]
            with self.subTest(reread=reread), self.assertRaisesRegex(p.PublicationError, "stale-version"):
                self.execute(api)
            api.put.assert_not_called()

    def test_put_failure_never_retries_or_reports_published(self):
        api = Mock()
        api.get.return_value = page()
        api.put.side_effect = p.PublicationError("stale-version-conflict")
        rows = []
        with self.assertRaises(p.PublicationError):
            p.execute_plan(api, [(entry(), BASE, DESIRED)], HEAD, rows.append)
        self.assertEqual(api.put.call_count, 1)
        self.assertEqual(rows[0]["action"], "conflict")

    def test_readback_semantic_and_preserved_bytes_and_version(self):
        for after in (page(BASE, 8), page(DESIRED, 9), page(DESIRED.replace("<h2>", '<h2 data-local-id="new">'), 8)):
            api = Mock()
            api.get.side_effect = [page(), page(), after]
            with self.subTest(after=after), self.assertRaises(p.PublicationError):
                self.execute(api)
            self.assertEqual(api.put.call_count, 1)

    def test_evidence_excludes_full_bodies_and_heading_text(self):
        body = BASE.replace("Title", "Sensitive heading fixture")
        rows = []
        with self.assertRaises(p.PublicationError):
            p.execute_plan(MemoryAPI(body.replace("Old", "Human")), [(entry(), body, body.replace("Old", "New"))], HEAD, rows.append)
        output = json.dumps(rows)
        self.assertNotIn("Sensitive heading fixture", output)
        self.assertNotIn("<p>", output)
        self.assertIn("heading_path_fingerprint", output)


class TransportTests(unittest.TestCase):
    def test_retired_manual_writer_cannot_put(self):
        p.converter()
        legacy = sys.modules["cbd115_legacy_converter"]
        session = Mock()
        with self.assertRaisesRegex(RuntimeError, "Manual publication is disabled"):
            legacy.publish(session, "https://example.invalid", None, "body", 1, "title")
        session.put.assert_not_called()
        with patch.object(legacy, "session_from_env") as credentials, patch("sys.argv", ["sync-confluence.py"]):
            with self.assertRaisesRegex(SystemExit, "Manual publication is disabled"):
                legacy.main()
            credentials.assert_not_called()
        session.get.assert_not_called()
        session.put.assert_not_called()

    def client(self, payload=None, error=None, status=200):
        client = transport.JsonClient("https://example.invalid", "Synthetic authorization")
        client.opener = MagicMock()
        if error:
            client.opener.open.side_effect = error
        else:
            response = Mock()
            response.status = status
            response.read.return_value = payload if isinstance(payload, bytes) else json.dumps(payload or {}).encode()
            client.opener.open.return_value.__enter__.return_value = response
        return client

    def test_http_errors_timeout_redirect_malformed_and_limits(self):
        for status in (301, 302, 400, 401, 403, 404, 409, 429, 500, 503):
            error = urllib.error.HTTPError("https://example.invalid", status, "sensitive failure", {}, io.BytesIO(b"private body"))
            client = self.client(error=error)
            with self.subTest(status=status), self.assertRaises(p.PublicationError) as raised:
                client.request("/page")
            self.assertNotIn("sensitive", str(raised.exception))
            self.assertEqual(client.opener.open.call_count, 1)
        for client in (self.client(error=TimeoutError("private")), self.client(payload=b"{"),
                       self.client(payload=b"\xff"), self.client(payload=b"x" * (p.MAX_BODY * 3 + 1)), self.client(status=201)):
            with self.assertRaises(p.PublicationError):
                client.request("/page")

    def test_redirect_handler_refuses_forwarding(self):
        self.assertIsNone(transport.NoRedirect().redirect_request(None, None, 302, "", {}, "https://elsewhere.invalid"))

    def test_confluence_destination_validation_and_exact_put(self):
        values = {"CONFLUENCE_BASE_URL": "https://elsewhere.invalid", "CONFLUENCE_EMAIL": "fixture@example.invalid", "CONFLUENCE_API_TOKEN": "synthetic"}
        with patch("publication_transport.load_tool_config", return_value=values), patch("publication_transport.JsonClient") as client:
            with self.assertRaisesRegex(p.PublicationError, "unapproved-confluence-origin"):
                transport.Confluence()
            client.assert_not_called()
        values["CONFLUENCE_BASE_URL"] = "https://cobudget.atlassian.net"
        with patch("publication_transport.load_tool_config", return_value=values), patch("publication_transport.JsonClient") as client:
            api = transport.Confluence()
            client.return_value.request.return_value = page(DESIRED, 8)
            api.put(entry(), DESIRED, 8, HEAD)
            args = client.return_value.request.call_args.args
            self.assertEqual(args[0:2], ("/wiki/api/v2/pages/100", "PUT"))
            self.assertEqual(args[2]["version"]["number"], 8)
            self.assertEqual(args[2]["body"]["value"], DESIRED)
            for response in ({}, [], None, page(DESIRED, 9), dict(page(DESIRED, 8), id="200")):
                client.return_value.request.return_value = response
                with self.subTest(response=response), self.assertRaisesRegex(p.PublicationError, "invalid-update-acknowledgement"):
                    api.put(entry(), DESIRED, 8, HEAD)

    def test_history_validates_run_provenance_and_pagination(self):
        run = workflow_run()
        history = mock_history([], [])
        history.client.request.side_effect = [
            {"total_count": 101, "workflow_runs": [workflow_run(i) for i in range(1, 101)]},
            {"total_count": 101, "workflow_runs": [workflow_run(101)]}]
        self.assertEqual(len(history.runs()), 101)
        self.assertEqual(history.client.request.call_count, 2)
        self.assertNotIn('status=success', history.client.request.call_args.args[0])
        for field in ("event", "head_branch", "path", "repository", "id", "run_attempt", "head_sha"):
            changed = dict(run)
            changed[field] = {} if field == "repository" else "wrong"
            history.client.request.side_effect = None
            history.client.request.return_value = {"total_count": 1, "workflow_runs": [changed]}
            with self.subTest(field=field), self.assertRaises(p.PublicationError):
                history.runs()
        for response in ({'total_count': 1000, 'workflow_runs': [run]},
                         {'total_count': 2, 'workflow_runs': [run]},
                         {'total_count': 2, 'workflow_runs': [run, run]}, {'workflow_runs': []}):
            history.client.request.return_value = response
            with self.subTest(response=response), self.assertRaises(p.PublicationError):
                history.runs()

    def test_history_allows_verified_success_and_skipped_publication_only(self):
        current = workflow_run(3, status='in_progress', conclusion=None)
        successful = workflow_run(1, conclusion='success')
        skipped = workflow_run(2)
        history = mock_history([current, successful, skipped],
                               [workflow_jobs(successful, 'success'), workflow_jobs(skipped, 'skipped')])
        self.assertEqual(history.safe_heads(3, 1, HEAD, EMPTY_RECOVERY), {"successful": [HEAD], "reconciled": []})

    def test_rerun_does_not_hide_previous_failed_or_uncertain_attempt(self):
        for conclusion, status in [('failure', 'completed'), ('cancelled', 'completed'),
                                   (None, 'in_progress'), ('success', 'completed')]:
            current = workflow_run(1, attempt=2, status='in_progress', conclusion=None)
            history = mock_history([current], [workflow_jobs(current, conclusion, status)])
            with self.subTest(conclusion=conclusion), self.assertRaisesRegex(p.PublicationError, 'requires-reviewed-reconciliation'):
                history.safe_heads(1, 2, HEAD, EMPTY_RECOVERY)
        current = workflow_run(1, attempt=2, status='in_progress', conclusion=None)
        history = mock_history([current], [workflow_jobs(current, 'skipped')])
        self.assertEqual(history.safe_heads(1, 2, HEAD, EMPTY_RECOVERY), {"successful": [], "reconciled": []})

    def test_history_rejects_missing_malformed_or_substituted_attempt_evidence(self):
        current = workflow_run(2, status='in_progress', conclusion=None)
        failed = workflow_run()
        for response in ({}, {'total_count': 0, 'jobs': []},
                         {'total_count': 2, 'jobs': workflow_jobs(failed)['jobs']}):
            history = mock_history([current, failed], [response])
            with self.subTest(response=response), self.assertRaises(p.PublicationError):
                history.safe_heads(2, 1, HEAD, EMPTY_RECOVERY)
        for field, value in [('run_id', 99), ('head_sha', 'b' * 40), ('name', 'Other job'), ('steps', [])]:
            response = workflow_jobs(failed)
            response['jobs'][0][field] = value
            history = mock_history([current, failed], [response])
            with self.subTest(field=field), self.assertRaises(p.PublicationError):
                history.safe_heads(2, 1, HEAD, EMPTY_RECOVERY)
        for run_id, attempt, head in [(99, 1, HEAD), (2, 2, HEAD), (2, 1, 'b' * 40), (True, 1, HEAD)]:
            history = mock_history([current], [])
            with self.subTest(run_id=run_id, attempt=attempt), self.assertRaises(p.PublicationError):
                history.safe_heads(run_id, attempt, head, EMPTY_RECOVERY)

    def test_recovery_approval_is_exact_and_cannot_cover_a_later_attempt(self):
        failed = workflow_run()
        current = workflow_run(2, status='in_progress', conclusion=None)
        approval = {'run_id': 1, 'attempt': 1, 'head_sha': HEAD, 'checkpoint_sha': 'b' * 40,
                    'authority': 'Owner verified affected pages and original preserved sections; synthetic evidence.'}
        recovery = {'schema': 1, 'reconciled_attempts': [approval]}
        history = mock_history([current, failed], [workflow_jobs(failed)])
        self.assertEqual(history.safe_heads(2, 1, HEAD, recovery), {"successful": [], "reconciled": [approval]})
        for field, value in [('run_id', 99), ('attempt', 2), ('head_sha', 'c' * 40)]:
            changed = copy.deepcopy(recovery)
            changed['reconciled_attempts'][0][field] = value
            history = mock_history([current, failed], [workflow_jobs(failed)])
            with self.subTest(field=field), self.assertRaisesRegex(p.PublicationError, 'requires-reviewed-reconciliation'):
                history.safe_heads(2, 1, HEAD, changed)
        for invalid in ({}, {'schema': True, 'reconciled_attempts': []},
                        {'schema': 1, 'reconciled_attempts': [approval, approval]},
                        {'schema': 1, 'reconciled_attempts': [dict(approval, authority='')]},
                        {'schema': 1, 'reconciled_attempts': [dict(approval, checkpoint_sha='invalid')]}):
            with self.subTest(invalid=invalid), self.assertRaises(p.PublicationError):
                transport.validate_recovery(invalid)

    def test_queued_rerun_still_checks_prior_attempts(self):
        current = workflow_run(2, status='in_progress', conclusion=None)
        queued = workflow_run(1, attempt=2, status='queued', conclusion=None)
        history = mock_history([current, queued], [workflow_jobs(queued)])
        with self.assertRaisesRegex(p.PublicationError, 'requires-reviewed-reconciliation'):
            history.safe_heads(2, 1, HEAD, EMPTY_RECOVERY)

    def test_a_newer_success_cannot_hide_an_unresolved_attempt(self):
        failed = workflow_run(1)
        successful = workflow_run(2, conclusion='success')
        current = workflow_run(3, status='in_progress', conclusion=None)
        history = mock_history([current, successful, failed],
                               [workflow_jobs(successful, 'success'), workflow_jobs(failed)])
        with self.assertRaisesRegex(p.PublicationError, 'requires-reviewed-reconciliation'):
            history.safe_heads(3, 1, HEAD, EMPTY_RECOVERY)


class GitAndContractTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="cbd115-fixture-")
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        self.git("init", "--initial-branch=main")
        self.git("config", "user.name", "Publication Fixture")
        self.git("config", "user.email", "fixture@example.invalid")
        self.first = self.commit("first")
        self.second = self.commit("second")
        self.third = self.commit("third")

    def git(self, *args):
        result = subprocess.run(["git", *args], cwd=self.repo, capture_output=True, check=True)
        return result.stdout.decode().strip()

    def commit(self, name):
        self.git("commit", "--allow-empty", "-m", name)
        return self.git("rev-parse", "HEAD")

    def revision(self, files):
        for name, body in files.items():
            path = self.repo / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(body, encoding="utf-8", newline="\n")
        self.git("add", ".")
        return self.commit("fixture source change")

    def test_partial_write_then_revert_blocks_real_commit_preparation(self):
        old_source = '# Fixture\n\nOld\n\n## Other\n\nKeep'
        new_source = old_source.replace('Old', 'New')
        rows = [entry('one', '100', 0, old_source), entry('two', '200', 1, old_source)]
        value = manifest(rows)
        value['bootstrap_sha'] = self.first
        active = {'enabled': True, 'prerequisites': {'CBD-113': 'Done', 'CBD-114': 'Done'},
                  'owner_approval': 'Synthetic owner approval for isolated fixture.',
                  'exclusive_writer_approval': 'Synthetic fixture has no concurrent writers.', 'smoke_target': 'one'}
        before = self.revision({'docs/one.md': old_source, 'docs/two.md': old_source,
                               p.MANIFEST: json.dumps(value), 'config/confluence-activation.json': json.dumps(active),
                               'config/confluence-recovery.json': json.dumps(EMPTY_RECOVERY)})
        rows[0]['approved_sha256'] = rows[1]['approved_sha256'] = p.sha256(new_source)
        first = self.revision({'docs/one.md': new_source, 'docs/two.md': new_source, p.MANIFEST: json.dumps(value)})
        with patch.object(runner, 'registry', return_value=rows):
            planned = runner.build_plan(self.repo, runner.prepare(self.repo, before, first, lambda: [before]))
        api = MemoryAPI(p.converter()(old_source))
        # First page really updates and verifies; second page's GET then fails.
        original_get = api.get
        def get(identity):
            if identity == '200':
                raise p.PublicationError('http-request-failed')
            return original_get(identity)
        api.get = get
        with self.assertRaisesRegex(p.PublicationError, 'http-request-failed'):
            p.execute_plan(api, planned, first, lambda row: None)
        self.assertEqual(api.body, p.converter()(new_source))
        rows[0]['approved_sha256'] = p.sha256(old_source)
        later = self.revision({'docs/one.md': old_source, p.MANIFEST: json.dumps(value)})
        failed, current = workflow_run(1, first), workflow_run(2, later, status='in_progress', conclusion=None)
        history = mock_history([current, failed], [workflow_jobs(failed)])
        plan_path = self.repo / '.cache/review-plan.json'
        output = io.StringIO()
        with patch.object(runner, 'ROOT', self.repo), patch.object(runner, 'PLAN', plan_path), \
                patch.object(runner, 'registry', return_value=rows), \
                patch.object(runner, 'WorkflowHistory', return_value=history), \
                patch.object(runner, 'Confluence') as credentials, \
                patch('sys.argv', ['publish_confluence.py', 'prepare', first, later, '--run-id', '2', '--run-attempt', '1']), \
                redirect_stdout(output):
            self.assertEqual(runner.main(), 1)
        credentials.assert_not_called()
        self.assertFalse(plan_path.exists())
        self.assertIn('requires-reviewed-reconciliation', output.getvalue())
        self.assertNotIn('"verified": true', output.getvalue())

    def test_recovery_checkpoint_requires_existing_ancestral_commit_before_auth(self):
        (self.repo / 'config').mkdir()
        for checkpoint in (self.third, HEAD, '0' * 40):
            value = {'schema': 1, 'reconciled_attempts': [
                {'run_id': 1, 'attempt': 1, 'head_sha': self.first, 'checkpoint_sha': checkpoint,
                 'authority': 'Synthetic owner-reviewed reconciliation evidence.'}]}
            (self.repo / 'config/confluence-recovery.json').write_text(json.dumps(value), encoding='utf-8')
            with self.subTest(checkpoint=checkpoint), patch.object(runner, 'WorkflowHistory') as credentials:
                with self.assertRaises(p.PublicationError):
                    runner.recovery_history(self.repo, self.second, 2, 1)
                credentials.assert_not_called()

    def test_recovery_rejects_superseded_checkpoint_but_allows_post_approval_success(self):
        old, new = '# One\n\nOld', '# One\n\nNew'
        row = entry(body=old)
        value = manifest([row]); value['bootstrap_sha'] = self.first
        active = {'enabled': True, 'prerequisites': {'CBD-113': 'Done', 'CBD-114': 'Done'},
                  'owner_approval': 'Synthetic owner-approved fixture only.',
                  'exclusive_writer_approval': 'Synthetic fixture has no concurrent writers.', 'smoke_target': 'one'}
        c1 = self.revision({'docs/one.md': old, p.MANIFEST: json.dumps(value),
                            'config/confluence-activation.json': json.dumps(active)})
        row['approved_sha256'] = p.sha256(new)
        c2 = self.revision({'docs/one.md': new, p.MANIFEST: json.dumps(value)})
        c3 = self.commit('synthetic failed publication head')
        approval = {'run_id': 3, 'attempt': 1, 'head_sha': c3, 'checkpoint_sha': c1,
                    'authority': 'Synthetic owner verified restored pages at the selected checkpoint.'}
        recovery = {'schema': 1, 'reconciled_attempts': [approval]}
        c4 = self.revision({'config/confluence-recovery.json': json.dumps(recovery)})
        failed, success = workflow_run(3, c3), workflow_run(2, c2, conclusion='success')
        current = workflow_run(4, c4, status='in_progress', conclusion=None)
        for runs, jobs in [([current, failed, success], [workflow_jobs(failed), workflow_jobs(success, 'success')]),
                           ([success, current, failed], [workflow_jobs(success, 'success'), workflow_jobs(failed)])]:
            history = mock_history(runs, jobs)
            with self.subTest(order=[run['id'] for run in runs]), \
                    patch.object(runner, 'WorkflowHistory', return_value=history), \
                    patch.object(runner, 'Confluence') as credentials:
                with self.assertRaisesRegex(p.PublicationError, 'must-include-prior-successes'):
                    runner.prepare(self.repo, c3, c4, lambda: runner.recovery_history(self.repo, c4, 4, 1))
                credentials.assert_not_called()
        # A checkpoint including pre-approval successes is accepted.
        approval['checkpoint_sha'] = c3
        c5 = self.revision({'config/confluence-recovery.json': json.dumps(recovery)})
        current = workflow_run(5, c5, status='in_progress', conclusion=None)
        history = mock_history([current, failed, success], [workflow_jobs(failed), workflow_jobs(success, 'success')])
        with patch.object(runner, 'WorkflowHistory', return_value=history), patch.object(runner, 'registry', return_value=[row]):
            prepared = runner.prepare(self.repo, c4, c5, lambda: runner.recovery_history(self.repo, c5, 5, 1))
            self.assertEqual(prepared['base'], c3)
        # Subsequent success containing the exact approval can advance normally;
        # persistent recovery records must not permanently freeze publication.
        c6 = self.commit('subsequent verified publication')
        c7 = self.commit('next main push')
        later_success = workflow_run(6, c6, conclusion='success')
        current = workflow_run(7, c7, status='in_progress', conclusion=None)
        history = mock_history([current, later_success, failed, success],
                               [workflow_jobs(later_success, 'success'), workflow_jobs(failed), workflow_jobs(success, 'success')])
        with patch.object(runner, 'WorkflowHistory', return_value=history), patch.object(runner, 'registry', return_value=[row]):
            prepared = runner.prepare(self.repo, c6, c7, lambda: runner.recovery_history(self.repo, c7, 7, 1))
        self.assertEqual(prepared['base'], c6)

    def test_bootstrap_new_registration_is_not_an_assumed_historical_target(self):
        source = '# One\n\nExisting repository-only source'
        before = self.revision({'docs/one.md': source, 'scripts/sync-confluence.py': 'TARGETS = ()\n'})
        row = entry(body=source)
        unpublished = {field: row[field] for field in ('path', 'disposition', 'rationale', 'authority', 'reopen_when')}
        unpublished['disposition'] = 'unpublished'
        snapshot = manifest([unpublished]); snapshot['bootstrap_sha'] = before
        desired = manifest([row]); desired['bootstrap_sha'] = before
        active = {'enabled': True, 'prerequisites': {'CBD-113': 'Done', 'CBD-114': 'Done'},
                  'owner_approval': 'Synthetic owner-approved new target fixture.',
                  'exclusive_writer_approval': 'Synthetic fixture has no concurrent writers.', 'smoke_target': 'one'}
        for body in (source, source.replace('Existing', 'Changed')):
            row['approved_sha256'] = p.sha256(body)
            head = self.revision({'docs/one.md': body, p.MANIFEST: json.dumps(desired),
                                 'config/confluence-bootstrap.json': json.dumps(snapshot),
                                 'config/confluence-activation.json': json.dumps(active)})
            with patch.object(runner, 'registry', return_value=[row]):
                prepared = runner.prepare(self.repo, before, head, lambda: [])
                planned = runner.build_plan(self.repo, prepared)
            self.assertEqual(len(planned), 1)
            self.assertEqual(planned[0][1], '')
            api = MemoryAPI('')
            p.execute_plan(api, planned, head, lambda record: None)
            self.assertEqual(len(api.puts), 1)
            self.assertEqual(api.body, p.converter()(body))
            occupied = MemoryAPI('<h1>Human</h1><p>Unrelated existing content</p>')
            with self.assertRaises(p.PublicationError):
                p.execute_plan(occupied, planned, head, lambda record: None)
            self.assertEqual(occupied.puts, [])
        # Copying Desired into the snapshot cannot forge a historical target.
        forged = manifest([entry(body=source)]); forged['bootstrap_sha'] = before
        (self.repo / 'config/confluence-bootstrap.json').write_text(json.dumps(forged), encoding='utf-8')
        with self.assertRaisesRegex(p.PublicationError, 'registry-manifest-drift'):
            p.bootstrap_manifest(self.repo, before)
        forged['bootstrap_sha'] = head
        (self.repo / 'config/confluence-bootstrap.json').write_text(json.dumps(forged), encoding='utf-8')
        with self.assertRaisesRegex(p.PublicationError, 'bootstrap-snapshot-commit-mismatch'):
            p.bootstrap_manifest(self.repo, before)

    def test_recovery_cannot_fall_behind_bootstrap_when_no_run_has_succeeded(self):
        value = manifest(); value['bootstrap_sha'] = self.second
        approval = {'run_id': 1, 'attempt': 1, 'head_sha': self.third, 'checkpoint_sha': self.first,
                    'authority': 'Synthetic owner verified a checkpoint older than bootstrap.'}
        recovery = {'schema': 1, 'reconciled_attempts': [approval]}
        head = self.revision({'docs/one.md': 'body', p.MANIFEST: json.dumps(value),
                             'config/confluence-recovery.json': json.dumps(recovery)})
        failed = workflow_run(1, self.third)
        current = workflow_run(2, head, status='in_progress', conclusion=None)
        history = mock_history([current, failed], [workflow_jobs(failed)])
        with patch.object(runner, 'WorkflowHistory', return_value=history), patch.object(runner, 'Confluence') as credentials:
            with self.assertRaisesRegex(p.PublicationError, 'must-include-bootstrap'):
                runner.recovery_history(self.repo, head, 2, 1)
        credentials.assert_not_called()

    def test_bootstrap_preserves_existing_target_identity_across_rename(self):
        source = '# One\n\nOld'
        row = entry(body=source)
        legacy = 'TARGETS = (Target(key="one", doc_set="fixture", page_id="100", expected_title="Fixture one", path="docs/one.md"),)\n'
        before = self.revision({'docs/one.md': source, 'scripts/sync-confluence.py': legacy})
        snapshot = manifest([row]); snapshot['bootstrap_sha'] = before
        renamed = dict(row, path='docs/renamed.md', approved_sha256=p.sha256(source.replace('Old', 'New')))
        desired = manifest([renamed]); desired['bootstrap_sha'] = before
        (self.repo / 'docs/one.md').unlink()
        head = self.revision({'docs/renamed.md': source.replace('Old', 'New'), p.MANIFEST: json.dumps(desired),
                             'config/confluence-bootstrap.json': json.dumps(snapshot)})
        plan = {'schema': 1, 'event_before': before, 'head': head, 'base': before, 'overtaken': False,
                'manifest_sha256': p.sha256(json.dumps(desired, sort_keys=True))}
        with patch.object(runner, 'registry', return_value=[renamed]):
            planned = runner.build_plan(self.repo, plan)
        self.assertEqual(planned[0][1], p.converter()(source))
        self.assertEqual(planned[0][0]['page_id'], '100')
        api = MemoryAPI(p.converter()(source))
        p.execute_plan(api, planned, head, lambda record: None)
        self.assertEqual(api.body, p.converter()(source.replace('Old', 'New')))

    def test_recovery_records_cannot_move_backwards_between_reconciliations(self):
        value = manifest(); value['bootstrap_sha'] = self.first
        rows = [{'run_id': i, 'attempt': 1, 'head_sha': self.first, 'checkpoint_sha': checkpoint,
                 'authority': 'Synthetic chronological owner reconciliation evidence.'}
                for i, checkpoint in [(1, self.third), (2, self.second)]]
        head = self.revision({'docs/one.md': 'body', p.MANIFEST: json.dumps(value),
                             'config/confluence-recovery.json': json.dumps({'schema': 1, 'reconciled_attempts': rows})})
        with patch.object(runner, 'WorkflowHistory') as credentials:
            with self.assertRaisesRegex(p.PublicationError, 'non-monotonic-recovery-checkpoints'):
                runner.recovery_history(self.repo, head, 3, 1)
            credentials.assert_not_called()

    def test_merged_commit_plan_selects_only_changed_source_and_dependency(self):
        before_bodies = {"docs/one.md": "# One\n\nBaseline", "docs/two.md": "# Two\n\nOld", "docs/unrelated.md": "# Unrelated\n\nStable"}
        rows = [entry("one", "100", 0, before_bodies["docs/one.md"]),
                entry("two", "200", 1, before_bodies["docs/two.md"], ["one"]),
                entry("unrelated", "300", 2, before_bodies["docs/unrelated.md"])]
        value = manifest(rows)
        value["bootstrap_sha"] = self.first
        active = {"enabled": True, "prerequisites": {"CBD-113": "Done", "CBD-114": "Done"},
                  "exclusive_writer_approval": "Synthetic fixture has no live drafts or human writers.",
                  "owner_approval": "Synthetic owner approval for isolated fixture only.", "smoke_target": "two"}
        before = self.revision(dict(before_bodies, **{p.MANIFEST: json.dumps(value), "config/confluence-activation.json": json.dumps(active)}))
        rows[1]["approved_sha256"] = p.sha256("# Two\n\nNew")
        head = self.revision({"docs/two.md": "# Two\n\nNew", p.MANIFEST: json.dumps(value)})
        history = Mock(return_value=[before])
        with patch.object(runner, "registry", return_value=rows):
            prepared = runner.prepare(self.repo, before, head, history)
            planned = runner.build_plan(self.repo, prepared)
        self.assertEqual([row[0]["target"] for row in planned], ["one", "two"])
        self.assertEqual(planned[0][1], planned[0][2])
        api = Mock()
        api.get.side_effect = [page(planned[0][2], 7, rows[0]), page(planned[1][1], 9, rows[1]),
                               page(planned[1][1], 9, rows[1]), page(planned[1][2], 10, rows[1])]
        evidence = []
        p.execute_plan(api, planned, head, evidence.append)
        self.assertEqual([call.args[0] for call in api.get.call_args_list], ["100", "200", "200", "200"])
        self.assertEqual(api.put.call_count, 1)
        self.assertEqual(api.put.call_args.args[0]["target"], "two")
        # A replaced intermediate event cannot lose a preceding document change:
        # the checkpoint, not the push event's before SHA, defines the source delta.
        rows[2]["approved_sha256"] = p.sha256("# Unrelated\n\nNow changed")
        later = self.revision({"docs/unrelated.md": "# Unrelated\n\nNow changed", p.MANIFEST: json.dumps(value)})
        with patch.object(runner, "registry", return_value=rows):
            recovered = runner.prepare(self.repo, head, later, history)
            self.assertEqual(recovered["base"], before)
            self.assertEqual([row[0]["target"] for row in runner.build_plan(self.repo, recovered)], ["one", "two", "unrelated"])

    def test_unapproved_smoke_target_grafted_and_divergent_history(self):
        (self.repo / "config").mkdir()
        (self.repo / p.MANIFEST).write_text(json.dumps(manifest()), encoding="utf-8")
        active = {"enabled": True, "prerequisites": {"CBD-113": "Done", "CBD-114": "Done"},
                  "exclusive_writer_approval": "Synthetic fixture has no live drafts or human writers.",
                  "owner_approval": "Owner approval synthetic fixture only.", "smoke_target": "missing"}
        (self.repo / "config/confluence-activation.json").write_text(json.dumps(active), encoding="utf-8")
        with self.assertRaisesRegex(p.PublicationError, "smoke-target"):
            runner.activation(self.repo)
        active["exclusive_writer_approval"] = None
        (self.repo / "config/confluence-activation.json").write_text(json.dumps(active), encoding="utf-8")
        with self.assertRaisesRegex(p.PublicationError, "exclusive-writer-control"):
            runner.activation(self.repo)
        self.git("checkout", "-b", "divergent", self.first)
        divergent = self.commit("divergent")
        with self.assertRaisesRegex(p.PublicationError, "divergent-workflow"):
            runner.checkpoint(self.repo, self.first, self.third, [divergent])
        graft = self.repo / ".git/info/grafts"
        graft.write_text(self.third + "\n", encoding="ascii")
        with self.assertRaisesRegex(p.PublicationError, "grafted-history"):
            p.validate_range(self.repo, self.first, self.third)

    def test_range_valid_zero_missing_reverse_and_shallow(self):
        p.validate_range(self.repo, self.first, self.third)
        for before, head in (("0" * 40, self.third), (HEAD, self.third), (self.third, self.first)):
            with self.subTest(before=before), self.assertRaises(p.PublicationError):
                p.validate_range(self.repo, before, head)
        shallow = self.repo / "shallow"
        self.git("clone", "--depth=1", self.repo.as_uri(), str(shallow))
        with self.assertRaisesRegex(p.PublicationError, "shallow-history"):
            p.validate_range(shallow, self.third, self.third)

    def test_skipped_run_recovery_and_overtaken_run_never_rolls_back(self):
        self.assertEqual(runner.checkpoint(self.repo, self.first, self.third, [self.second]), (self.second, False))
        self.assertEqual(runner.checkpoint(self.repo, self.first, self.third, []), (self.first, False))
        self.assertEqual(runner.checkpoint(self.repo, self.first, self.second, [self.third]), (self.third, True))
        self.assertEqual(runner.checkpoint(self.repo, self.first, self.third, [self.first, self.second]), (self.second, False))

    def test_invalid_range_and_disabled_activation_before_auth(self):
        history = Mock()
        with self.assertRaises(p.PublicationError):
            runner.prepare(self.repo, "0" * 40, self.third, history)
        history.assert_not_called()
        (self.repo / "config").mkdir()
        (self.repo / "config/confluence-activation.json").write_text(json.dumps({"enabled": False, "prerequisites": {}, "owner_approval": None, "smoke_target": None}))
        with self.assertRaisesRegex(p.PublicationError, "activation-requires"):
            runner.prepare(self.repo, self.first, self.third, history)
        history.assert_not_called()

    def test_workflow_guards_all_execution_boundary_changes(self):
        workflow = (p.ROOT / ".github/workflows/publish-confluence.yml").read_text(encoding="utf-8")
        validate_workflow(workflow)
        command = "python3 -m pip install --require-hashes --only-binary=:all: -r config/publication-requirements.txt"
        self.assertIn("'" + command + "'", workflow)
        with self.assertRaises(p.PublicationError):
            validate_workflow(workflow.replace("'" + command + "'", command))
        for old, new in (("push:", "pull_request_target:"), ("branches: [main]", "branches: ['*']"),
                         ("contents: read", "contents: write"), ("actions: read", "actions: write"),
                         ("cancel-in-progress: false", "cancel-in-progress: true"), ("queue: max", "queue: single"),
                         ("fetch-depth: 0", "fetch-depth: 1"), ("persist-credentials: false", "persist-credentials: true"),
                         ("      - name: Publish", "      - if: false\n        name: Publish"),
                         ("  push:", "  workflow_dispatch:\n  push:"), ("  push:", "  push:\n    paths: ['docs/**']"),
                         ("--run-id", "--wrong-run-id"), ("--run-attempt", "--wrong-run-attempt"),
                         ("env:", "environment:"), ("prepare '", "publish '")):
            with self.subTest(old=old), self.assertRaises(p.PublicationError):
                validate_workflow(workflow.replace(old, new))

    def test_main_sanitizes_unexpected_errors(self):
        output = io.StringIO()
        with patch("sys.argv", ["publish_confluence.py", "prepare", self.first, self.third]), patch.object(runner, "ROOT", self.repo), patch.object(runner, "prepare", side_effect=RuntimeError("private response body")), redirect_stdout(output):
            self.assertEqual(runner.main(), 1)
        self.assertNotIn("private response body", output.getvalue())


if __name__ == "__main__":
    unittest.main()
