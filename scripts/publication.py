"""Conflict-safe publication primitives. Errors and evidence never contain bodies."""

from __future__ import annotations

import ast
import hashlib
import importlib.util
import json
import re
import sys
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from html.entities import html5
from html.parser import HTMLParser
from pathlib import Path

from secret_scanner import ScanError, git

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = "config/confluence-publication.json"
MAX_BODY = 1024 * 1024
SHA = re.compile(r"[a-f0-9]{40}")
DOC = re.compile(r"docs/[a-z0-9][a-z0-9-]*\.md")


class PublicationError(Exception):
    def __init__(self, code, section=None):
        super().__init__(code)
        self.code = code
        self.section = section


def sha256(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def json_object(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise PublicationError("duplicate-json-key")
            result[key] = value
        return result
    try:
        return json.loads(raw, object_pairs_hook=unique)
    except (ValueError, TypeError):
        raise PublicationError("malformed-json") from None


def bounded(value):
    if not isinstance(value, str) or len(value.encode("utf-8")) > MAX_BODY:
        raise PublicationError("manual-handling-size-limit")
    return value


def source(repo, revision, path):
    if not SHA.fullmatch(revision) or not DOC.fullmatch(path):
        raise PublicationError("invalid-source-identity")
    return git(repo, "show", revision + ":" + path).decode("utf-8")


def inventory(repo, revision):
    paths = git(repo, "ls-tree", "-r", "--name-only", "-z", revision, "--", "docs").decode("utf-8").split("\0")
    return {path for path in paths if path.startswith("docs/") and path.count("/") == 1 and path.endswith(".md")}


def ancestor(repo, earlier, later):
    # rev-list avoids interpreting the ordinary non-ancestor result as a Git error.
    return not git(repo, "rev-list", "--max-count=1", earlier, "^" + later).strip()


def validate_range(repo, before, head):
    if any(not isinstance(value, str) or not SHA.fullmatch(value) or value == "0" * 40 for value in (before, head)):
        raise PublicationError("invalid-range-fetch-complete-ancestor-history")
    if git(repo, "rev-parse", "--is-shallow-repository").strip() != b"false":
        raise PublicationError("shallow-history-fetch-full-history")
    graft = Path(git(repo, "rev-parse", "--git-path", "info/grafts").decode().strip())
    if not graft.is_absolute():
        graft = repo / graft
    if graft.exists() and graft.stat().st_size:
        raise PublicationError("grafted-history-requires-clean-checkout")
    for revision in (before, head):
        try:
            resolved = git(repo, "rev-parse", "--verify", revision + "^{commit}").decode().strip()
        except ScanError:
            raise PublicationError("missing-commit-fetch-complete-history") from None
        if resolved != revision:
            raise PublicationError("missing-commit-fetch-complete-history")
    if not ancestor(repo, before, head):
        raise PublicationError("non-ancestor-recover-from-reviewed-checkpoint")


def registry(text=None):
    tree = ast.parse(text if text is not None else (ROOT / "scripts/sync-confluence.py").read_text(encoding="utf-8"))
    return [dict(("target" if kw.arg == "key" else kw.arg, ast.literal_eval(kw.value)) for kw in node.keywords)
            for node in ast.walk(tree)
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "Target"]


def validate_manifest(data, documents, bodies, targets=None):
    if (not isinstance(data, dict) or set(data) != {"schema", "bootstrap_sha", "documents", "retained_pages"}
            or type(data["schema"]) is not int or data["schema"] != 1):
        raise PublicationError("invalid-manifest")
    if not isinstance(data["bootstrap_sha"], str) or not SHA.fullmatch(data["bootstrap_sha"]):
        raise PublicationError("invalid-bootstrap")
    entries, retained = data["documents"], data["retained_pages"]
    if not isinstance(entries, list) or not isinstance(retained, list):
        raise PublicationError("invalid-manifest")
    paths, keys, pages, orders = set(), set(), set(), set()
    required = {"path", "disposition", "rationale", "authority", "reopen_when"}
    registered = {"target", "page_id", "expected_title", "doc_set", "order", "depends_on", "policy", "approved_sha256"}
    by_key = {}
    for entry in entries:
        if not isinstance(entry, dict) or entry.get("disposition") not in ("registered", "unpublished"):
            raise PublicationError("invalid-document-disposition")
        expected = required | (registered if entry["disposition"] == "registered" else set())
        if set(entry) != expected:
            raise PublicationError("mixed-or-incomplete-disposition")
        if not isinstance(entry["path"], str) or not DOC.fullmatch(entry["path"]) or entry["path"] in paths:
            raise PublicationError("duplicate-or-invalid-document-path")
        paths.add(entry["path"])
        for field in ("rationale", "authority", "reopen_when"):
            value = entry[field]
            if not isinstance(value, str) or len(value.strip()) < 20 or value.strip().lower() in ("not published", "intentionally unpublished"):
                raise PublicationError("incomplete-disposition-authority")
        if entry["disposition"] == "unpublished":
            continue
        for field in ("target", "page_id", "expected_title", "doc_set"):
            if (not isinstance(entry[field], str) or not entry[field].strip() or entry[field] != entry[field].strip()
                    or any(ord(char) < 32 or ord(char) == 127 for char in entry[field])):
                raise PublicationError("missing-target-metadata")
        if not re.fullmatch(r"[a-z0-9-]+", entry["target"]) or not re.fullmatch(r"[0-9]+", entry["page_id"]):
            raise PublicationError("invalid-target-identity")
        if entry["target"] in keys or entry["page_id"] in pages:
            raise PublicationError("duplicate-target-identity")
        if type(entry["order"]) is not int or entry["order"] < 0 or entry["order"] in orders:
            raise PublicationError("invalid-dependency-order")
        if not isinstance(entry["depends_on"], list) or any(not isinstance(key, str) for key in entry["depends_on"]):
            raise PublicationError("invalid-dependencies")
        if len(set(entry["depends_on"])) != len(entry["depends_on"]):
            raise PublicationError("duplicate-dependency")
        if entry["policy"] not in ("approved", "held"):
            raise PublicationError("invalid-publication-policy")
        if entry["policy"] == "approved":
            if entry["path"] not in bodies or entry["approved_sha256"] != sha256(bodies[entry["path"]]):
                raise PublicationError("unapproved-source-content")
        elif entry["approved_sha256"] is not None:
            raise PublicationError("held-document-carries-approval")
        keys.add(entry["target"])
        pages.add(entry["page_id"])
        orders.add(entry["order"])
        by_key[entry["target"]] = entry
    if paths != documents:
        raise PublicationError("manifest-document-coverage")
    for entry in by_key.values():
        for key in entry["depends_on"]:
            if key not in by_key or by_key[key]["order"] >= entry["order"]:
                raise PublicationError("dependency-cycle-or-missing-baseline")
    retained_paths = set()
    for entry in retained:
        if (not isinstance(entry, dict) or set(entry) != {"former_path", "page_id", "expected_title", "rationale", "authority"}
                or not isinstance(entry["former_path"], str) or not DOC.fullmatch(entry["former_path"])
                or not isinstance(entry["page_id"], str) or not re.fullmatch(r"[0-9]+", entry["page_id"])
                or entry["former_path"] in retained_paths or entry["page_id"] in pages
                or any(not isinstance(entry[field], str) or len(entry[field].strip()) < 3 for field in ("expected_title", "rationale", "authority"))):
            raise PublicationError("invalid-retained-page-disposition")
        retained_paths.add(entry["former_path"])
        pages.add(entry["page_id"])
    if targets is not None:
        actual = {entry["target"]: entry for entry in by_key.values()}
        if set(actual) != {target["target"] for target in targets}:
            raise PublicationError("registry-manifest-drift")
        for target in targets:
            if any(actual[target["target"]][field] != target[field] for field in ("path", "page_id", "expected_title", "doc_set")):
                raise PublicationError("registry-manifest-drift")
    return {entry["path"]: entry for entry in entries}


def read_manifest(repo, revision):
    return json_object(git(repo, "show", revision + ":" + MANIFEST).decode("utf-8"))


def bootstrap_manifest(repo, revision, paths=None, bodies=None):
    validate_range(repo, revision, revision)
    data = json_object((repo / "config/confluence-bootstrap.json").read_text(encoding="utf-8"))
    if not isinstance(data, dict) or data.get("bootstrap_sha") != revision:
        raise PublicationError("bootstrap-snapshot-commit-mismatch")
    paths = inventory(repo, revision) if paths is None else paths
    bodies = {path: source(repo, revision, path) for path in paths} if bodies is None else bodies
    targets = registry(git(repo, "show", revision + ":scripts/sync-confluence.py").decode("utf-8"))
    validate_manifest(data, paths, bodies, targets)
    return data


def select_documents(base_manifest, desired_manifest, base_bodies, desired_bodies):
    old = {entry["path"]: entry for entry in base_manifest["documents"]}
    new = {entry["path"]: entry for entry in desired_manifest["documents"]}
    old_pages = {entry["page_id"]: path for path, entry in old.items() if entry["disposition"] == "registered"}
    retained = {entry["page_id"]: entry for entry in desired_manifest["retained_pages"]}
    new_pages = {entry["page_id"] for entry in new.values() if entry["disposition"] == "registered"}
    for page, path in old_pages.items():
        if page not in new_pages and (page not in retained or retained[page]["former_path"] != path):
            raise PublicationError("deleted-target-needs-retained-page-disposition")
    selected = {}
    for path, entry in new.items():
        if entry["disposition"] != "registered":
            continue
        prior = old_pages.get(entry["page_id"])
        before = base_bodies.get(prior, "")
        desired = desired_bodies[path]
        old_entry = old.get(prior, {})
        identity_unchanged = all(old_entry.get(field) == entry[field]
                                 for field in ("target", "expected_title", "doc_set", "depends_on", "policy"))
        if before == desired and identity_unchanged:
            continue
        if entry["policy"] != "approved":
            raise PublicationError("changed-document-awaits-approval")
        selected[entry["target"]] = (entry, before, desired)
    by_key = {entry["target"]: entry for entry in new.values() if entry["disposition"] == "registered"}
    def baseline(key):
        if key in selected:
            entry, before, desired = selected[key]
            selected[key] = (dict(entry, required_baseline=True), before, desired)
            return
        entry = by_key[key]
        if entry["policy"] != "approved":
            raise PublicationError("baseline-awaits-approval")
        body = desired_bodies[entry["path"]]
        selected[key] = (dict(entry, baseline_only=True, required_baseline=True), body, body)
        for parent in entry["depends_on"]:
            baseline(parent)
    for entry, _, _ in list(selected.values()):
        for key in entry["depends_on"]:
            baseline(key)
    return sorted(selected.values(), key=lambda item: item[0]["order"])


def converter():
    name = "cbd115_legacy_converter"
    if name not in sys.modules:
        spec = importlib.util.spec_from_file_location(name, ROOT / "scripts/sync-confluence.py")
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
    return sys.modules[name].to_storage


VOID = {"br", "hr", "img", "col"}
TAGS = {"h1", "h2", "h3", "h4", "h5", "h6", "p", "div", "span", "strong", "em", "b", "i", "s", "u",
        "a", "ul", "ol", "li", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "colgroup",
        "blockquote", "pre", "code", "sup", "sub", "dl", "dt", "dd"} | VOID
BLOCKS = {"h1", "h2", "h3", "h4", "h5", "h6", "p", "div", "ul", "ol", "table", "blockquote", "pre", "dl", "hr"}


class StorageParser(HTMLParser):
    """Strict supported XHTML subset, preserving original section byte ranges."""
    def __init__(self, body):
        super().__init__(convert_charrefs=True)
        self.body = bounded(body)
        # HTMLParser is intentionally forgiving. First require well-formed XML
        # so truncated tags, bare ampersands and invalid entities cannot be
        # interpreted as an apparently safe semantic no-op.
        if "<!" in body or "<?" in body:
            raise PublicationError("unsupported-storage-manual-reconciliation")
        # Confluence storage can contain XHTML's named character references.
        # Expand only the finite HTML character table, only with semicolons,
        # and only in the XML validation copy. Numeric references cannot inject
        # markup; unknown entities still fail XML validation. Feed the original
        # body below so reconciliation retains exact source byte ranges.
        xml_body = re.sub(r"&([A-Za-z][A-Za-z0-9]*);",
                          lambda match: "".join(f"&#{ord(char)};" for char in html5[match[1] + ";"])
                          if match[1] + ";" in html5 else match[0], body)
        try:
            ET.fromstring('<root xmlns:ac="urn:confluence-ac">' + xml_body + '</root>')
        except ET.ParseError:
            raise PublicationError("malformed-storage-manual-reconciliation") from None
        self.offsets = [0]
        self.offsets.extend(match.end() for match in re.finditer("\n", body))
        self.stack, self.tokens, self.headings = [], [], []
        self.styled = False
        self.heading_text = None
        try:
            self.feed(body)
            self.close()
        except (ValueError, AssertionError):
            raise PublicationError("unsupported-storage-manual-reconciliation") from None
        if self.stack or self.heading_text is not None:
            raise PublicationError("unbalanced-storage")
        tokens = self.tokens
        self.tokens = []
        for index, token in enumerate(tokens):
            if token[0] == "gap":
                previous = tokens[index - 1] if index else None
                following = tokens[index + 1] if index + 1 < len(tokens) else None
                before_block = previous is None or (previous[1] in BLOCKS and
                                (previous[0] == "end" or previous[:2] == ("start", "hr")))
                after_block = following is None or (following[0] == "start" and following[1] in BLOCKS)
                if before_block and after_block and not self.styled:
                    continue
                token = ("text", token[1])
            self.tokens.append(token)

    def source_offset(self):
        line, column = self.getpos()
        return self.offsets[line - 1] + column

    def handle_starttag(self, tag, attrs):
        if tag not in TAGS or len(dict(attrs)) != len(attrs):
            raise PublicationError("unsupported-storage-manual-reconciliation")
        if any(key in {"style", "class"} for key, _ in attrs):
            self.styled = True
        if re.fullmatch("h[1-6]", tag):
            if self.stack:
                raise PublicationError("nested-heading-manual-reconciliation")
            self.heading_text = []
            self.headings.append([self.source_offset(), int(tag[1]), None])
        # Ephemeral Confluence local IDs do not change meaning. All other
        # attributes, including links and table structure, remain significant.
        canonical_attrs = tuple(sorted((key, value) for key, value in attrs
                                       if key not in {"data-local-id", "local-id", "ac:local-id"}))
        self.tokens.append(("start", tag, canonical_attrs))
        if tag not in VOID:
            self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if not self.stack or self.stack.pop() != tag:
            raise PublicationError("unbalanced-storage")
        self.tokens.append(("end", tag))
        if re.fullmatch("h[1-6]", tag):
            label = "".join(self.heading_text).strip(" \t\r\n")
            if not label:
                raise PublicationError("empty-heading")
            self.headings[-1][2] = label
            self.heading_text = None

    def handle_data(self, data):
        if self.heading_text is not None:
            self.heading_text.append(data)
        # CSS (including inherited styles) can make any in-element whitespace
        # significant. Preserve it exactly, including NBSP and Unicode spaces.
        # Only ASCII formatting whitespace between top-level blocks is ignored.
        if self.stack or data.strip(" \t\r\n"):
            self.tokens.append(("text", data))
        else:
            self.tokens.append(("gap", data))

    def handle_comment(self, data):
        raise PublicationError("unsupported-storage-manual-reconciliation")

    def handle_decl(self, decl):
        raise PublicationError("unsupported-storage-manual-reconciliation")

    def unknown_decl(self, data):
        raise PublicationError("unsupported-storage-manual-reconciliation")

    def handle_pi(self, data):
        raise PublicationError("unsupported-storage-manual-reconciliation")


def equivalent(left, right):
    return StorageParser(left).tokens == StorageParser(right).tokens


@dataclass(frozen=True)
class Section:
    identity: tuple
    body: str


def sections(body):
    parser = StorageParser(body)
    identities, parents, result = set(), [], []
    boundaries = [(0, ())]
    for offset, level, label in parser.headings:
        while parents and parents[-1][0] >= level:
            parents.pop()
        parents.append((level, label))
        identity = tuple((rank, name) for rank, name in parents)
        if identity in identities:
            raise PublicationError("ambiguous-duplicate-heading", identity)
        identities.add(identity)
        boundaries.append((offset, identity))
    for index, (offset, identity) in enumerate(boundaries):
        end = boundaries[index + 1][0] if index + 1 < len(boundaries) else len(body)
        result.append(Section(identity, body[offset:end]))
    return result


def reconcile(base, live, desired):
    b, l, d = sections(base), sections(live), sections(desired)
    b_ids, l_ids, d_ids = [[section.identity for section in group] for group in (b, l, d)]
    # Identity changes (including new/deleted/reordered headings) are supported
    # only from an exact Base or an already-applied Desired, never guessed.
    if b_ids != d_ids:
        if equivalent(live, desired):
            return live
        if not equivalent(live, base):
            raise PublicationError("ambiguous-structural-change")
        old = {section.identity: section.body for section in b}
        current = {section.identity: section.body for section in l}
        return "".join(current[section.identity]
                       if section.identity in old and equivalent(old[section.identity], section.body)
                       else section.body for section in d)
    if l_ids != b_ids:
        raise PublicationError("ambiguous-live-heading-map")
    output = []
    for before, current, after in zip(b, l, d):
        if equivalent(before.body, after.body):
            output.append(current.body)
        elif equivalent(current.body, after.body):
            output.append(current.body)  # interrupted PUT, re-read proves applied
        elif equivalent(current.body, before.body):
            output.append(after.body)
        else:
            raise PublicationError("overlapping-live-edit", before.identity)
    return "".join(output)


def validate_page(page, entry):
    try:
        if (not isinstance(page, dict) or page["id"] != entry["page_id"]
                or page["title"] != entry["expected_title"] or page["status"] != "current"
                or type(page["version"]["number"]) is not int or page["version"]["number"] < 1):
            raise PublicationError("page-identity-or-version-mismatch")
        body = bounded(page["body"]["storage"]["value"])
        sections(body)
        return body, page["version"]["number"]
    except (KeyError, TypeError):
        raise PublicationError("malformed-page-response") from None


def publish_selected(api, selected, head, emit):
    """Fail-fast dependency order; no retries of a stale or uncertain payload."""
    convert = converter()
    # Convert and validate every selected source before any HTTP authentication
    # or writes by the caller. execute_plan is separately usable in API fixtures.
    plan = [(entry, bounded(convert(bounded(before))), bounded(convert(bounded(desired)))) for entry, before, desired in selected]
    for _, before, desired in plan:
        sections(before)
        sections(desired)
    execute_plan(api, plan, head, emit)


def execute_plan(api, plan, head, emit):
    for entry, base, desired in plan:
        evidence = {"merge_sha": head, "source_path": entry["path"], "target_key": entry["target"],
                    "page_id": entry["page_id"], "prior_version": None, "stored_version": None,
                    "action": "conflict", "verified": False}
        try:
            live, version = validate_page(api.get(entry["page_id"]), entry)
            evidence["prior_version"] = version
            # Unchanged baselines must equal their approved source, not merely
            # have zero changed sections relative to themselves.
            if entry.get("baseline_only", False) and not equivalent(live, desired):
                raise PublicationError("baseline-not-current")
            result = bounded(reconcile(base, live, desired))
            # A changed baseline is still a gate. Preserving a divergent human
            # section must not authorize publication of its dependent targets.
            if entry.get("required_baseline", False) and not equivalent(result, desired):
                raise PublicationError("baseline-not-current")
            if equivalent(live, result):
                evidence.update(action="no-op", stored_version=version, verified=True)
                emit(evidence)
                continue
            # Re-read before PUT; API expected-next-version is the final race guard.
            current, current_version = validate_page(api.get(entry["page_id"]), entry)
            if current_version != version or current != live:
                raise PublicationError("stale-version-conflict")
            api.put(entry, result, version + 1, head)
            after, stored = validate_page(api.get(entry["page_id"]), entry)
            evidence["stored_version"] = stored
            if stored != version + 1:
                raise PublicationError("stale-version-conflict")
            if not equivalent(after, result):
                raise PublicationError("readback-mismatch")
            # Preserved sections are checked byte-for-byte after server storage.
            old_sections = {section.identity: section.body for section in sections(base)}
            desired_sections = {section.identity: section.body for section in sections(desired)}
            live_sections = {section.identity: section.body for section in sections(live)}
            after_sections = {section.identity: section.body for section in sections(after)}
            for identity in old_sections.keys() & desired_sections.keys():
                if equivalent(old_sections[identity], desired_sections[identity]) and after_sections.get(identity) != live_sections.get(identity):
                    raise PublicationError("preserved-section-readback-mismatch", identity)
            evidence.update(action="update", stored_version=stored, verified=True)
            emit(evidence)
        except PublicationError as error:
            evidence["reason"] = error.code
            if error.section is not None:
                # Heading text can contain secrets; hash identity rather than echo it.
                evidence["heading_path_fingerprint"] = sha256(json.dumps(error.section))
                evidence["heading_path"] = [{"level": level, "label_sha256": sha256(label)}
                                            for level, label in error.section]
            emit(evidence)
            raise
