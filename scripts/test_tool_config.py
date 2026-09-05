"""Synthetic configuration and publisher tests; no credentials or network."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import unittest
from unittest import mock
from urllib.parse import urlsplit

import tool_config as config


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).parent / filename)
    loaded = importlib.util.module_from_spec(spec)
    sys.modules[name] = loaded
    spec.loader.exec_module(loaded)
    return loaded


publisher = module("cbd113_publisher", "sync-confluence.py")
jira = module("cbd113_jira", "audit-jira-links.py")
scanner = module("cbd113_scanner", "check-environment-python.py")
VALID = {"CONFLUENCE_BASE_URL": "https://example.atlassian.net",
         "CONFLUENCE_EMAIL": "operator@example.invalid",
         "CONFLUENCE_API_TOKEN": "synthetic-placeholder"}
SENTINEL = "CBD113_VALUE_MUST_NOT_APPEAR"


class ToolConfigTests(unittest.TestCase):
    def test_reviewed_dependency_loader_cannot_import_environment_modules(self):
        for name in ("os", "tool_config", "importlib"):
            with mock.patch.object(publisher.importlib, "import_module") as importer:
                with self.assertRaisesRegex(SystemExit, "Unsupported publisher dependency"):
                    publisher.require(name)
                importer.assert_not_called()

    def test_valid_and_environment_precedence(self):
        value = config.load_tool_config("confluence", VALID, {"CONFLUENCE_EMAIL": "override@example.invalid"})
        self.assertEqual(value["CONFLUENCE_EMAIL"], "override@example.invalid")
        with self.assertRaisesRegex(config.ConfigurationError, "CONFLUENCE_API_TOKEN"):
            config.load_tool_config("confluence", VALID, {"CONFLUENCE_API_TOKEN": ""})

    def test_jira_default_and_validation(self):
        values = {"JIRA_EMAIL": "operator@example.invalid", "JIRA_API_TOKEN": "synthetic-placeholder"}
        self.assertEqual(config.load_tool_config("jira", {}, values)["JIRA_BASE_URL"], "https://cobudget.atlassian.net")
        for name in values:
            with self.subTest(name=name), self.assertRaisesRegex(config.ConfigurationError, name):
                config.load_tool_config("jira", {}, {k: v for k, v in values.items() if k != name})
        with self.assertRaisesRegex(config.ConfigurationError, "JIRA_BASE_URL"):
            config.load_tool_config("jira", {}, {**values, "JIRA_BASE_URL": "http://example.invalid"})

    def test_each_missing_value_stops_before_any_publisher_effect(self):
        for name in VALID:
            for dry in (False, True):
                values = {k: v for k, v in VALID.items() if k != name}
                with self.subTest(name=name, dry=dry), mock.patch("tool_config.os.environ", values), \
                     mock.patch.object(publisher, "load_env_file", return_value={}), \
                     mock.patch.object(publisher, "require") as dependency, \
                     mock.patch.object(publisher, "fetch_page") as request, \
                     mock.patch.object(publisher, "PREVIEW_DIR") as preview, \
                     mock.patch.object(sys, "argv", ["sync-confluence.py"] + (["--dry-run"] if dry else [])):
                    with self.assertRaises(SystemExit) as result:
                        publisher.main()
                    self.assertIn(name if dry else "Manual publication is disabled", str(result.exception))
                    dependency.assert_not_called()
                    request.assert_not_called()
                    preview.mkdir.assert_not_called()

    def test_malformed_values_never_leak(self):
        cases = [("CONFLUENCE_BASE_URL", value) for value in (
            SENTINEL, "http://example.invalid", "https://user:password@example.invalid",
            "https://example.invalid/path", "https://example.invalid?token=" + SENTINEL,
            "https://example.invalid#" + SENTINEL, "https://example.invalid:443",
            "https://[invalid", " https://example.invalid", "https://example.invalid\n")]
        cases += [("CONFLUENCE_BASE_URL", value) for value in (
            "https://.", "https://..", "https://-bad.example.invalid", "https://bad-.example.invalid",
            "https://example..invalid", "https://" + "a" * 64 + ".invalid",
            "https://" + ".".join(["a" * 63] * 4), "https://example.invalid?", "https://example.invalid#",
            "https://example.invalid/?", "https://example.invalid/#")]
        cases += [("CONFLUENCE_EMAIL", SENTINEL), ("CONFLUENCE_API_TOKEN", SENTINEL + "\n")]
        for name, value in cases:
            with self.subTest(name=name), mock.patch("tool_config.os.environ", {**VALID, name: value}), \
                 mock.patch.object(publisher, "load_env_file", return_value={}), \
                 mock.patch.object(publisher, "require") as dependency:
                output, errors = io.StringIO(), io.StringIO()
                with contextlib.redirect_stdout(output), contextlib.redirect_stderr(errors):
                    with self.assertRaises(SystemExit) as result:
                        publisher.session_from_env()
                self.assertIn(name, str(result.exception))
                self.assertNotIn(SENTINEL, output.getvalue() + errors.getvalue() + str(result.exception))
                dependency.assert_not_called()

    def test_canonical_origin_constructs_the_exact_api_path(self):
        for value in ("https://example.invalid", "HTTPS://EXAMPLE.INVALID/", "https://a-b.example.invalid/"):
            with self.subTest(value=value):
                base = config.validate("CONFLUENCE_BASE_URL", value, {"kind": "https-origin"}, True)
                session = mock.Mock()
                publisher.fetch_page(session, base, "123")
                target = session.get.call_args.args[0]
                parsed = urlsplit(target)
                self.assertEqual(parsed.scheme, "https")
                self.assertEqual(parsed.netloc, urlsplit(value).hostname.lower())
                self.assertEqual(parsed.path, "/wiki/api/v2/pages/123")
                self.assertEqual((parsed.query, parsed.fragment), ("", ""))

    def test_defaults_and_rule_shapes_are_validated_before_use(self):
        invalid = [None, {}, {"kind": "unknown"}, {"kind": "https-origin", "extra": True},
                   {"kind": "https-origin", "default": "http://bad.invalid/path"},
                   {"kind": "https-origin", "default": "https://example.invalid#"},
                   {"kind": "https-origin", "default": ""}, {"kind": "https-origin", "default": 42},
                   {"kind": "token", "default": "synthetic-placeholder"}]
        for spec in invalid:
            for raw in (None, "", "https://example.invalid"):
                with self.subTest(spec=spec, raw=raw), self.assertRaisesRegex(config.ConfigurationError, "EXAMPLE_URL"):
                    config.validate("EXAMPLE_URL", raw, spec, False)
        rule = {"kind": "https-origin", "default": "HTTPS://EXAMPLE.INVALID/"}
        for raw in (None, ""):
            self.assertEqual(config.validate("EXAMPLE_URL", raw, rule, False), "https://example.invalid")
        self.assertIsNone(config.validate("EXAMPLE_URL", None, {"kind": "https-origin"}, False))
        with self.assertRaises(config.ConfigurationError):
            config.validate("EXAMPLE_URL", None, rule, True)
        row = {"name": "EXAMPLE_URL", "group": "fixture", "required": False,
               "validation": {"kind": "https-origin", "default": "http://bad.invalid/path"}}
        with mock.patch.object(config, "INVENTORY") as inventory:
            inventory.read_text.return_value = json.dumps({"variables": [row]})
            with self.assertRaisesRegex(config.ConfigurationError, "EXAMPLE_URL"):
                config.load_tool_config("fixture", {}, {})

    def test_valid_publisher_constructs_mock_session_only(self):
        with mock.patch("tool_config.os.environ", VALID), mock.patch.object(publisher, "load_env_file", return_value={}), \
             mock.patch.object(publisher, "require") as dependency:
            session, base = publisher.session_from_env()
            self.assertEqual(base, VALID["CONFLUENCE_BASE_URL"])
            self.assertEqual(session.auth, (VALID["CONFLUENCE_EMAIL"], VALID["CONFLUENCE_API_TOKEN"]))
            session.get.assert_not_called()
            session.put.assert_not_called()

    def test_python_scanner_rejects_bypass_and_aliases(self):
        for source in (
            'import os\nos.environ.get("CBD_113_UNDECLARED")',
            'import os as system\nsystem.getenv("CBD_113_UNDECLARED")',
            'from os import environ as e\ne["CBD_113_UNDECLARED"]',
            'import os\ne = os.environ\ne[key]',
            'import os\nalias = os\nalias.getenv(key)',
            'import os\ngetattr(os, "environ")',
            'from tool_config import load_tool_config\nread = load_tool_config',
            'import tool_config\nread = tool_config.load_tool_config',
            'import os\nos.__dict__["environ"].get("CBD_113_UNDECLARED")',
            'import importlib\nimportlib.import_module("os").getenv("CBD_113_UNDECLARED")',
            'import importlib as lib\nlib.import_module("os").getenv("CBD_113_UNDECLARED")',
            'from importlib import import_module as load\nload("os").getenv("CBD_113_UNDECLARED")',
            '__import__("os").getenv("CBD_113_UNDECLARED")',
        ):
            with self.subTest(source=source):
                errors, _ = scanner.scan(source, "scripts/fixture.py", [])
                self.assertTrue(errors)
        errors, _ = scanner.scan('import os\nos.environ.get("CBD_113_UNDECLARED")', "scripts/fixture.py", [])
        self.assertIn("CBD_113_UNDECLARED", " ".join(errors))
        self.assertEqual(scanner.scan('# os.environ["COMMENT"]\ns = \'os.getenv("STRING")\'', "scripts/fixture.py", []), ([], []))


if __name__ == "__main__":
    unittest.main()
