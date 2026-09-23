# hpr

Review a single GitHub PR from the terminal — conversation, review threads, and CI checks in one screen; reply, resolve, comment, review, and merge without leaving it; and open the diff in [hunk](https://hunk.dev) with one key.

```bash
hpr          # the current branch's PR
hpr 123      # PR #123 in this repo
```

Needs an authenticated [`gh`](https://cli.github.com) and, for the diff view, `hunk` on your PATH.

## Keys

| Key | Action |
| --- | --- |
| `tab`, `1`/`2`/`3` | switch Conversation / Threads / Checks |
| `j`/`k`, `g`/`G` | move selection |
| `d` | open the diff in hunk (checked-out branch → merge-base diff, else `gh pr diff \| hunk patch`) |
| `r` / `x` / `h` | reply to thread / resolve-unresolve / show-hide resolved |
| `c` | comment on the PR conversation |
| `a` | submit a review (Comment / Approve / Request changes) |
| `m` | merge (method picker; auto-merge offered while checks pend) |
| `enter` / `u` | on Checks: failed-log tail / rerun failed runs |
| `R` / `q` | refresh / quit |

## How it works

Reads go through one `gh api graphql` call (threads with resolved state, checks rollup, review decision, mergeability, timeline, and any base-ref stack); writes go through `gh`. Pressing `d` hands the terminal to hunk and returns you to the same screen when hunk exits.

## Develop

```bash
bun install
bun run typecheck
bun test            # model parsing + Ink render tests (ink-testing-library, headless)
bun run src/cli.tsx 123
```
