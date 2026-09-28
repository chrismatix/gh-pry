import { describe, expect, test } from "bun:test";
import { render } from "ink-testing-library";
import { App } from "../src/app.tsx";
import { buildOutline, logLine, parseRunLog, type PrDetails, type StackInfo, type TimelineItem } from "../src/model.ts";
import { findInPager, getState, jumpToStep, moveSelection, openPager, pagerRows, scrollPager, setState, stackNeighbour, tabs, updatePager, type State } from "../src/store.ts";

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
    phase: "ready", repo: "chrismatix/gh-pry", number: 7, pr: samplePr(), stack: null,
    tab: "conversation", hideResolved: true, overlay: null, pager: null, toast: null,
    selection: { conversation: 0, threads: 0, checks: 0, stack: 0 }, scroll: { conversation: 0, threads: 0, checks: 0, stack: 0 },
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

  test("the selection marker keeps its two columns when a row overflows", () => {
    const long = "x".repeat(400);
    const threads = [
      { id: "A", isResolved: false, isOutdated: false, path: "src/a.ts", line: 1, side: "RIGHT" as const, comments: [{ databaseId: 1, author: "alice", body: long, createdAt: "2026-01-01" }] },
      { id: "B", isResolved: false, isOutdated: false, path: "src/b.ts", line: 2, side: "RIGHT" as const, comments: [{ databaseId: 2, author: "bob", body: long, createdAt: "2026-01-01" }] },
    ];
    ready({ tab: "threads", pr: { ...samplePr(), threads } });
    const rows = frameOf().split("\n").filter((line) => !line.includes("│") && (line.includes("src/a.ts") || line.includes("src/b.ts")));
    expect(rows).toHaveLength(2);
    expect(rows[0].startsWith("› ○ src/a.ts:1")).toBe(true);
    expect(rows[1].startsWith("  ○ src/b.ts:2")).toBe(true);
  });

  test("error phase renders the message", () => {
    setState({ phase: "error", message: "no PR for the current branch", overlay: null, pager: null, toast: null });
    expect(frameOf()).toContain("no PR for the current branch");
  });
});

function sampleStack(): StackInfo {
  return {
    tracked: true,
    entries: [
      { number: 5, title: "base helpers", headRefName: "feat/a", baseRefName: "main", reviewDecision: "APPROVED", checksState: "SUCCESS", isCurrent: false },
      { number: 7, title: "Add relative-time helper", headRefName: "feat/x", baseRefName: "feat/a", reviewDecision: "CHANGES_REQUESTED", checksState: "PENDING", isCurrent: true },
      { number: null, title: "", headRefName: "feat/c", baseRefName: null, reviewDecision: null, checksState: null, isCurrent: false },
    ],
  };
}

describe("Stack", () => {
  test("the tab is always present and reports loading, absent, or the chain", () => {
    ready({ stackLoading: true });
    expect(tabs(getState())).toEqual(["conversation", "threads", "checks", "stack"]);
    expect(frameOf()).toContain("Stack …");
    ready({ stackLoading: false });
    expect(frameOf()).toContain("Stack —");
    ready({ stack: sampleStack() });
    expect(frameOf()).toContain("Stack 2/3");
  });

  test("the stack tab says it is still looking, then shows the chain", () => {
    ready({ tab: "stack", stackLoading: true });
    expect(frameOf()).toContain("Looking for a stack…");
    ready({ tab: "stack", stackLoading: false });
    expect(frameOf()).toContain("Not part of a stack");
  });

  test("lists the chain with the current entry marked", () => {
    ready({ stack: sampleStack(), tab: "stack", selection: { conversation: 0, threads: 0, checks: 0, stack: 1 } });
    const frame = frameOf();
    expect(frame).toContain("┌ ✓ #5 base helpers  approved");
    expect(frame).toContain("#7 Add relative-time helper  changes requested  ◂ here");
    expect(frame).toContain("└ · feat/c (no PR)");
    expect(frame).toContain("this is the PR you are reading");
  });

  test("previews a switch target and names branchless entries", () => {
    ready({ stack: sampleStack(), tab: "stack", selection: { conversation: 0, threads: 0, checks: 0, stack: 0 } });
    const frame = frameOf();
    expect(frame).toContain("#5 base helpers");
    expect(frame).toContain("feat/a → main");
    expect(frame).toContain("tracked by gh stack");
    expect(frame).toContain("enter switches to this PR");
    ready({ stack: sampleStack(), tab: "stack", selection: { conversation: 0, threads: 0, checks: 0, stack: 2 } });
    expect(frameOf()).toContain("no PR open for this branch yet");
  });

  test("stackNeighbour skips entries that have no PR and stops at the ends", () => {
    ready({ stack: sampleStack() });
    expect(stackNeighbour(getState(), -1)?.number).toBe(5);
    expect(stackNeighbour(getState(), 1)).toBeNull();
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

  test("keeps ANSI colour as segments instead of stripping it", () => {
    const lines = parseRunLog("job\tstep\t2026-01-01T00:00:00.0Z \u001b[32mpassed\u001b[0m and \u001b[1;31mfailed\u001b[0m");
    const body = lines[1];
    expect(body.text).toBe("passed and failed");
    expect(body.segments.map((piece) => [piece.text, piece.color, piece.bold])).toEqual([
      ["passed", "green", false],
      [" and ", undefined, false],
      ["failed", "red", true],
    ]);
  });

  test("buildOutline lists steps and marks the failing one", () => {
    const outline = buildOutline(parseRunLog(raw));
    expect(outline).toEqual([
      { label: "test › Set up job", line: 0, failed: false },
      { label: "test › Run tests", line: 3, failed: true },
    ]);
  });

  test("falls back to group markers when gh reports UNKNOWN STEP", () => {
    const log = [
      "test\tUNKNOWN STEP\t2026-01-01T00:00:00.0Z ##[group]Operating System",
      "test\tUNKNOWN STEP\t2026-01-01T00:00:01.0Z Ubuntu",
      "test\tUNKNOWN STEP\t2026-01-01T00:00:02.0Z ##[endgroup]",
      "test\tUNKNOWN STEP\t2026-01-01T00:00:03.0Z ##[group]Run bun test",
      "test\tUNKNOWN STEP\t2026-01-01T00:00:04.0Z ##[error]boom",
    ].join("\n");
    expect(buildOutline(parseRunLog(log))).toEqual([
      { label: "Operating System", line: 0, failed: false },
      { label: "Run bun test", line: 3, failed: true },
    ]);
  });

  test("opens on the step list and enter jumps past setup", () => {
    const setup = Array.from({ length: 40 }, (_, index) => `test\tSet up job\t2026-01-01T00:00:0${index % 10}.0Z setup line ${index}`);
    const body = Array.from({ length: 40 }, (_, index) => `test\tRun tests\t2026-01-01T00:01:0${index % 10}.0Z result line ${index}`);
    const lines = parseRunLog([...setup, ...body].join("\n"));
    ready({ viewport: { columns: 100, rows: 20 } });
    openPager("ci / test", lines);
    updatePager({ outline: buildOutline(lines), showOutline: true, outlineSelection: 1 });
    const outlineFrame = frameOf();
    expect(outlineFrame).toContain("2 steps");
    expect(outlineFrame).toContain("› · test › Run tests  40 lines");
    expect(outlineFrame).toContain("  · test › Set up job  40 lines");
    jumpToStep(1);
    expect(getState().pager?.showOutline).toBe(false);
    expect(getState().pager?.top).toBe(41);
    const logFrame = frameOf();
    expect(logFrame).toContain("result line 0");
    expect(logFrame).not.toContain("setup line 39");
  });

  test("page keys move a full page and half-page keys move half", () => {
    ready({ viewport: { columns: 100, rows: 30 } });
    openPager("log", Array.from({ length: 200 }, (_, index) => logLine(`line ${index}`)));
    const rows = pagerRows(getState());
    scrollPager(rows);
    expect(getState().pager?.top).toBe(rows);
    scrollPager(-Math.floor(rows / 2));
    expect(getState().pager?.top).toBe(rows - Math.floor(rows / 2));
    scrollPager("last");
    expect(getState().pager?.top).toBe(200 - rows);
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
