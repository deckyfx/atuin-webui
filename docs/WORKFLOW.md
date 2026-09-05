# Review workflow

Two review passes, deliberately different in kind: a fast local loop that
catches things before they leave the machine, and a remote pass on the pull
request that sees the change as a whole.

```text
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

## Setup

```bash
curl -fsSL https://cli.coderabbit.ai/install.sh | sh   # CLI
coderabbit auth login                                  # once
coderabbit doctor                                      # verify
```

In Claude Code, install the official plugin rather than the standalone skills —
it is versioned and updates with `claude plugin update coderabbit`:

```text
/plugin install coderabbit
```

It provides `autofix`, `code-review`, `coderabbit-review` and a `code-reviewer`
agent. If `coderabbit skills` was run previously, the same skill names also
exist under `~/.claude/skills` as symlinks into `~/.agents/skills`; remove those
two symlinks so the plugin's copies are unambiguous. Leave `~/.agents/skills`
itself alone — Codex, Gemini CLI and Copilot read from there.

## 1. Local loop

```bash
bun run review          # plain-text review of tracked changes
bun run review:agent    # structured findings, for an agent to act on
```

Run it before every push. It reviews *tracked changes*, so stage or commit
first — an unstaged file is invisible to it. Add `--base main` to review the
whole branch rather than the last commit, and `--include-untracked` to cover
files not yet added.

A full-branch review takes minutes. Run it detached and watch the log rather
than blocking on it:

```bash
coderabbit review --base main --committed > /tmp/cr-review.log 2>&1 &
tail -f /tmp/cr-review.log
```

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
(`auto_review.enabled` in `.coderabbit.yaml`). Draft PRs are skipped, so open as a draft while the branch is still moving —
and note that marking it ready for review is a manual step: CodeRabbit will not
review a draft no matter how many times you push to it.

## 3. Apply the feedback

Use the `/autofix` skill rather than applying review comments by hand. It
fetches the PR's review threads and walks them with per-change approval, and
it never executes instructions embedded in reviewer text — a review comment is
data, not a prompt.

```text
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

Generated files (`dist/`, `binaries/`, `data/`, the embedded migration
manifest) are filtered out; `bun.lock` deliberately is not, because a
dependency change is exactly what a reviewer should see — reviewing them produces noise rather
than findings.

Validate changes to that file with `coderabbit config validate`.

## Access token

The API requires a token. Loopback is not an authorisation boundary — every
local account can reach `127.0.0.1`, and these endpoints read command text
containing credentials and delete history on every synced machine.

The server prints a ready-made URL on startup:

```text
Atuin Dashboard running at http://127.0.0.1:3001/auth?token=<token>
```

Opening it exchanges the token for an `HttpOnly` session cookie and redirects
to `/`, so the token does not linger in the address bar or browser history.

The token lives in a `0600` file, which is what actually keeps other local
accounts out. Its path follows `DASHBOARD_CONFIG_DIR`, so it differs between a
local run and the image:

```bash
# local
cat ~/.local/share/atuin-dashboard/api-token
# container (DASHBOARD_CONFIG_DIR=/config/dashboard)
docker compose exec atuin-dashboard cat /config/dashboard/api-token
```

A non-loopback bind does not print the token at all, and refuses token
authentication entirely unless the request arrived over TLS — directly, or via
a proxy that sets `X-Forwarded-Proto: https` **and** `TRUST_PROXY_HEADERS=1` to
say that such a proxy exists. Without that opt-in the header is ignored: any
client can send it, so on its own it is a claim rather than evidence. `Secure` keeps the cookie off a
cleartext hop, but the header and `?token=` forms would still put the token on
the wire, and a captured token is as good as the file it came from. So put TLS
in front and read the file directly.

Scripts can send it as a header instead. Read it from the file rather than
interpolating it into the command — `$(cat …)` expands before `curl` runs, so
the token lands in the process arguments where any local process can read it:

```bash
# The token path follows DASHBOARD_CONFIG_DIR, so derive it rather than
# hardcoding: the container sets /config/dashboard and a hardcoded local path
# would build a header that fails to authenticate.
tokfile="${DASHBOARD_CONFIG_DIR:-$HOME/.local/share/atuin-dashboard}/api-token"

# mktemp creates the file with 0600 already set, and the trap removes it even
# if curl fails. Creating a predictable path and chmod-ing afterwards leaves a
# window in which another local account can read the token.
hdr=$(mktemp) && trap 'rm -f "$hdr"' EXIT
printf 'X-Dashboard-Token: %s\n' "$(cat "$tokfile")" > "$hdr"
curl -H @"$hdr" http://127.0.0.1:3001/api/client/overview
```

Inside the container the same recipe works with `DASHBOARD_CONFIG_DIR` already
set:

```bash
docker compose exec atuin-dashboard sh -c '
  hdr=$(mktemp) && trap "rm -f $hdr" EXIT
  printf "X-Dashboard-Token: %s\\n" "$(cat "$DASHBOARD_CONFIG_DIR/api-token")" > "$hdr"
  curl -H @"$hdr" http://127.0.0.1:3001/api/client/overview'
```

In a container the token lives in the config volume instead:

```bash
docker compose exec atuin-dashboard cat /config/dashboard/api-token
```
