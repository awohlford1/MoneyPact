# CoBudget / MoneyPact — working rules for Claude sessions

`AGENTS.md` in this directory is binding for every session, agent, and subtask. Read it before your first change. It governs repository-first document work, Confluence synchronization timing, Jira updates, and GitHub publishing. Nothing below overrides it.

The product brand is **MoneyPact**. `CoBudget` is the repository and Jira codename and stays in identifiers, branch names, and package scopes.

## The gate

Documentation work is checked by Python only and takes about four seconds. Run it before every push:

```bash
python scripts/check-doc-encoding.py && python scripts/check-doc-vocabulary.py && python scripts/check-jira-freshness.py --offline && python scripts/audit-cbd-<n>.py
```

`check-doc-encoding.py` runs first on purpose. `check-doc-vocabulary.py` reads every
document as UTF-8 with no error handling, so a single cp1252 file kills the whole run
with a bare `UnicodeDecodeError` and no filename. Ordering turns that into a message
naming every offending file.

Code work additionally needs `npm run check`, which requires `npm ci` in that working tree.

A guard is not finished until a deliberate violation has failed it. Break the thing the guard protects, watch the guard fail, restore, watch it pass.

## Shared surfaces — single writer only

These files are touched by many packages and are how concurrent work collides. Never edit one as a side effect of package work. Route the change to a separate, focused change instead:

- `.github/workflows/ci.yml`
- `scripts/check-doc-vocabulary.py`, `scripts/check-jira-freshness.py` and `scripts/check-doc-encoding.py`
- `AGENTS.md`, this file, `package.json`
- Any approved document belonging to another package

## Reading Jira

The Atlassian connector is usually unauthenticated. Read live issues through the credential loader in `scripts/audit-jira-links.py`, which takes `JIRA_EMAIL` and `JIRA_API_TOKEN` from `.env.local`. It returns `(base_url, email, token)` — build `Basic base64(email:token)` yourself. Never print the token.

Acceptance criteria are not in a consistent field. `customfield_10066` holds them on older issues (CBD-73, CBD-76) and is empty on newer ones (CBD-77, CBD-102, CBD-108), which carry them in the description body under an `Acceptance criteria` heading. Read both.

Issue links carry real dependency direction. `python scripts/audit-jira-links.py` prints the whole Blocks graph with a verdict per link. Do not infer direction from issue numbering, and never reverse a link on the heuristic alone.

## Working in parallel

One agent per working tree. Never two. The main checkout is frequently sitting on a long-running branch, so create worktrees from `origin/main` explicitly:

```bash
git fetch origin && git worktree add ../mp-<name> -b <branch> origin/main
```

`.claude/settings.local.json` is untracked and does not travel to a new worktree. Copy it in, or every `git add` prompts.

## If you are the orchestrator

The orchestrator is the session the user prompts directly. Its job is to decompose work, assign it to a role agent, and integrate the results — not to do the work itself. Keep your own context for routing and judgement.

Available role agents are defined in `.claude/agents/` as Markdown with YAML frontmatter. They mirror the role definitions in the operating-contracts package, which is kept outside this repository, and the Codex adapters in `.codex/agents/` carry the same role text, so both providers dispatch the same eleven roles.

| Agent | Assign it |
| --- | --- |
| `product` | Requirements, user stories, acceptance criteria, roadmap decomposition, scope and dependency analysis |
| `architecture` | Technical design, interfaces, data models, ADR proposals, non-functional requirements |
| `specification` | Writing or revising one CBD documentation package against its acceptance criteria — registers, catalogs, matrices, traceability |
| `scrum` | Jira structure, ticket quality, dependency link direction, planning judgement. You still record routine transitions yourself |
| `implementation` | TypeScript work in `apps/` or `packages/` |
| `reviewer` | Adversarially verifying a finished package before its PR. Read-only |
| `qa` | Behavioral validation against acceptance criteria — integration, regression, edge and failure cases |
| `guard` | Writing an `audit-cbd-*.py`, registering a vocabulary, or adding a version pin |
| `security` | Auth, permissions, financial data, Plaid, PII, secrets, logging, retention |
| `documentation` | Delivered-behavior docs in explicitly named files, and authorized post-merge Confluence sync |
| `release` | Readiness, deploy sequencing, migrations, rollback evidence, release records |

Every role shares one contract, stated in full inside each agent file: work only in the assigned scope and tree, never dispatch another specialist, never write the ledger, never enter the merge lane. Four roles return a fixed disposition — `reviewer` gives `approve` / `request_changes` / `escalate`, `qa` gives `pass` / `fail` / `blocked`, `security` gives `clear` / `remediate` / `reject` / `escalate`, `release` gives `ready` / `not_ready` / `blocked`. A disposition is the specialist's judgement, not a satisfied gate.

Rules that hold regardless of how many agents are running:

1. **One agent per package, and one package per agent.** Every CBD-108 tranche touches all six of its files; two agents in one package conflict on every commit.
2. **Give each agent its own worktree.** Pass `isolation: "worktree"` when you spawn it, or create one and name the path in the prompt.
3. **Assign work, not intentions.** A role agent needs the ticket key, the file list it may write, its gate command, and what it must not touch. Without a fence it will helpfully fix a neighbouring document.
4. **You own the merge lane.** Agents commit and push their branch; they never merge. Merge one PR at a time, rebase onto main, and re-run the gate after the rebase — a sibling's merge can invalidate a version pin your branch was written against.
5. **Approving or closing anything means sweeping for what it just falsified.** Blob pins, baselines, current-state fields, and counts elsewhere in the repo. `check-jira-freshness.py` catches the mechanical half; the rest is reading.
6. **Never let an agent write to Jira or Confluence without the user's explicit authorization for that specific change.**
