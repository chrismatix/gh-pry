import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import { App } from "../src/app.tsx";
import { parseRunLog, type PrDetails, type TimelineItem } from "../src/model.ts";
import { findInPager, getState, moveSelection, openPager, scrollPager, setState, updatePager, type State } from "../src/store.ts";

function samplePr(): PrDetails {
  return {
    number: 7,
    title: "Add relative-time helper",
    body: "Adds a helper.\n\nSecond paragraph.",
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
      { id: "T1", isResolved: false, isOutdated: false, path: "src/x.ts", line: 4, side: "RIGHT", comments: [{ databaseId: 1, author: "alice", body: "clamp negatives?", createdAt: "2026-01-01" }, { databaseId: 3, author: "chris", body: "will do", createdAt: "2026-01-02" }] },
      { id: "T2", isResolved: true, isOutdated: false, path: "README.md", line: 2, side: "RIGHT", comments: [{ databaseId: 2, author: "bob", body: "nit", createdAt: "2026-01-02" }] },
    ],
    checks: [
      { name: "test", kind: "check-run", status: "COMPLETED", conclusion: "SUCCESS", startedAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:01:05Z", runId: 42, jobId: 420, workflow: "CI" },
      { name: "lint", kind: "check-run", status: "IN_PROGRESS", conclusion: null, startedAt: null, completedAt: null, runId: 43, jobId: 430, workflow: "CI" },
    ],
    checksState: "PENDING",
    timeline: [{ kind: "comment", author: "bob", body: "looks good", reviewState: null, createdAt: "2026-01-03" }],
    repoSettings: { mergeCommitAllowed: false, squashMergeAllowed: true, rebaseMergeAllowed: false, deleteBranchOnMerge: true },
  };
}

function ready(update: Partial<State> = {}): void {
  setState({
    phase: "ready", repo: "chrismatix/hpr", number: 7, pr: samplePr(), stack: null,
    tab: "conversation", hideResolved: true, overlay: null, pager: null, toast: null,
    selection: { conversation: 0, threads: 0, checks: 0 }, scroll: { conversation: 0, threads: 0, checks: 0 },
    viewport: { columns: 100, rows: 30 },
    ...update,
  });
}

function frameOf(): string {
  const { lastFrame, unmount } = render(<App />);
  const frame = lastFrame() ?? "";
  unmount();
  return frame;
}

describe("App", () => {
  test("renders header, tabs, and the description row first", () => {
    ready();
    const frame = frameOf();
    expect(frame).toContain("#7");
    expect(frame).toContain("Add relative-time helper");
    expect(frame).toContain("changes requested");
    expect(frame).toContain("1 unresolved");
    expect(frame).toContain("Conversation 2");
    expect(frame).toContain("› @chris description");
    expect(frame).toContain("@bob commented looks good");
    expect(frame).toContain("Second paragraph.");
  });

  test("threads tab hides resolved by default and previews the whole thread", () => {
    ready({ tab: "threads" });
    const frame = frameOf();
    expect(frame).toContain("src/x.ts:4");
    expect(frame).toContain("+1");
    expect(frame).not.toContain("README.md:2");
    expect(frame).toContain("will do");
  });

  test("checks tab shows icons and durations", () => {
    ready({ tab: "checks" });
    const frame = frameOf();
    expect(frame).toContain("✓ test (CI)  1m 5s");
    expect(frame).toContain("● lint");
    expect(frame).toContain("enter opens the full log");
  });

  test("list scrolls so the selection stays visible", () => {
    const timeline: TimelineItem[] = Array.from({ length: 40 }, (_, index) => ({ kind: "comment", author: "bob", body: `comment ${index}`, reviewState: null, createdAt: "2026-01-03" }));
    ready({ pr: { ...samplePr(), timeline } });
    moveSelection("last");
    const frame = frameOf();
    expect(frame).toContain("› @bob commented comment 39");
    expect(frame).not.toContain("comment 0 ");
    expect(getState().scroll.conversation).toBeGreaterThan(0);
  });

  test("error phase renders the message", () => {
    setState({ phase: "error", message: "no PR for the current branch", overlay: null, pager: null, toast: null });
    expect(frameOf()).toContain("no PR for the current branch");
  });
});

describe("Pager", () => {
  const raw = [
    "﻿test\tSet up job\t2026-09-17T11:17:48.6825707Z Current runner version: '2.337.0'",
    "test\tSet up job\t2026-09-17T11:17:48.6859723Z ##[group]Runner Image Provisioner",
    "test\tRun tests\t2026-09-17T11:18:00.0000000Z ^[[36;1mbun test^[[0m",
    "test\tRun tests\t2026-09-17T11:18:01.0000000Z \u001b[31merror\u001b[0m: expect(received).toBe(expected)",
    "test\tRun tests\t2026-09-17T11:18:01.0000000Z ##[error]Process completed with exit code 1.",
  ].join("\n");

  test("parseRunLog groups by step, strips timestamps and ansi, flags errors", () => {
    const lines = parseRunLog(raw);
    expect(lines.map((line) => `${line.kind}|${line.text}`)).toEqual([
      "step|▸ test › Set up job",
      "text|Current runner version: '2.337.0'",
      "dim|##[group]Runner Image Provisioner",
      "step|▸ test › Run tests",
      "text|bun test",
      "error|error: expect(received).toBe(expected)",
      "error|##[error]Process completed with exit code 1.",
    ]);
  });

  test("renders the log with title, position, and scrolls", () => {
    ready({ viewport: { columns: 100, rows: 8 } });
    openPager("CI / test — failed steps", parseRunLog(raw));
    expect(frameOf()).toContain("CI / test — failed steps  7 lines · 2 error lines");
    expect(frameOf()).toContain("1–5/7");
    scrollPager("last");
    const frame = frameOf();
    expect(frame).toContain("3–7/7");
    expect(frame).toContain("##[error]Process completed");
    expect(frame).not.toContain("Set up job");
  });

  test("search jumps to the next match and wraps around", () => {
    ready({ viewport: { columns: 100, rows: 8 } });
    openPager("log", parseRunLog(raw));
    updatePager({ query: "exit code" });
    findInPager(1, true);
    expect(getState().pager?.top).toBe(2);
    expect(frameOf()).toContain("3–7/7 · /exit code (n/N)");
    updatePager({ query: "runner version" });
    findInPager(1);
    expect(getState().pager?.top).toBe(1);
  });
});
