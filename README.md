# gh-pry

Pry open a single GitHub PR from the terminal — conversation, review threads, and CI checks in one screen; reply, resolve, comment, review, and merge without leaving it; read failed CI logs in place; and open the diff in [hunk](https://hunk.dev) with one key.

```bash
gh pry          # the current branch's PR
gh pry 123      # PR #123 in this repo
```

Needs an authenticated [`gh`](https://cli.github.com) and, for the diff view, `hunk` on your PATH.

## Install

```bash
gh extension install chrismatix/gh-pry
```

Runs as a `gh` extension, so `gh pry` works anywhere. The `gh-pry` executable also works on its own if you put it on your PATH.

## Screen

Header (title, author, branches, review decision, checks, mergeability, unresolved count), the tabs, a list that scrolls to fit the terminal, a preview panel with the selected item in full, and a key hint / status line. The Conversation tab starts with the PR description.

## Stacks

When the PR sits in a chain of PRs, a fourth **Stack** tab appears listing the whole chain trunk-first with each PR's checks and review decision. `enter` switches to the selected PR in place; `[` and `]` jump down and up the chain from any tab. The chain is derived from base-ref links between open PRs, and from `gh stack view` when that extension tracks the branches.

## Keys

| Key | Action |
| --- | --- |
| `tab`, `1`/`2`/`3`/`4` | switch Conversation / Threads / Checks / Stack |
| `[` / `]` | switch to the PR below / above in the stack |
| `j`/`k`, `g`/`G` | move selection (the preview follows) |
| `enter` | open the selected comment or thread in the reader; on Checks, the job log; on Stack, switch PR |
| `d` | open the diff in hunk (checked-out branch → merge-base diff, else `gh pr diff \| hunk patch`) |
| `r` / `x` / `h` | reply to thread / resolve-unresolve / show-hide resolved |
| `c` | comment on the PR conversation |
| `a` | submit a review (Comment / Approve / Request changes) |
| `m` | merge (method picker; auto-merge offered while checks pend) |
| `u` | on Checks: rerun failed runs |
| `R` / `q` | refresh / quit |

### Reader and log viewer

`enter` on a check fetches that job's log through `gh run view --job` — failed steps only when the check failed, the full log otherwise — grouped by step with timestamps stripped and error lines in red. The same viewer shows long comments and whole threads.

| Key | Action |
| --- | --- |
| `j`/`k`, `d`/`u`, `g`/`G` | line, half page, top/bottom |
| `h`/`l` | scroll sideways for long lines |
| `/`, `n`/`N` | search (matches highlighted), next/previous match |
| `q`, `esc` | close |

## How it works

Reads go through one `gh api graphql` call (threads with resolved state, checks rollup with job ids, review decision, mergeability, timeline, and any base-ref stack); writes go through `gh`. Pressing `d` hands the terminal to hunk and returns you to the same screen when hunk exits.

## Develop

```bash
bun install
bun run typecheck
bun test            # model parsing + Ink render tests (ink-testing-library, headless)
bun run src/cli.tsx 123
```
