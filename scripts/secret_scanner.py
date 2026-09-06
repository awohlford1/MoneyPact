"""Pinned, local-only scanner boundary. Never expose child output or exceptions."""

import hashlib
import io
import json
import platform
import re
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
import zipfile
import bisect
import time
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MAX_BYTES = 256 * 1024 * 1024
PIN_SHA256 = "bbfb84371e1fa8a33632632758e133b8d498e6d50844a98186e33a37ba7f1132"
RULES_SHA256 = "dc6f27cd2be8a8d9960c92e2a81abb659be0409e5ea66918d321a3234f49c1be"
PATH_RULES = {
    "freemius-secret-key": r"(?i)\.php$",
    "hashicorp-tf-password": r"(?i)\.(?:tf|hcl)$",
    "kubernetes-secret-yaml": r"(?i)\.ya?ml$",
    "nuget-config-password": r"(?i)nuget\.config$",
}
PREAMBLE = b"CoBudget secret scan input\n\n"


class ScanError(Exception):
    """Messages are fixed, non-sensitive diagnostics only."""


def digest(data):
    return hashlib.sha256(data).hexdigest()


def run(command, cwd, data=None, timeout=60):
    try:
        result = subprocess.run(command, cwd=cwd, input=data, capture_output=True,
                                timeout=timeout, check=False)
    except (OSError, subprocess.SubprocessError):
        raise ScanError("subprocess unavailable or timed out") from None
    if len(result.stdout) > MAX_BYTES or len(result.stderr) > MAX_BYTES:
        raise ScanError("subprocess output exceeded the coverage limit")
    return result


def git(repo, *args, data=None):
    result = run(["git", "--no-replace-objects", "-c", "core.quotePath=false", *args], repo, data)
    if result.returncode:
        raise ScanError("Git coverage query failed; verify complete local history")
    return result.stdout


def scanner_binary(root=ROOT):
    """Re-extract only the executable from the verified archive; no PATH fallback."""
    try:
        pin_bytes = (root / "config/secret-scanner.json").read_bytes().replace(b"\r\n", b"\n")
        if digest(pin_bytes) != PIN_SHA256:
            raise ValueError()
        pin = json.loads(pin_bytes)
        asset = pin["assets"][f"{platform.system()}-{platform.machine()}"]
        if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", pin["version"]):
            raise ValueError()
        if not re.fullmatch(r"[a-f0-9]{64}", asset["sha256"]):
            raise ValueError()
        expected = f"gitleaks_{pin['version']}_"
        if not asset["name"].startswith(expected) or "/" in asset["name"] or "\\" in asset["name"]:
            raise ValueError()
        cache = root / ".cache/secret-scanner"
        cache.mkdir(parents=True, exist_ok=True)
        archive = cache / asset["name"]
        if not archive.exists():
            url = f"https://github.com/gitleaks/gitleaks/releases/download/v{pin['version']}/{asset['name']}"
            with urllib.request.urlopen(url, timeout=30) as response:
                payload = response.read(32 * 1024 * 1024 + 1)
            if len(payload) > 32 * 1024 * 1024 or digest(payload) != asset["sha256"]:
                raise ValueError()
            archive.write_bytes(payload)
        payload = archive.read_bytes()
        if digest(payload) != asset["sha256"]:
            raise ValueError()
        executable = "gitleaks.exe" if platform.system() == "Windows" else "gitleaks"
        if asset["name"].endswith(".zip"):
            with zipfile.ZipFile(io.BytesIO(payload)) as bundle:
                binary = bundle.read(executable)
        else:
            with tarfile.open(fileobj=io.BytesIO(payload), mode="r:gz") as bundle:
                member = bundle.getmember(executable)
                if not member.isfile():
                    raise ValueError()
                binary = bundle.extractfile(member).read()
        target = cache / executable
        if not target.exists() or target.read_bytes() != binary:
            target.write_bytes(binary)
        target.chmod(0o700)
        result = run([str(target), "version"], root)
        if result.returncode or result.stdout.decode().strip() != pin["version"]:
            raise ValueError()
        return target
    except (KeyError, ValueError, OSError, zipfile.BadZipFile, tarfile.TarError):
        raise ScanError("scanner installation or integrity verification failed") from None


def validate_allowlist(entries):
    required = {"rule", "path", "fingerprint", "rationale", "owner", "created", "expires"}
    if not isinstance(entries, list):
        raise ScanError("invalid allowlist")
    identities = set()
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != required:
            raise ScanError("invalid allowlist metadata")
        if any(not isinstance(value, str) or not value.strip() for value in entry.values()):
            raise ScanError("invalid allowlist metadata")
        path = entry["path"]
        if (path.startswith("/") or "\\" in path or any(c in path for c in "*?[]:\n\r")
                or any(part in ("", ".", "..") for part in path.split("/"))):
            raise ScanError("allowlist requires one exact repository path")
        if not re.fullmatch(r"[a-z0-9-]+", entry["rule"]) or not re.fullmatch(r"[a-f0-9]{64}", entry["fingerprint"]):
            raise ScanError("allowlist requires exact rule and fingerprint")
        try:
            created, expires = date.fromisoformat(entry["created"]), date.fromisoformat(entry["expires"])
            if not created <= date.today() < expires or (expires - created).days > 366:
                raise ValueError()
        except ValueError:
            raise ScanError("allowlist entry is expired or has invalid review dates") from None
        identity = (entry["rule"], path, entry["fingerprint"])
        if identity in identities:
            raise ScanError("duplicate allowlist identity")
        identities.add(identity)
    return identities


def scan_input(binary, content, root=ROOT, rule_ids=None):
    rules = (root / "config/gitleaks.toml").read_bytes().replace(b"\r\n", b"\n")
    if digest(rules) != RULES_SHA256:
        raise ScanError("unreviewed detection configuration")
    known = set(re.findall(r'^id = "([a-z0-9-]+)"$', rules.decode("utf-8"), re.MULTILINE))
    enabled = known - PATH_RULES.keys() if rule_ids is None else set(rule_ids)
    if not enabled or not enabled <= known:
        raise ScanError("invalid detection rule selection")
    # An empty private directory prevents .gitleaksignore / local config discovery.
    # Only explicit reviewed configuration is supplied. No repository data upload.
    with tempfile.TemporaryDirectory(prefix="cbd114-scanner-") as isolated:
        result = run([str(binary), "stdin", "--config", str(root / "config/gitleaks.toml"),
                      "--enable-rule", ",".join(sorted(enabled)),
                      "--gitleaks-ignore-path", isolated, "--ignore-gitleaks-allow",
                      "--no-banner", "--no-color", "--log-level=error",
                      "--report-format=json", "--report-path=-", "--timeout=55"], isolated, content)
    if result.returncode not in (0, 1):
        raise ScanError("scanner execution failed")
    try:
        findings = json.loads(result.stdout)
        if not isinstance(findings, list) or bool(findings) != (result.returncode == 1):
            raise ValueError()
        for finding in findings:
            if (not re.fullmatch(r"[a-z0-9-]+", finding["RuleID"])
                    or finding["RuleID"] not in enabled
                    or not isinstance(finding["Secret"], str) or not finding["Secret"]
                    or type(finding["StartLine"]) is not int or finding["StartLine"] < 1
                    or type(finding["EndLine"]) is not int or finding["EndLine"] < finding["StartLine"]):
                raise ValueError()
        return findings
    except (ValueError, TypeError, KeyError):
        raise ScanError("scanner returned an invalid report") from None


def read_objects(repo, names):
    if not names:
        return {}
    payload = git(repo, "cat-file", "--batch", data=("\n".join(names) + "\n").encode())
    objects = {}
    offset = 0
    for expected in names:
        end = payload.find(b"\n", offset)
        header = payload[offset:end].decode("ascii").split()
        if len(header) != 3 or header[0] != expected or not header[2].isdigit():
            raise ScanError("missing or malformed Git object")
        size = int(header[2])
        offset = end + 1
        body = payload[offset:offset + size]
        if len(body) != size or payload[offset + size:offset + size + 1] != b"\n":
            raise ScanError("incomplete Git object")
        objects[expected] = (header[1], body)
        offset += size + 1
    if offset != len(payload):
        raise ScanError("unexpected Git object output")
    return objects


def full_sha(repo, value):
    if not re.fullmatch(r"[a-f0-9]{40}", value):
        raise ScanError("coverage requires an exact commit SHA")
    if git(repo, "rev-parse", "--verify", value + "^{commit}").decode().strip() != value:
        raise ScanError("requested commit is unavailable")
    return value


def history_content(repo, head, base=None):
    if git(repo, "rev-parse", "--is-shallow-repository").strip() != b"false":
        raise ScanError("coverage error: shallow history is forbidden; fetch full history")
    graft_path = Path(git(repo, "rev-parse", "--git-path", "info/grafts").decode().strip())
    if not graft_path.is_absolute():
        graft_path = repo / graft_path
    if graft_path.exists() and graft_path.stat().st_size:
        raise ScanError("coverage error: grafted history is forbidden")
    full_sha(repo, head)
    revisions = [head]
    if base is not None:
        full_sha(repo, base)
        revisions.append("^" + base)
    names = git(repo, "rev-list", "--objects", "--no-object-names", *revisions).decode().splitlines()
    if any(not re.fullmatch(r"[a-f0-9]{40}", name) for name in names):
        raise ScanError("invalid object inventory")
    objects = read_objects(repo, names)
    paths = {}

    def walk(tree, prefix, depth=0):
        if depth > 100:
            raise ScanError("Git tree exceeds supported nesting")
        # Objects excluded by the trusted base cannot contain newly reachable blobs.
        if tree not in objects:
            return
        kind, body = objects[tree]
        if kind != "tree":
            raise ScanError("invalid Git tree")
        offset = 0
        while offset < len(body):
            end = body.index(b"\0", offset)
            mode, name = body[offset:end].split(b" ", 1)
            name = name.decode("utf-8", errors="strict")
            if name in ("", ".", "..") or "/" in name or "\\" in name:
                raise ScanError("unsupported Git path")
            oid = body[end + 1:end + 21].hex()
            path = prefix + name
            offset = end + 21
            if mode == b"40000":
                walk(oid, path + "/", depth + 1)
            elif mode == b"160000":
                raise ScanError("submodule contents require a separately reviewed scan")
            elif oid in objects:
                paths.setdefault(oid, set()).add(path)

    roots = set()
    for oid, (kind, body) in objects.items():
        if kind == "commit":
            match = re.match(rb"tree ([a-f0-9]{40})\n", body)
            if not match:
                raise ScanError("invalid commit object")
            roots.add(match[1].decode())
    for tree in roots:
        walk(tree, "")
    contents = []
    for oid, (kind, body) in objects.items():
        if kind == "blob":
            if oid not in paths:
                raise ScanError("blob has no covered repository path")
            contents.append((sorted(paths[oid]), body))
        elif kind == "commit":
            contents.append(([".git-commit/" + oid], body))
    return contents


def local_content(repo):
    # Never discover ignored/untracked local credentials. Stage new files first.
    entries = git(repo, "ls-files", "--stage", "-z").split(b"\0")
    paths = {}
    working = []
    for entry in filter(None, entries):
        metadata, raw_path = entry.split(b"\t", 1)
        mode, oid, stage = metadata.decode().split()
        path = raw_path.decode("utf-8")
        if stage != "0" or mode == "160000":
            raise ScanError("resolve conflicts and submodule coverage before scanning")
        if path.startswith("/") or ".." in path.split("/") or "\\" in path:
            raise ScanError("unsupported tracked path")
        paths.setdefault(oid, set()).add(path)
        target = repo / path
        if target.is_symlink():
            # Inspect target text, never follow it outside the repository.
            working.append(([path], str(target.readlink()).encode("utf-8")))
            continue
        if target.exists():
            if not target.resolve().is_relative_to(repo.resolve()):
                raise ScanError("tracked path escapes repository")
            working.append(([path], target.read_bytes()))
    for entry in filter(None, git(repo, "ls-tree", "-r", "-z", "HEAD").split(b"\0")):
        metadata, raw_path = entry.split(b"\t", 1)
        _, kind, oid = metadata.decode().split()
        if kind != "blob":
            raise ScanError("unsupported HEAD object")
        paths.setdefault(oid, set()).add(raw_path.decode("utf-8"))
    objects = read_objects(repo, list(paths))
    return working + [(sorted(paths[oid]), body) for oid, (kind, body) in objects.items() if kind == "blob"]


def content_views(body):
    """Normalize Unicode text without discarding the raw view of binary objects."""
    # Check UTF-32 first: its little-endian BOM begins with the UTF-16 BOM.
    for marker, encoding in ((b"\xff\xfe\0\0", "utf-32"), (b"\0\0\xfe\xff", "utf-32"),
                             (b"\xff\xfe", "utf-16"), (b"\xfe\xff", "utf-16"),
                             (b"\xef\xbb\xbf", "utf-8-sig")):
        if body.startswith(marker):
            try:
                return [body.decode(encoding, errors="strict").encode("utf-8")]
            except UnicodeError:
                raise ScanError("coverage error: malformed BOM-marked text") from None
    views = [body]
    if b"\0" in body:
        # BOM-less UTF-16/32 and binary-embedded text have no reliable charset
        # declaration. Scan both byte orders in addition to the unchanged raw
        # bytes. Replacement affects malformed units only, not adjacent text.
        for encoding in ("utf-16-le", "utf-16-be", "utf-32-le", "utf-32-be"):
            views.append(body.decode(encoding, errors="replace").encode("utf-8"))
    return views


def diagnostic_path(path, secrets):
    """Never repeat a detected value through the diagnostic metadata channel."""
    for secret in sorted(secrets, key=lambda value: (-len(value), value)):
        path = path.replace(secret, "[REDACTED]")
    return path


def diagnostic_secrets(findings):
    values = set()
    for finding in findings:
        value = finding["Secret"]
        values.add(value)
        if finding["RuleID"] == "hashicorp-tf-password":
            # Upstream captures the surrounding double quotes as well.
            values.add(value.strip('"'))
        elif finding["RuleID"] == "kubernetes-secret-yaml":
            # Upstream captures the YAML key and scalar, not just its value.
            scalar = value.split(":", 1)[-1].strip()
            scalar = re.sub(r"^[|>][-+]?\s+", "", scalar).strip("\"'")
            values.add(scalar)
    return values - {""}


def detection_keywords(root=ROOT):
    """Read keyword prerequisites from the verified pin, including Python 3.10.

    This is deliberately the pin's narrow JSON-string-array syntax, not a TOML
    parser. A changed pin or unsupported keyword syntax fails closed.
    """
    rules = (root / "config/gitleaks.toml").read_bytes().replace(b"\r\n", b"\n")
    if digest(rules) != RULES_SHA256:
        raise ScanError("unreviewed detection configuration")
    result = {}
    try:
        for section in re.split(r"(?m)^\[\[rules\]\]\s*$", rules.decode("utf-8"))[1:]:
            rule = re.search(r'^id = "([a-z0-9-]+)"$', section, re.MULTILINE).group(1)
            match = re.search(r"(?m)^keywords = (\[[^\]]*\])\s*$", section)
            if match is None:
                if re.search(r"(?m)^keywords\b", section):
                    raise ValueError()
                result[rule] = ()
                continue
            keywords = json.loads(re.sub(r",\s*\]$", "]", match[1]))
            if (not isinstance(keywords, list)
                    or any(not isinstance(word, str) or not word or not word.isascii() for word in keywords)):
                raise ValueError()
            result[rule] = tuple(word.lower() for word in keywords)
        if not result:
            raise ValueError()
        return result
    except (ValueError, AttributeError, UnicodeError):
        raise ScanError("unsupported pinned keyword configuration") from None


def keyword_context(body):
    # Gitleaks uses Go strings.ToLower (simple Unicode lowercase), not casefold.
    # Python's only expanding lowercase is U+0130 -> i + combining dot; Go
    # lowers that rune to plain i. Invalid UTF-8 cannot supply an ASCII keyword.
    return body.decode("utf-8", errors="replace").replace("\u0130", "I").lower()


def scan_contents(binary, contents, entries, root=ROOT):
    allowed = validate_allowlist(entries)
    keywords = detection_keywords(root)
    pieces = [PREAMBLE]
    starts, records = [], []
    line = 3
    # Concatenate raw objects in memory. ASCII preamble disables binary-file sniff
    # skipping. Filename-dependent rules run separately on each eligible object;
    # real paths are never supplied to the scanner or used for file discovery.
    # Blank separators prevent assignments continuing across object boundaries.
    seen = set()
    views = ((paths, view) for paths, body in contents for view in content_views(body))
    for paths, body in views:
        body = body.replace(b"\r\n", b"\n")
        identity = (tuple(paths), digest(body))
        if identity in seen:
            continue
        seen.add(identity)
        starts.append(line)
        records.append((paths, body))
        pieces.append(body + b"\n\n")
        line += body.count(b"\n") + 2
    payload = b"".join(pieces)
    if len(payload) > MAX_BYTES:
        raise ScanError("scan input exceeds coverage limit; no partial scan performed")
    findings = scan_input(binary, payload, root)
    located = []
    for finding in findings:
        index = bisect.bisect_right(starts, finding["StartLine"]) - 1
        if index < 0:
            raise ScanError("invalid scanner location")
        paths, body = records[index]
        located.append((finding, paths, body, finding["StartLine"] - starts[index] + 1,
                        finding["EndLine"] - starts[index] + 1))
    for paths, body in records:
        eligible = {rule: [path for path in paths if re.search(pattern, path)]
                    for rule, pattern in PATH_RULES.items()}
        enabled = [rule for rule, paths_for_rule in eligible.items() if paths_for_rule]
        if not enabled:
            continue
        # One object per pass: multiline rules must not combine unrelated files,
        # historical versions, or different Unicode views of the same object.
        for finding in scan_input(binary, PREAMBLE + body + b"\n\n", root, enabled):
            located.append((finding, eligible[finding["RuleID"]], body,
                            finding["StartLine"] - 2, finding["EndLine"] - 2))
    # Raw scanner reports stay in memory and are never logged or persisted.
    # Retain values only long enough to redact ALL diagnostic paths, including
    # occurrences of a finding's value in another finding's filename.
    secrets = diagnostic_secrets(finding for finding, *_ in located)
    output = set()
    contexts = {}
    for finding, paths, body, row, end_row in located:
        lines = body.split(b"\n")
        if row < 1 or end_row > len(lines):
            raise ScanError("scanner match crosses object boundary")
        rule = finding["RuleID"]
        # The stdin reader's fragment may contain several unrelated objects.
        # Its keyword prefilter must not promote a broad token regex in one
        # object because a different file/version/view contains the keyword.
        # Keep original findings above for redaction and validate bounds first.
        if keywords[rule]:
            if id(body) not in contexts:
                contexts[id(body)] = keyword_context(body)
            if not any(word in contexts[id(body)] for word in keywords[rule]):
                continue
        # The entire source line is hashed, never printed or saved in the allowlist.
        fingerprint = digest(rule.encode() + b"\0" + b"\n".join(lines[row - 1:end_row]))
        for path in paths:
            if (rule, path, fingerprint) not in allowed:
                output.add((rule, diagnostic_path(path, secrets), row, fingerprint))
    return sorted(output)


def main():
    try:
        started = time.monotonic()
        args = sys.argv[1:]
        binary = scanner_binary()
        if args == ["install"]:
            print("Secret scanner installation verified: Gitleaks 8.30.1")
            return 0
        head = git(ROOT, "rev-parse", "HEAD").decode().strip()
        if len(args) == 5 and args[0] == "ci":
            event, base, pr_head, checked_sha = args[1:]
            if full_sha(ROOT, checked_sha) != head:
                raise ScanError("CI checkout does not match the event SHA")
            if event == "pull_request":
                full_sha(ROOT, base)
                full_sha(ROOT, pr_head)
                ranges = [("introduced-range", pr_head, base), ("reachable-history", head, None)]
            elif event == "push" and base == "" and pr_head == "":
                ranges = [("reachable-history", head, None)]
            else:
                raise ScanError("unsupported CI event")
            entries = json.loads((ROOT / "config/secret-allowlist.json").read_text())
            failed = False
            for label, scan_head, scan_base in ranges:
                scan_started = time.monotonic()
                findings = scan_contents(binary, history_content(ROOT, scan_head, scan_base), entries)
                for rule, path, row, fingerprint in findings:
                    print(json.dumps({"rule": rule, "path": path, "line": row, "fingerprint": fingerprint}))
                elapsed = time.monotonic() - scan_started
                print(f"Secret scan: mode={label} head={scan_head} findings={len(findings)} seconds={elapsed:.3f}")
                failed = failed or bool(findings)
                if elapsed >= 60:
                    raise ScanError("CI scan exceeded the 60-second budget")
            return 1 if failed else 0
        if args == ["local"]:
            contents = local_content(ROOT)
        elif args == ["history"]:
            contents = history_content(ROOT, head)
        elif len(args) == 3 and args[0] == "range":
            head = full_sha(ROOT, args[2])
            contents = history_content(ROOT, head, args[1])
        else:
            raise ScanError("use install, local, history, or range BASE_SHA HEAD_SHA")
        entries = json.loads((ROOT / "config/secret-allowlist.json").read_text())
        findings = scan_contents(binary, contents, entries)
        for rule, path, row, fingerprint in findings:
            print(json.dumps({"rule": rule, "path": path, "line": row, "fingerprint": fingerprint}))
        print(f"Secret scan: head={head} findings={len(findings)} seconds={time.monotonic() - started:.3f}")
        return 1 if findings else 0
    except ScanError as error:
        print(f"Secret guard failed: {error}", file=sys.stderr)
        return 2
    except Exception:
        print("Secret guard failed: unexpected error; details suppressed", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
