import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import { App } from "../src/app.tsx";
import type { PrDetails } from "../src/model.ts";
import { setState } from "../src/store.ts";

function samplePr(): PrDetails {
  return {
    number: 7,
    title: "Add relative-time helper",
    body: "body",
    state: "OPEN",
    isDraft: false,
    author: "chris",
    baseRefName: "main",
    headRefName: "feat/x",
    reviewDecision: "CHANGES_REQUESTED",
    mergeable: "MERGEABLE",
    mergeStateStatus: "BLOCKED",
    autoMergeMethod: null,
    labels: ["enhancement"],
    assignees: [],
    reviewRequests: ["alice"],
    threads: [
      { id: "T1", isResolved: false, isOutdated: false, path: "src/x.ts", line: 4, side: "RIGHT", comments: [{ databaseId: 1, author: "alice", body: "clamp negatives?", createdAt: "2026-01-01" }] },
      { id: "T2", isResolved: true, isOutdated: false, path: "README.md", line: 2, side: "RIGHT", comments: [{ databaseId: 2, author: "bob", body: "nit", createdAt: "2026-01-02" }] },
    ],
    checks: [
      { name: "test", kind: "check-run", status: "COMPLETED", conclusion: "SUCCESS", startedAt: null, completedAt: null, runId: 42, workflow: "CI" },
      { name: "lint", kind: "check-run", status: "IN_PROGRESS", conclusion: null, startedAt: null, completedAt: null, runId: 43, workflow: "CI" },
    ],
    checksState: "PENDING",
    timeline: [{ kind: "comment", author: "bob", body: "looks good", reviewState: null, createdAt: "2026-01-03" }],
    repoSettings: { mergeCommitAllowed: false, squashMergeAllowed: true, rebaseMergeAllowed: false, deleteBranchOnMerge: true },
  };
}

describe("App", () => {
  test("renders header, tabs, and the active tab body", () => {
    setState({ phase: "ready", repo: "chrismatix/hpr", number: 7, pr: samplePr(), stack: null, tab: "conversation", overlay: null, toast: null });
    const { lastFrame, unmount } = render(<App />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("#7");
    expect(frame).toContain("Add relative-time helper");
    expect(frame).toContain("changes requested");
    expect(frame).toContain("Conversation 1");
    expect(frame).toContain("@bob");
    unmount();
  });

  test("threads tab hides resolved by default and shows the unresolved one", () => {
    setState({ phase: "ready", repo: "chrismatix/hpr", number: 7, pr: samplePr(), stack: null, tab: "threads", hideResolved: true, selection: { conversation: 0, threads: 0, checks: 0 }, overlay: null, toast: null });
    const { lastFrame, unmount } = render(<App />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("src/x.ts:4");
    expect(frame).toContain("clamp negatives?");
    expect(frame).not.toContain("README.md:2");
    unmount();
  });

  test("checks tab shows pass and pending icons", () => {
    setState({ phase: "ready", repo: "chrismatix/hpr", number: 7, pr: samplePr(), stack: null, tab: "checks", overlay: null, toast: null });
    const { lastFrame, unmount } = render(<App />);
    const frame = lastFrame() ?? "";
    expect(frame).toContain("test");
    expect(frame).toContain("lint");
    expect(frame).toContain("✓");
    expect(frame).toContain("●");
    unmount();
  });

  test("error phase renders the message", () => {
    setState({ phase: "error", message: "no PR for the current branch", overlay: null, toast: null });
    const { lastFrame, unmount } = render(<App />);
    expect(lastFrame() ?? "").toContain("no PR for the current branch");
    unmount();
  });
});
