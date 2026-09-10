# Committed-secret guard

## Local verification

Run `npm run check:secrets` (or the full `npm run check`) from the repository
root. Python 3.10+ and Git must be on PATH. Stage new files before scanning.
The local mode checks HEAD, the index, and tracked working files, including
staged content subsequently removed from the working file. It does not read
ignored or untracked files, including `.env.local`. Symlink target text is
scanned from Git without following the target.

The first run downloads Gitleaks 8.30.1 from its official GitHub release and
verifies the committed SHA-256 archive digest. Subsequent runs verify the cached
archive and executable. There is no PATH fallback, remote scanning service,
telemetry, or repository-content upload. Configuration and binary verification
fail closed. Supported release targets are Windows x64, Linux x64, and macOS
x64/ARM64. Other platforms fail rather than silently skipping the check.

Gitleaks is MIT-licensed. The version, upstream, archive digests, update owner,
and review cadence are in `config/secret-scanner.json`. Alexander Wohlford owns
monthly security-update review. A tool or detection-rule update must update the
independent CI contract pins and rerun every synthetic fixture before merging.

The checked-in `config/gitleaks.toml` contains all 222 upstream detection rules
plus the two CoBudget rules. Global and per-rule upstream allowlists are removed:
only `config/secret-allowlist.json` can suppress findings. The upstream source
digest is recorded in the configuration; its MIT notice is in
`config/gitleaks-LICENSE`. Regenerate from the pinned upstream source on an
update, remove every allowlist table, preserve every detection rule, and update
both independent configuration digests after reviewing the resulting changes.
Four upstream content rules also require filename predicates (Terraform/HCL,
Kubernetes YAML, NuGet configuration, and Freemius PHP). Their predicates are
relocated to `PATH_RULES` in the wrapper, with matching comments in the pinned
configuration. These rules are excluded from the general stream and run only on
eligible paths, one object/version/Unicode view at a time. This preserves their
filename restrictions without writing credentials to temporary files, applying
path exclusions, or combining unrelated files into a multiline match. Keep this
mapping synchronized when updating upstream rules.

## History coverage

`python scripts/secret_scanner.py history` scans all commits and blobs reachable
from HEAD. `python scripts/secret_scanner.py range BASE_SHA HEAD_SHA` scans the
objects reachable from that exact head but not the exact trusted base. Both
SHAs must identify locally available commits. Shallow or grafted history fails;
replace objects are disabled. Missing objects, unsupported submodules or paths,
subprocess failures, and timeouts fail rather than reducing coverage to the tip.

The wrapper reads Git objects directly, not just diffs. It reconstructs every
covered blob's paths, scans complete file versions and commit messages, and
therefore detects content deleted before the tip and merge-only content. Raw
objects are supplied to the scanner through an in-memory stream with line
mapping, not stored as plaintext reports or temporary checkout files. An ASCII
preamble avoids binary-type skipping; no scanner path exclusions are applied.
CRLF is normalized to LF for stable Windows/Git fingerprints. The input cap is
256 MiB; exceeding it fails coverage and requires a reviewed scaling change.

BOM-marked UTF-8, UTF-16, and UTF-32 text is decoded strictly; malformed marked
text fails coverage without printing its contents. Objects containing NUL bytes
also receive BOM-less UTF-16/UTF-32 scans in both byte orders, alongside their
unchanged raw-byte scan. Findings use decoded text line numbers and normalized
fingerprints, consistent with the same content saved as UTF-8. Unsupported
encodings and mixed/unaligned embedded character streams remain limitations.

CI checks out full history with no persisted Git credential. On pull requests,
the trusted base/head come from the GitHub event, never branch-supplied shell
text. It scans both the introduced range and the reachable merge-head history.
On main pushes, it scans reachable event-head history. The event checkout SHA
must match HEAD. Each CI scan must complete in under 60 seconds; the existing
required job retains its 15-minute timeout and read-only contents permission.

Detection is pattern-based, not proof that arbitrary data contains no secret.
Encrypted/compressed payloads are scanned as raw bytes, not recursively unpacked;
path-only upstream rules are not evaluated by the content stream. Unknown token
formats, encoding tricks, and patterns spanning the scanner's internal fragment
boundaries remain limitations. Do not commit credential containers or rely on
this control instead of credential hygiene and review.

## Findings and exceptions

Output contains only the named rule, repository path, one-based line, and a
SHA-256 fingerprint. Child stdout/stderr and exception details are never relayed.
The wrapper captures the scanner's unredacted JSON in memory only so it can
remove detected values from every diagnostic filename, including a value found
in another file. Only the wrapper's projected metadata is emitted; detected
values in paths become `[REDACTED]`. For filename-dependent rules whose upstream
capture includes quotes or a YAML key, the contained credential scalar is also
redacted. Raw reports are never saved or forwarded.
A finding exits 1; a coverage or execution error exits 2. Both block the check.

`config/secret-allowlist.json` accepts only exact rule/path/fingerprint entries
with rationale, owner, creation date, and expiry (at most 366 days). The
fingerprint hashes the rule plus the complete matched source lines. Changing a
matched value or moving it to another path invalidates its exception. No global
rule/path regex, inline `gitleaks:allow`, local ignore file, or warning-only mode
is supported. Expired exceptions fail the guard.

The seventy-eight publication-script exceptions cannot be retired, only renewed.
The `generic-api-key` rule matched a field named `key`, which the `Target` rows
in `scripts/sync-confluence.py` used until it was renamed to `target`; rows
added since do not match, so the set stops growing. It does not shrink. The old
spelling survives in every revision that carried it, and `history` mode -- the
local equivalent of the CI reachable-history scan -- reaches all of them.
Removing the entries leaves `local` at zero findings, because the current HEAD
tree no longer contains the old spelling, and takes `history` from zero to 421.
A green `local` scan is therefore not evidence that an entry is spent. Renew the
dates at review; do not remove the entries.

The initial 43 exceptions are verified non-secrets: 42 document target
identifiers in the Confluence publication script and one pre-existing synthetic
configuration-error test sentinel. No credential value is in exception metadata.
After removal of upstream suppressions, 49 more exact historical exceptions
were reviewed for prose, document/code identifiers, and synthetic placeholders;
one additional exception covers an upstream regex matching its own fixed
non-secret provider prefix. Three more exact document target identifiers arrived
with the approved CBD-108 publication changes on main and were verified before
exception approval. Two exact test-source construction lines are also verified
non-secrets; their synthetic credential values are assembled only at runtime.
The current total is 98, with no broad exclusions.

If a finding may be real, stop ordinary implementation and involve the owner.
Revoke/rotate first, never paste the value into an issue, log, or review, and
record only safe location metadata. Credential rotation and history rewriting
require separate authorization; never hide a real finding with an exception.

## Synthetic regression catalog

The catalog lives in `scripts/test_secret_scanner.py`; complete nonfunctional
values are assembled only in isolated test memory/repositories.

| Fixture ID | Intended rule | Neighbor control |
| --- | --- | --- |
| provider-api-token | github-pat | Non-provider-shaped text |
| postgresql-url | cobudget-postgresql-credential | URL without user/password |
| pem-private-key | private-key | Public-key heading |
| entropy-assignment | cobudget-secret-assignment | Short local marker |

Tests cover each positive and negative, `.env.example` with zero matches,
exact exceptions and mutations, output redaction, binary-prefix/path skipping,
line mapping past scanner chunk boundaries, CRLF fingerprints, missing binary,
malformed/error reports, staged-versus-working content, and a real multi-commit
add/rename/delete history in both range and history modes.

Review-regression coverage additionally verifies formerly suppressed URL
passwords (including `false`, `true`, `null`, `example`, and `placeholder`),
all four credential fixtures in UTF-8/16/32 variants, malformed BOMs, stable
decoded locations/fingerprints, and cross-file filename redaction. A real Git
fixture exercises the new scenarios through the local and both CI entry points,
including history-only secrets after the fixture files have been deleted.

Filename-rule regression coverage includes all four upstream rules, neighboring
non-secrets, ineligible filenames, uppercase/nested paths, shared blobs under
eligible and ineligible names, Unicode line/fingerprint stability, exact
exception mutation, own/cross-file scalar redaction, and prevention of matches
assembled across separate files or historical versions. Real Git entry-point
tests cover staged secrets hidden by clean working files and PR/push scans both
before and after rename/delete commits.

## Completion evidence

Local baseline: `610b2314e372dd537403d1a0f9f2201803fe438e`, 519 reachable
commits. Initial full-object scan took approximately seven seconds on Windows.
The historical non-secrets above were classified before exceptions were added.

Implementation: [PR #212](https://github.com/awohlford1/CoBudget/pull/212),
commit `9946a3ddc497040280d919295cf5c47efbc2f374`, Gitleaks 8.30.1.
The complete local `npm run check` passed. The actual root command was also
run in an isolated worktree with a staged synthetic entropy fixture: exit 1,
intended rule and location present, complete synthetic value absent from
combined stdout/stderr. That staged fixture was not committed.

GitHub-hosted Linux evidence, September 5, 2026:

| Control | PR | Immutable run | Result | Range / history seconds |
| --- | --- | --- | --- | --- |
| Clean implementation | [212](https://github.com/awohlford1/CoBudget/pull/212) | [33970195133](https://github.com/awohlford1/CoBudget/actions/runs/33970195133) | Full required job passed | 0.381 / 5.087 |
| provider-api-token | [213](https://github.com/awohlford1/CoBudget/pull/213) | [33970324739](https://github.com/awohlford1/CoBudget/actions/runs/33970324739) | Expected exit 1, github-pat | 0.501 / 6.400 |
| postgresql-url | [214](https://github.com/awohlford1/CoBudget/pull/214) | [33970325844](https://github.com/awohlford1/CoBudget/actions/runs/33970325844) | Expected exit 1, cobudget-postgresql-credential | 0.489 / 6.337 |
| pem-private-key | [215](https://github.com/awohlford1/CoBudget/pull/215) | [33970326763](https://github.com/awohlford1/CoBudget/actions/runs/33970326763) | Expected exit 1, private-key | 0.496 / 6.355 |
| entropy-assignment | [216](https://github.com/awohlford1/CoBudget/pull/216) | [33970327878](https://github.com/awohlford1/CoBudget/actions/runs/33970327878) | Expected exit 1, cobudget-secret-assignment | 0.485 / 6.634 |

The clean job's log spans 105.3 seconds, within the 15-minute job limit. All
14 scanner tests passed on the runner. Its scanned merge head was
`e57b303f18002a4a111b9a78a3b24eb7bc8d4550`; both scans had zero findings.

Every negative branch adds a deliberately nonfunctional value, then removes it
before its tip. Both modes still identify the intended rule at
`cbd114-synthetic.txt:2`. Combined job logs were checked for the complete
redaction sentinel; none contained it. These PRs are evidence only and must
never be merged.

| Fixture | Add commit | Deleted-at-tip commit |
| --- | --- | --- |
| provider-api-token | `bd5ef146a7a07b26f95e13994b66461ddbfe8d95` | `7116c966a9bdba922afc9a02382cedb8d7c8205c` |
| postgresql-url | `7c3ce5ccf63fe5a885258ba608c752c6ecf0764a` | `ed06d8b6e3b3bcffa472949837bc3f75de6cab59` |
| pem-private-key | `e323d9f53bd7c7afc6f5e85e15a4270443049f6b` | `a96358754e6795d00c450d949fb3d46ed43d64eb` |
| entropy-assignment | `b1b868c575a03aa0546b774633fcf3a27ba9f704` | `25f984c26f8437a8a5d51f9724fe5f38350ffb4e` |

CBD-113's template-catalog check passes in this suite. CBD-114 still requires
review, merge authorization, and a zero-unallowlisted-finding scan of the final
merged reachable main before it can be marked Done. Confluence publication is
not part of this pre-merge change.
