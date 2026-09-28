# gh-pry

Pry open one GitHub pull request in the terminal. Conversation, review threads and CI checks in a single screen; reply, resolve, review and merge without leaving it; read failed CI logs in place; open the diff in [hunk](https://hunk.dev) with one key.

```bash
gh extension install chrismatix/gh-pry
gh pry          # the current branch's PR
gh pry 123      # PR #123 in this repo
```

![Review threads on a stacked PR](docs/review.png)

Press `enter` on a check to read its log. It opens on the step list, so you can skip setup stages and go straight to the one that failed. Colour from the job is preserved. The same viewer opens long comments and whole threads.

![Reading a failed CI job log](docs/ci-log.png)

## Keys

| Key | Action |
| --- | --- |
| `tab`, `1`–`4` | Conversation / Threads / Checks / Stack |
| `j` `k`, `g` `G` | move; the preview follows |
| `enter` | open the selected item; on Checks, its job log |
| `r` `x` `h` | reply / resolve / show hidden resolved |
| `c` `a` `m` | comment / review / merge |
| `u` | rerun failed checks |
| `[` `]` | previous / next PR in the stack |
| `d` `R` `q` | diff in hunk / refresh / quit |

In the log viewer: `j` `k` line, `pgup` `pgdn` page, `d` `u` half page, `g` `G` ends, `h` `l` sideways, `[` `]` jump between steps, `o` back to the step list, `/` then `n` `N` to search, `q` to close.

## Stacks

The Stack tab lists the chain this PR sits in, with each PR's checks and review state, and `enter` switches to one in place. The chain is resolved in the background, so the tab shows `…` until it lands and `—` when the PR stands alone. It comes from base-ref links between open PRs, and from `gh stack view` when that extension tracks the branches.

## Requires

An authenticated [`gh`](https://cli.github.com), and `hunk` on your PATH for the diff key. Reads are one `gh api graphql` call; writes go through `gh`.

## Develop

```bash
bun install && bun run typecheck && bun test
bun run src/cli.tsx 123
```
