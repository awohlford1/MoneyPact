"""Inventory-backed repository-tool configuration, validated before effects."""

import json
import os
import re
from pathlib import Path
from urllib.parse import urlsplit

INVENTORY = Path(__file__).resolve().parents[1] / "config/environment-inventory.json"


def load_env_file():
    """Read `.env.local` if present. Values are returned, never logged.

    `docs/development.md` places secrets in an untracked `.env.local`, so an
    operator who followed that guidance should not also have to export the same
    values into the shell. Environment variables still win, which keeps CI and
    one-off overrides working.

    This lived in sync-confluence.py until a second tool needed it. It is
    configuration loading, so it belongs beside load_tool_config rather than
    being copied.
    """
    path = INVENTORY.parents[1] / ".env.local"
    if not path.is_file():
        return {}
    values = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        name, value = line.split("=", 1)
        values[name.strip()] = value.strip().strip('"').strip("'")
    return values


class ConfigurationError(ValueError):
    """Contains only variable names and fixed validation rules, never values."""


def validate_rule(name, spec, required):
    if (not isinstance(spec, dict) or spec.get("kind") not in ("https-origin", "email", "token")
            or set(spec) - {"kind", "default"} or not isinstance(required, bool)):
        raise ConfigurationError(f"{name}: unsupported validation rule")
    if "default" in spec:
        if required or spec["kind"] == "token" or not isinstance(spec["default"], str) or not spec["default"]:
            raise ConfigurationError(f"{name}: invalid default declaration")
        validate_value(name, spec["default"], spec["kind"])


def validate(name, raw, spec, required):
    validate_rule(name, spec, required)
    if raw is None or raw == "":
        if required:
            raise ConfigurationError(f"{name}: is required and not set")
        raw = spec.get("default")
        if raw is None:
            return None
    return validate_value(name, raw, spec["kind"])


def validate_value(name, raw, kind):
    valid = isinstance(raw, str) and raw == raw.strip() and not any(ord(c) < 32 or ord(c) == 127 for c in raw)
    if valid and kind == "https-origin":
        try:
            parsed = urlsplit(raw)
            valid = (parsed.scheme == "https" and bool(parsed.hostname)
                     and parsed.username is None and parsed.password is None
                     and parsed.port is None and parsed.path in ("", "/")
                     and "?" not in raw and "#" not in raw
                     and valid_hostname(parsed.netloc))
        except ValueError:
            valid = False
    elif valid and kind == "email":
        valid = re.fullmatch(r"[^\s@:]+@[^\s@]+\.[^\s@]+", raw) is not None
    elif valid and kind == "token":
        valid = not any(c.isspace() for c in raw)
    elif kind not in ("https-origin", "email", "token"):
        raise ConfigurationError(f"{name}: unsupported validation rule")
    if not valid:
        raise ConfigurationError(f"{name}: must satisfy {kind} validation")
    return f"https://{parsed.hostname.lower()}" if kind == "https-origin" else raw


def valid_hostname(host):
    return (0 < len(host) <= 253 and all(
        re.fullmatch(r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?", label) is not None
        for label in host.split(".")))


def load_tool_config(group, file_values, environment=None):
    """Explicit empty environment values win over file values and fail required checks."""
    if environment is None:
        environment = os.environ
    inventory = json.loads(INVENTORY.read_text(encoding="utf-8"))
    rows = [row for row in inventory["variables"] if row.get("group") == group]
    if not rows:
        raise ConfigurationError("Unknown tool configuration group")
    loaded, failures = {}, []
    for row in rows:
        name = row["name"]
        raw = environment.get(name, file_values.get(name))
        try:
            loaded[name] = validate(name, raw, row["validation"], row["required"])
        except ConfigurationError as error:
            failures.append(str(error))
    if failures:
        raise ConfigurationError("Invalid configuration:\n" + "\n".join(failures))
    return loaded
