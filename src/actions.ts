import {
  currentBranch,
  fetchFailedLog,
  fetchPr,
  firstLine,
  mustRun,
  postIssueComment,
  postReview,
  postThreadReply,
  resolveBranchPr,
  resolveRepo,
  setThreadResolved,
  rerunFailed,
} from "./gh.ts";
import { allowedMergeMethods, checksArePending } from "./model.ts";
import { activeThread, getState, setState, toast } from "./store.ts";

const LOG_LINES = 200;

export async function load(cwd: string, numberArg: number | null): Promise<void> {
  setState({ phase: "loading", cwd });
  const repo = await resolveRepo(cwd);
  if (!repo) {
    setState({ phase: "error", message: "not a GitHub repo, or gh could not resolve it" });
    return;
  }
  const number = numberArg ?? (await resolveBranchPr(cwd, repo));
  if (number === null) {
    setState({ phase: "error", message: "no PR for the current branch — pass a number: hpr <number>", repo });
    return;
  }
  await refresh(cwd, repo, number);
}

export async function refresh(cwd = getState().cwd, repo = getState().repo, number = getState().number): Promise<void> {
  if (!repo || number === null) return;
  try {
    const { details, stack } = await fetchPr(cwd, repo, number);
    setState({ phase: "ready", message: undefined, repo, number, pr: details, stack });
  } catch (error) {
    setState({ phase: "error", message: firstLine(error), repo, number });
  }
}

async function withBusy(work: () => Promise<void>): Promise<void> {
  setState({ busy: true });
  try {
    await work();
  } finally {
    setState({ busy: false });
  }
}

export function reply(threadId: string, body: string): Promise<void> {
  return withBusy(async () => {
    const { cwd, repo, number } = getState();
    const thread = getState().pr?.threads.find((candidate) => candidate.id === threadId);
    const root = thread?.comments[0];
    if (!repo || number === null || !root?.databaseId) {
      toast("cannot reply: thread has no root comment id", "error");
      return;
    }
    try {
      await postThreadReply(cwd, repo, number, root.databaseId, body);
      toast(`replied to @${root.author}`);
      await refresh();
    } catch (error) {
      toast(`reply failed: ${firstLine(error)}`, "error");
    }
  });
}

export function toggleResolve(): Promise<void> {
  return withBusy(async () => {
    const thread = activeThread(getState());
    if (!thread) {
      toast("no thread selected", "warning");
      return;
    }
    try {
      await setThreadResolved(getState().cwd, thread.id, !thread.isResolved);
      toast(thread.isResolved ? "thread unresolved" : "thread resolved");
      await refresh();
    } catch (error) {
      toast(`${thread.isResolved ? "unresolve" : "resolve"} failed: ${firstLine(error)}`, "error");
    }
  });
}

export function comment(body: string): Promise<void> {
  return withBusy(async () => {
    const { cwd, repo, number } = getState();
    if (!repo || number === null) return;
    try {
      await postIssueComment(cwd, repo, number, body);
      toast(`commented on PR #${number}`);
      await refresh();
    } catch (error) {
      toast(`comment failed: ${firstLine(error)}`, "error");
    }
  });
}

export function submitReview(event: string, body: string): Promise<void> {
  return withBusy(async () => {
    const { cwd, repo, number } = getState();
    if (!repo || number === null) return;
    const payload: Record<string, unknown> = { event };
    if (body) payload.body = body;
    else if (event === "REQUEST_CHANGES") payload.body = "";
    try {
      await postReview(cwd, repo, number, payload);
      toast(`submitted ${event.toLowerCase().replace("_", " ")} review`);
      await refresh();
    } catch (error) {
      toast(`review failed: ${firstLine(error)}`, "error");
    }
  });
}

export function mergeMethods(): { label: string; flag: string }[] {
  const pr = getState().pr;
  if (!pr) return [];
  const methods = allowedMergeMethods(pr.repoSettings);
  if (checksArePending(pr)) {
    return [{ label: "Auto-merge when green", flag: "--auto" }, ...methods];
  }
  return methods;
}

export function merge(flag: string): Promise<void> {
  return withBusy(async () => {
    const { cwd, repo, number, pr } = getState();
    if (!repo || number === null || !pr) return;
    const auto = flag === "--auto";
    const method = auto ? "--squash" : flag;
    const args = ["pr", "merge", String(number), "-R", repo, method];
    if (auto) args.push("--auto");
    try {
      await mustRun("gh", args, { cwd, timeoutMs: 120000 });
      toast(auto ? "auto-merge enabled" : `merged PR #${number}`);
      await refresh();
    } catch (error) {
      toast(`merge failed: ${firstLine(error)}`, "error");
    }
  });
}

export function rerun(): Promise<void> {
  return withBusy(async () => {
    const { cwd, repo, pr } = getState();
    if (!repo || !pr) return;
    const runIds = [...new Set(
      pr.checks
        .filter((check) => check.status === "COMPLETED" && check.conclusion !== "SUCCESS" && check.conclusion !== "NEUTRAL" && check.conclusion !== "SKIPPED" && check.runId !== null)
        .map((check) => check.runId!),
    )];
    if (runIds.length === 0) {
      toast("no failed workflow runs to rerun");
      return;
    }
    try {
      for (const runId of runIds) await rerunFailed(cwd, repo, runId);
      toast(`rerequested ${runIds.length} run${runIds.length === 1 ? "" : "s"}`);
      await refresh();
    } catch (error) {
      toast(`rerun failed: ${firstLine(error)}`, "error");
    }
  });
}

export async function fetchLog(runId: number): Promise<string[]> {
  const { cwd, repo } = getState();
  if (!repo) return ["no repo"];
  try {
    const lines = await fetchFailedLog(cwd, repo, runId, LOG_LINES);
    return lines.length > 0 ? lines : ["(no failed-step log output)"];
  } catch (error) {
    return [`log fetch failed: ${firstLine(error)}`];
  }
}

export async function diffTarget(): Promise<{ mode: "merge-base"; ref: string } | { mode: "gh-stream" }> {
  const { cwd, repo, number, pr } = getState();
  if (!repo || number === null || !pr) return { mode: "gh-stream" };
  const branch = await currentBranch(cwd);
  if (branch && branch === pr.headRefName) {
    const { mergeBaseAgainst } = await import("./gh.ts");
    try {
      return { mode: "merge-base", ref: await mergeBaseAgainst(cwd, pr.baseRefName) };
    } catch {
      return { mode: "gh-stream" };
    }
  }
  return { mode: "gh-stream" };
}
