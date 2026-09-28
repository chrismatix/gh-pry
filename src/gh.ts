import { spawn } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildStack,
  parseGhStackView,
  parseOpenPrs,
  parsePrDetails,
  type OpenPrSummary,
  type PrDetails,
  type StackInfo,
} from "./model";

export function run(
  command: string,
  args: string[],
  options: { cwd?: string; input?: string; timeoutMs?: number } = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd });
    let stdout = "";
    let stderr = "";
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (options.timeoutMs) {
      timer = setTimeout(() => child.kill("SIGKILL"), options.timeoutMs);
    }
    child.stdout.on("data", (data) => (stdout += data));
    child.stderr.on("data", (data) => (stderr += data));
    child.on("error", (error) => {
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr });
    });
    if (options.input !== undefined) child.stdin.write(options.input);
    child.stdin.end();
  });
}

export async function mustRun(command: string, args: string[], options: { cwd?: string; input?: string; timeoutMs?: number } = {}): Promise<string> {
  const result = await run(command, args, options);
  if (result.code !== 0) {
    throw new Error((result.stderr || result.stdout).trim() || `${command} exited ${result.code}`);
  }
  return result.stdout;
}

export function firstLine(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split("\n")[0];
}

/** owner/repo of the current branch's tracking remote (else origin); null when unresolvable. */
export async function resolveRepo(cwd: string): Promise<string | null> {
  let remote = "origin";
  try {
    const branch = (await mustRun("git", ["branch", "--show-current"], { cwd })).trim();
    if (branch) {
      const configured = await run("git", ["config", `branch.${branch}.remote`], { cwd });
      if (configured.code === 0 && configured.stdout.trim()) remote = configured.stdout.trim();
    }
  } catch {
    return null;
  }
  const url = await run("git", ["remote", "get-url", remote], { cwd });
  if (url.code !== 0) return null;
  const match = url.stdout.trim().replace(/^git@[^:]+:/, "").replace(/^https?:\/\/[^/]+\//, "").replace(/\.git$/, "");
  return match || null;
}

const PR_FIELDS = `
fragment prDetail on PullRequest {
      number title body state isDraft baseRefName headRefName
      reviewDecision mergeable mergeStateStatus
      author { login }
      autoMergeRequest { mergeMethod }
      labels(first: 20) { nodes { name } }
      assignees(first: 10) { nodes { login } }
      reviewRequests(first: 10) { nodes { requestedReviewer { ... on User { login } ... on Team { name } } } }
      reviewThreads(first: 100) {
        nodes {
          id isResolved isOutdated path line diffSide
          comments(first: 50) { nodes { databaseId author { login } body createdAt } }
        }
      }
      commits(last: 1) {
        nodes {
          commit {
            statusCheckRollup {
              state
              contexts(first: 100) {
                nodes {
                  __typename
                  ... on CheckRun {
                    databaseId name status conclusion startedAt completedAt
                    checkSuite { workflowRun { databaseId workflow { name } } }
                  }
                  ... on StatusContext { context state createdAt }
                }
              }
            }
          }
        }
      }
      timelineItems(last: 30, itemTypes: [ISSUE_COMMENT, PULL_REQUEST_REVIEW, HEAD_REF_FORCE_PUSHED_EVENT, PULL_REQUEST_COMMIT, MERGED_EVENT, REVIEW_REQUESTED_EVENT]) {
        nodes {
          __typename
          ... on IssueComment { author { login } body createdAt }
          ... on PullRequestReview { author { login } body state createdAt }
          ... on HeadRefForcePushedEvent { actor { login } createdAt }
          ... on PullRequestCommit { commit { abbreviatedOid messageHeadline committedDate } }
          ... on MergedEvent { actor { login } createdAt }
          ... on ReviewRequestedEvent { actor { login } createdAt requestedReviewer { ... on User { login } } }
        }
      }
}`;

const REPO_FIELDS = "mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed deleteBranchOnMerge";

const PR_BY_NUMBER = `
query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    ${REPO_FIELDS}
    pullRequest(number: $number) { ...prDetail }
  }
}
${PR_FIELDS}`;

const PR_BY_BRANCH = `
query($owner: String!, $name: String!, $branch: String!) {
  repository(owner: $owner, name: $name) {
    ${REPO_FIELDS}
    pullRequests(states: OPEN, headRefName: $branch, first: 1) { nodes { ...prDetail } }
  }
}
${PR_FIELDS}`;

export type PrTarget = { number: number } | { branch: string };

/** Fetching by branch saves the extra `gh pr view` round trip on startup. */
export async function fetchPr(cwd: string, repo: string, target: PrTarget): Promise<PrDetails> {
  const [owner, name] = repo.split("/");
  const byNumber = "number" in target;
  const output = await mustRun("gh", [
    "api", "graphql",
    "-f", `query=${byNumber ? PR_BY_NUMBER : PR_BY_BRANCH}`,
    "-f", `owner=${owner}`,
    "-f", `name=${name}`,
    ...(byNumber ? ["-F", `number=${target.number}`] : ["-f", `branch=${target.branch}`]),
  ], { cwd });
  const repository = JSON.parse(output)?.data?.repository;
  const pullRequest = byNumber ? repository?.pullRequest : repository?.pullRequests?.nodes?.[0];
  if (!pullRequest) {
    throw new Error(byNumber
      ? `PR #${target.number} not found in ${repo}`
      : `no open PR for branch ${target.branch} in ${repo}`);
  }
  return parsePrDetails(pullRequest, repository);
}

const NEIGHBOURS_QUERY = `
query($owner: String!, $name: String!, $base: String!, $head: String!) {
  repository(owner: $owner, name: $name) {
    parent: pullRequests(states: OPEN, headRefName: $base, first: 1) { nodes { ...summary } }
    children: pullRequests(states: OPEN, baseRefName: $head, first: 10) { nodes { ...summary } }
  }
}
fragment summary on PullRequest {
  number title headRefName baseRefName isDraft reviewDecision
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
}`;

const MAX_CHAIN_HOPS = 8;

async function fetchNeighbours(cwd: string, repo: string, base: string, head: string): Promise<{ parents: OpenPrSummary[]; children: OpenPrSummary[] }> {
  const [owner, name] = repo.split("/");
  const output = await mustRun("gh", [
    "api", "graphql",
    "-f", `query=${NEIGHBOURS_QUERY}`,
    "-f", `owner=${owner}`,
    "-f", `name=${name}`,
    "-f", `base=${base}`,
    "-f", `head=${head}`,
  ], { cwd, timeoutMs: 30000 });
  const repository = JSON.parse(output)?.data?.repository;
  return { parents: parseOpenPrs(repository?.parent), children: parseOpenPrs(repository?.children) };
}

/**
 * Walk the base-ref chain outward from this PR. Scanning every open PR is far
 * too slow on a repo with thousands of them, so each hop is an indexed lookup.
 */
export async function fetchStack(cwd: string, repo: string, details: PrDetails): Promise<StackInfo | null> {
  const collected: OpenPrSummary[] = [{
    number: details.number,
    title: details.title,
    headRefName: details.headRefName,
    baseRefName: details.baseRefName,
    isDraft: details.isDraft,
    reviewDecision: details.reviewDecision,
    checksState: details.checksState,
  }];
  const seen = new Set([details.headRefName]);
  const [ghStackBranches] = await Promise.all([
    fetchGhStackBranches(cwd),
    (async () => {
      let base = details.baseRefName;
      let head = details.headRefName;
      for (let hop = 0; hop < MAX_CHAIN_HOPS; hop += 1) {
        const { parents, children } = await fetchNeighbours(cwd, repo, base, head);
        const next = [...parents, ...children].filter((pr) => !seen.has(pr.headRefName));
        if (next.length === 0) break;
        for (const pr of next) {
          seen.add(pr.headRefName);
          collected.push(pr);
        }
        base = parents[0]?.baseRefName ?? base;
        head = children[0]?.headRefName ?? head;
        if (!parents[0] && !children[0]) break;
      }
    })(),
  ]);
  return buildStack(
    { number: details.number, headRefName: details.headRefName, baseRefName: details.baseRefName },
    collected,
    ghStackBranches,
  );
}

async function fetchGhStackBranches(cwd: string): Promise<{ branch: string; prNumber: number | null }[] | null> {
  const result = await run("gh", ["stack", "view", "--json"], { cwd, timeoutMs: 15000 });
  if (result.code !== 0) return null;
  try {
    return parseGhStackView(JSON.parse(result.stdout));
  } catch {
    return null;
  }
}

export async function postReview(
  cwd: string,
  repo: string,
  number: number,
  payload: Record<string, unknown>,
): Promise<void> {
  const temporaryPath = join(tmpdir(), `gh-pry-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(temporaryPath, JSON.stringify(payload));
  try {
    await mustRun("gh", ["api", `repos/${repo}/pulls/${number}/reviews`, "--method", "POST", "--input", temporaryPath], { cwd });
  } finally {
    try {
      unlinkSync(temporaryPath);
    } catch {}
  }
}

export async function postThreadReply(cwd: string, repo: string, number: number, commentId: number, body: string): Promise<void> {
  await mustRun("gh", ["api", `repos/${repo}/pulls/${number}/comments/${commentId}/replies`, "--method", "POST", "-f", `body=${body}`], { cwd });
}

export async function postIssueComment(cwd: string, repo: string, number: number, body: string): Promise<void> {
  await mustRun("gh", ["api", `repos/${repo}/issues/${number}/comments`, "--method", "POST", "-f", `body=${body}`], { cwd });
}

export async function setThreadResolved(cwd: string, threadId: string, resolved: boolean): Promise<void> {
  const mutation = resolved
    ? "mutation($id: ID!) { resolveReviewThread(input: { threadId: $id }) { thread { id } } }"
    : "mutation($id: ID!) { unresolveReviewThread(input: { threadId: $id }) { thread { id } } }";
  await mustRun("gh", ["api", "graphql", "-f", `query=${mutation}`, "-f", `id=${threadId}`], { cwd });
}

export async function fetchJobLog(cwd: string, repo: string, jobId: number, failedOnly: boolean): Promise<string> {
  return mustRun("gh", ["run", "view", "--job", String(jobId), failedOnly ? "--log-failed" : "--log", "-R", repo], { cwd, timeoutMs: 120000 });
}

export async function rerunFailed(cwd: string, repo: string, runId: number): Promise<void> {
  await mustRun("gh", ["run", "rerun", String(runId), "--failed", "-R", repo], { cwd });
}

export type WorktreeState = "clean" | "dirty";

export async function worktreeState(cwd: string): Promise<WorktreeState> {
  const status = await mustRun("git", ["status", "--porcelain"], { cwd });
  return status.split("\n").some((line) => line.length > 0 && !line.startsWith("??")) ? "dirty" : "clean";
}

export async function mergeBaseAgainst(cwd: string, baseRefName: string): Promise<string> {
  await run("git", ["fetch", "origin", baseRefName, "--quiet"], { cwd, timeoutMs: 60000 });
  const viaRemote = await run("git", ["merge-base", "HEAD", `origin/${baseRefName}`], { cwd });
  if (viaRemote.code === 0 && viaRemote.stdout.trim()) return viaRemote.stdout.trim();
  return (await mustRun("git", ["merge-base", "HEAD", baseRefName], { cwd })).trim();
}

/** Resolve a PR number to its head branch and base, for diffing. */
export async function prRefs(cwd: string, repo: string, number: number): Promise<{ headRefName: string; baseRefName: string }> {
  const output = await mustRun("gh", ["pr", "view", String(number), "--json", "headRefName,baseRefName", "-R", repo], { cwd });
  const parsed = JSON.parse(output);
  return { headRefName: parsed.headRefName, baseRefName: parsed.baseRefName };
}

export async function currentBranch(cwd: string): Promise<string> {
  return (await run("git", ["branch", "--show-current"], { cwd })).stdout.trim();
}

export function ghDiffStream(repo: string, number: number): { command: string; args: string[] } {
  return { command: "gh", args: ["pr", "diff", String(number), "-R", repo] };
}
