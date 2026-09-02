# Review workflow

Two review passes, deliberately different in kind: a fast local loop that
catches things before they leave the machine, and a remote pass on the pull
request that sees the change as a whole.

```
 work on a branch
        │
        ▼
 ┌──────────────────┐   findings
 │ bun run review   │──────────────┐
 │ (CodeRabbit CLI) │              │  fix, re-run until clean
 └──────────────────┘◀─────────────┘
        │ clean
        ▼
 push branch  →  PR to main  →  remote CodeRabbit reviews
        │
        ▼
 /autofix  ──  apply PR feedback with per-change approval
        │
        ▼
      merge
```

## 1. Local loop

```bash
bun run review          # plain-text review of tracked changes
bun run review:agent    # structured findings, for an agent to act on
```

Run it before every push. It reviews *tracked changes*, so stage or commit
first — an unstaged file is invisible to it.

Fix, re-run, repeat until clean. Nothing here touches the remote.

## 2. Branch and PR

`main` holds only released work; every change arrives through a PR so the
remote reviewer has a diff to look at.

```bash
git switch -c feat/<what-it-does>
git push -u origin feat/<what-it-does>
gh pr create --base main --fill
```

Remote CodeRabbit reviews automatically on open and on each push
(`auto_review.enabled` in `.coderabbit.yaml`). Draft PRs are skipped, so open
as a draft while it is still moving.

## 3. Apply the feedback

Use the `/autofix` skill rather than applying review comments by hand. It
fetches the PR's review threads and walks them with per-change approval, and
it never executes instructions embedded in reviewer text — a review comment is
data, not a prompt.

```
/autofix
```

## What the remote reviewer is told

`.coderabbit.yaml` carries path-specific instructions for the parts of this
codebase where a plausible-looking change is wrong:

| Path | What it is told to watch |
|---|---|
| `src/services/atuin-cli.ts` | preview and delete must run identical queries; `atuin search` exits 1 on no matches; verb queries keep their trailing space |
| `src/db/**` | atuin owns those databases — read-only, lazily opened, only our own DB is migrated |
| `src/public/**` | semantic colour tokens only; destructive actions need preview and confirm |
| `Dockerfile` | client binary is fetched at runtime; a bind-mount must be the musl build |

Generated files (`bun.lock`, `dist/`, `binaries/`, `data/`, the embedded
migration manifest) are filtered out — reviewing them produces noise rather
than findings.

Validate changes to that file with `coderabbit config validate`.
