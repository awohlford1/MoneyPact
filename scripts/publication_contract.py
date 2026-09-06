"""Offline guard for the reviewed publication execution boundary."""

from importlib.metadata import version

from publication import ROOT, PublicationError, bootstrap_manifest, json_object, registry, sha256, validate_manifest
from publication_transport import validate_recovery

WORKFLOW_DIGEST = "a0f46f7b48640b4f0f1ed4952b95e31ada24d7782d467f2f6760587bd5dd1751"
REQUIREMENTS = "Markdown==3.10.3 --hash=sha256:fa6c92a00a4a3c98b22728c64a935ae1928250ae65058a6ded814d2cc29a4cea\n"


def validate_workflow(text):
    # A small, fully reviewed workflow is pinned as a whole: duplicate YAML keys,
    # indirection, alternative triggers and extra secret-bearing steps all fail.
    if sha256(text.replace("\r\n", "\n")) != WORKFLOW_DIGEST:
        raise PublicationError("unreviewed-publication-workflow")


def check(root=ROOT):
    snapshot = json_object((root / "config/confluence-bootstrap.json").read_text(encoding="utf-8"))
    bootstrap_manifest(root, snapshot["bootstrap_sha"])
    validate_recovery(json_object((root / "config/confluence-recovery.json").read_text(encoding="utf-8")))
    validate_workflow((root / ".github/workflows/publish-confluence.yml").read_text(encoding="utf-8"))
    if (root / "config/publication-requirements.txt").read_text(encoding="utf-8") != REQUIREMENTS:
        raise PublicationError("unreviewed-converter-pin")
    if version("Markdown") != "3.10.3":
        raise PublicationError("install-hash-pinned-publication-requirements")
    bodies = {path.relative_to(root).as_posix(): path.read_text(encoding="utf-8")
              for path in (root / "docs").glob("*.md")}
    manifest = json_object((root / "config/confluence-publication.json").read_text(encoding="utf-8"))
    validate_manifest(manifest, set(bodies), bodies, registry())
    for path in (root / ".github/workflows").iterdir():
        if path.name != "publish-confluence.yml" and path.suffix in (".yml", ".yaml"):
            if "CONFLUENCE_" in path.read_text(encoding="utf-8"):
                raise PublicationError("confluence-credentials-outside-publication-workflow")
