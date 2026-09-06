# Conflict-safe Confluence publication (CBD-115)

The repository is the working source. Only approved changes merged into `main`
may be published. The permanent `publish-confluence.yml` workflow is the sole
supported writer; the old `sync-confluence.py` CLI is dry-run only. No page is
created or deleted, and no Confluence content is copied into repository files.

## Current activation gate

`config/confluence-activation.json` is deliberately disabled. Implementation and
offline tests do not establish live readiness. Before enabling publication:

1. Fetch current Jira state and confirm CBD-113 and CBD-114 are both Done.
2. Have the Product Owner review the manifest, its held dispositions, dependency
   chain, and the exact existing target and source change for the smoke test.
   Do not use a governing baseline as an arbitrary test page. A non-governing
   test target needs its own owner-approved registration; this tool cannot create it.
3. Configure the GitHub `confluence-publication` environment to allow only the
   protected `main` branch (not tags), require manual review by `awohlford1`,
   allow self-review, and prohibit administrator bypass. The Product Owner
   approved this solo-owner exception on 2026-09-06 in CBD-115: it retains a
   manual checkpoint but provides no independent oversight. The owner may
   initiate and approve the same run; automation must not approve a deployment
   on the owner's behalf. Review repository branch protections.
4. A dedicated Confluence identity remains preferred, but the owner-approved
   single-account model may use the owner's existing Atlassian account with a
   separate, expiring API token used only by this publisher. Select only
   `read:page:confluence` and `write:page:confluence`. Write scope alone cannot
   satisfy pre-write comparison and post-write verification. Record the token's
   owner, scope names, expiry and rotation responsibility privately; never its
   value. Revoke/replace it on expiry, compromise or discontinued publication.
   Store `CONFLUENCE_API_TOKEN` as a secret in the protected environment;
   `CONFLUENCE_BASE_URL` and `CONFLUENCE_EMAIL` are environment variables, not
   secrets. BASE_URL must remain the site origin `https://cobudget.atlassian.net`
   (not a space URL or API gateway URL). The publisher sends Basic email/token
   authentication only to `https://api.atlassian.com`, using the fixed tenant
   path `/ex/confluence/868470c5-c51e-465d-85ad-13b3cc8bb40e/wiki/api/v2/pages/`.
   No dynamic tenant discovery, redirects, or legacy-token fallback is allowed.
   Never place credentials in a repository file, command argument, output, or
   untrusted PR job.
5. In a reviewed repository change, record Done prerequisites, an approval
   reference, `exclusive_writer_approval` evidence, the registered approved smoke
   target key, and `enabled: true`. Before granting exclusive-writer approval,
   the owner must verify that all affected pages have no unpublished human
   drafts and enforce page editing restrictions so no other writer can create
   or modify drafts during publication. Reconfirm this in each environment
   approval; do not rely on a stale one-time assertion. The automation does not
   grant or change those restrictions. If exclusivity cannot be enforced, do not
   activate this publisher.
   With a shared human/automation account, permissions cannot distinguish a
   human session from its token: the owner must stop all interactive edits and
   other integrations using that account for the entire approved run. This is
   an operational control, not technically enforced isolation. The account's
   effective access (including groups/admin rights) still determines accessible
   pages; scopes do not restrict the token to the manifest's page allowlist.
   The page-write scope also permits page creation at the API level, although
   this publisher never creates pages. Automated edits carry the owner's
   identity, so workflow run ID, merge SHA and version evidence provide the
   additional audit trail. These residual risks are accepted for the
   single-account model; manual solo-owner GitHub approval, draft clearance,
   page restrictions for other writers, and all reconciliation gates remain.
   Merge with the owner-approved document change. The activation commit is
   itself the push trigger; there is no manual-dispatch or scheduled shortcut.
6. Approve the protected environment run and verify the exact merge SHA, run URL,
   selected source/target, prior/stored page versions and verified read-back.
   Record this evidence in CBD-115 only after fetching its current state.
   Do not call the ticket complete on offline tests alone.

This checkout does not configure credentials, approve a target, or assert that
those external controls already exist. With activation disabled, the workflow
fails visibly before reading a GitHub token or constructing a Confluence client.

## Manifest changes

`config/confluence-publication.json` covers every top-level `docs/*.md` file.
Registered entries retain the reviewed IDs/titles in the legacy target registry.
`config/confluence-bootstrap.json` independently freezes the pre-workflow
dispositions, policies and dependencies at its `bootstrap_sha`. Offline checks
and initial publication validate that snapshot against the source blobs and
legacy registry at that exact historical commit. Do not regenerate it from the
current publication manifest when registering a new target. A target absent
from the historical registry has no assumed common page base, even when its
source file already existed. Renames retain their historical page identity;
target replacements and removals still require explicit retention dispositions.
An approved entry includes a SHA-256 of its exact UTF-8 repository source;
changing the source requires a fresh owner approval and matching digest in the
same reviewed change. A digest is an approval binding, not independent proof of
human approval. Branch and environment reviews enforce that authority.

Other entries are held or explicitly unpublished with rationale, authority and
a reopening condition. Do not promote them simply to make a run pass. The
dependency order conservatively retains the former publisher's baseline gates;
a held or divergent baseline blocks dependent writes. Source-status labels other
than Approved were not automatically promoted to approval.

A rename can preserve page identity. An intentional target change must retain
the old page explicitly and register the replacement. Removing a registered
source requires a `retained_pages` record with `former_path`, `page_id`,
`expected_title`, `rationale`, and `authority`, and a corresponding registry
change. There is no remote delete operation. New target pages must already exist;
without a known common base the publisher permits only an empty page or an
already matching desired body, otherwise manual reconciliation is required.

## Local verification

Use Python 3 with the reviewed converter installed in an isolated environment:

```text
python -m venv .cache/publication-runtime
# Activate that environment using your shell's normal activation command.
python -m pip install --require-hashes --only-binary=:all: -r config/publication-requirements.txt
python scripts/check-publication.py
npm run check
```

`check:publication` runs the same offline contract and isolated Git/mock-HTTP
fixtures as the permanent workflow. Tests do not read `.env.local`, load real
credentials or contact Confluence. The workflow and converter are pinned; a
deliberate change requires review of the corresponding contract pin and tests.

## Reconciliation, failures and recovery

Runs are serialized without cancellation. The effective Base is the most recent
successful ancestral publication head, initially `bootstrap_sha`; it is not
simply the current push's `before`. Coalesced runs and failures before the
publication step can recover automatically. An overtaken older run is a no-op
only after the uncertain-attempt gate passes, and cannot roll pages back. Checkpoint
history must remain available in GitHub Actions; do not delete publication runs.
If retention, pagination, missing commits or divergent history prevents recovery,
stop and establish a reviewed checkpoint after verifying all affected pages.
Never guess a range, force-push, rewrite history, or advance the bootstrap merely
to suppress a conflict. A zero `before` or shallow checkout must be recovered
through a normal main push with full, verified ancestor history.

Publication compares Base, Live and Desired using a strict XHTML subset and
unique heading paths. Changed sections can replace matching Base sections;
unchanged sections retain Live bytes. Overlap, ambiguous headings, unsupported
macros/markup, malformed content, and pages over 1 MiB stop publication. Heading
structure changes require Live to match Base (or already match Desired).
Required baselines must reconcile to their complete approved source even when
the baseline itself changed; otherwise neither it nor its dependants are written.
In-element whitespace is compared exactly, including Unicode spaces and spacing
affected by inherited CSS. Only ASCII gaps between top-level block elements in
unstyled storage are ignored. Storage normalization that cannot satisfy this
contract requires review.
The CBD-70 catalog is exercised at its real repository size.

Every update re-reads the version immediately before one version-conditional PUT
and verifies a subsequent GET, including byte preservation of unchanged
sections. There is no overwrite retry. A PUT followed by a timeout can leave an
updated page even though the run fails. The next run does not adopt that page as
a fresh Live baseline. Before loading Confluence credentials, it reads all
publication workflow runs and every prior run attempt, including attempts hidden
by a rerun. Any attempt that reached publication without a successful complete
run blocks automatic recovery. This includes a failed preservation check, a
timeout, cancellation, or a successful early page followed by a later failure.
Only explicitly skipped publication steps establish a safe pre-publication retry.
Missing, malformed or truncated attempt evidence also stops the run. Earlier
verified writes are not rolled back when a later target fails. Dependent pages
are not attempted after a failed gate.

An uncertain attempt requires explicit owner-reviewed reconciliation. Privately
inspect every potentially affected page and its version history; verify both
the intended changed sections and the original pre-write preserved sections.
Do not infer preservation merely because today's changed sections match Desired.
Resolve discrepancies under owner direction and identify an existing repository
commit whose content has now been verified as the publication checkpoint.
In a focused reviewed merge, add an entry to `config/confluence-recovery.json`
with the exact integer `run_id`, integer `attempt`, `head_sha`, verified
`checkpoint_sha`, and an `authority` reference to the owner's verification
evidence. Never include page bodies or credentials. This approval is specific to
one attempt and cannot exempt a subsequent rerun. The checkpoint must pass the
normal commit/ancestry/manifest checks. Approval records are empty initially;
this implementation does not assert that reconciliation has happened.

A recovery checkpoint must include the bootstrap commit and successful
publication commits that predate
the exact approval record. An older restored source revision is not sufficient:
create and verify a newer repository checkpoint if necessary. Otherwise the run
stops with `recovery-checkpoint-must-include-prior-successes`, rather than letting
an old success silently override the owner's verified live state. Successful
runs whose commits already contain the exact approval may advance beyond its
checkpoint normally. Append approval records in reconciliation order; each
checkpoint must include the preceding record's checkpoint, so an earlier
reconciliation cannot silently override a later restored state. Keep approval
records intact; editing an existing record
requires a fresh reconciliation review, not an administrative wording cleanup.

Published-version conflict detection does not protect unpublished drafts:
[Atlassian's update API](https://developer.atlassian.com/cloud/confluence/rest/v2/api-group-page/#api-pages-id-put)
can reconcile or overwrite a draft when current content is updated. The explicit
draft-clearance/exclusive-writer activation gate is therefore a required external
control, not a guarantee provided by the three-way comparison. Existing human
edits in published content are still preserved by that comparison.

Evidence contains only source/target identities, merge SHA, versions, action and
verification. Conflict heading paths use levels and SHA-256 label fingerprints
so page text cannot leak into logs. Match these against the identified source's
heading labels locally. Full bodies and API response errors are never logged.

On conflict, inspect the exact affected page privately. Obtain owner direction,
reconcile the repository source through a focused reviewed merge, and satisfy
the exact-attempt recovery gate above before the next main push can publish.
Do not run the old
manual publisher or overwrite a human edit to unblock automation. Unsupported
storage requires an explicitly reviewed converter/reconciliation change; a
warning or unchecked manual write is not success.
