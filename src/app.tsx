/** @jsxImportSource react */
import { Box, Text, useApp, useInput } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import { useState } from "react";
import * as actions from "./actions.ts";
import { requestExit } from "./control.ts";
import {
  checkFailed,
  formatDecision,
  formatDuration,
  relativeTime,
  summarizeChecks,
  wrapText,
  type Check,
  type LogLine,
  type ReviewThread,
  type TimelineItem,
} from "./model.ts";
import {
  activeThread,
  conversationItems,
  findInPager,
  layout,
  moveSelection,
  pagerRows,
  scrollPager,
  setState,
  setTab,
  toast,
  updatePager,
  useStore,
  visibleThreads,
  type Overlay,
  type Pager,
  type State,
} from "./store.ts";

function checkIcon(check: Check): { icon: string; color: string } {
  if (check.status !== "COMPLETED") return { icon: "●", color: "yellow" };
  if (checkFailed(check)) return { icon: "✗", color: "red" };
  return check.conclusion === "SUCCESS" ? { icon: "✓", color: "green" } : { icon: "·", color: "gray" };
}

function reviewVerb(reviewState: string | null): { verb: string; color: string } {
  if (reviewState === "APPROVED") return { verb: "approved", color: "green" };
  if (reviewState === "CHANGES_REQUESTED") return { verb: "requested changes", color: "red" };
  return { verb: "reviewed", color: "yellow" };
}

function firstLineOf(text: string | null): string {
  return (text ?? "").split("\n").find((line) => line.trim().length > 0) ?? "";
}

function Header({ state }: { state: State }) {
  const pr = state.pr!;
  const unresolved = pr.threads.filter((thread) => !thread.isResolved).length;
  const decisionColor = pr.reviewDecision === "APPROVED" ? "green" : pr.reviewDecision === "CHANGES_REQUESTED" ? "red" : "yellow";
  const mergeState = pr.state !== "OPEN" ? null
    : pr.mergeable === "CONFLICTING" ? { text: "conflicts", color: "red" }
    : pr.mergeStateStatus === "CLEAN" ? { text: "mergeable", color: "green" }
    : pr.mergeStateStatus ? { text: pr.mergeStateStatus.toLowerCase(), color: "yellow" } : null;
  const stackPosition = state.stack
    ? `stack ${state.stack.entries.findIndex((entry) => entry.isCurrent) + 1}/${state.stack.entries.length}`
    : null;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Text wrap="truncate">
        <Text bold color="cyan">#{pr.number} </Text>
        <Text bold>{pr.title}</Text>
        {pr.isDraft ? <Text color="gray"> [draft]</Text> : null}
        {pr.state === "MERGED" ? <Text color="magenta"> [merged]</Text> : pr.state === "CLOSED" ? <Text color="red"> [closed]</Text> : null}
        {pr.labels.length > 0 ? <Text color="blue">  {pr.labels.map((label) => `⬝${label}`).join(" ")}</Text> : null}
      </Text>
      <Text wrap="truncate">
        <Text color="gray">@{pr.author}  {pr.headRefName} → {pr.baseRefName}  ·  </Text>
        <Text color={decisionColor}>{formatDecision(pr.reviewDecision)}</Text>
        <Text color="gray">  ·  </Text>
        <Text>{summarizeChecks(pr)}</Text>
        {mergeState ? <Text color="gray">  ·  <Text color={mergeState.color}>{mergeState.text}</Text></Text> : null}
        {unresolved > 0 ? <Text color="gray">  ·  <Text color="yellow">{unresolved} unresolved</Text></Text> : null}
        {pr.autoMergeMethod ? <Text color="gray">  ·  auto-merge on</Text> : null}
        {stackPosition ? <Text color="magenta">  ·  {stackPosition}</Text> : null}
      </Text>
    </Box>
  );
}

function Tabs({ state }: { state: State }) {
  const items: { id: State["tab"]; label: string }[] = [
    { id: "conversation", label: `Conversation ${conversationItems(state).length}` },
    { id: "threads", label: `Threads ${visibleThreads(state).length}${state.hideResolved ? "" : " (all)"}` },
    { id: "checks", label: `Checks ${state.pr!.checks.length}` },
  ];
  return (
    <Box>
      {items.map((item) => (
        <Text key={item.id} color={item.id === state.tab ? "cyan" : "gray"} bold={item.id === state.tab}>
          {" "}{item.id === state.tab ? "▸ " : "  "}{item.label}{" "}
        </Text>
      ))}
    </Box>
  );
}

function TimelineRow({ item }: { item: TimelineItem }) {
  const when = <Text color="gray">  {relativeTime(item.createdAt)}</Text>;
  switch (item.kind) {
    case "description":
      return <Text><Text color="cyan">@{item.author}</Text> <Text bold>description</Text> <Text color="gray">{firstLineOf(item.body) || "(empty)"}</Text></Text>;
    case "comment":
      return <Text><Text color="cyan">@{item.author}</Text> commented <Text color="gray">{firstLineOf(item.body)}</Text>{when}</Text>;
    case "review": {
      const { verb, color } = reviewVerb(item.reviewState);
      return <Text><Text color="cyan">@{item.author}</Text> <Text color={color}>{verb}</Text> <Text color="gray">{firstLineOf(item.body)}</Text>{when}</Text>;
    }
    case "force-push":
      return <Text><Text color="cyan">@{item.author}</Text> <Text color="red">force-pushed</Text>{when}</Text>;
    case "commit":
      return <Text color="gray">◦ {item.author} {firstLineOf(item.body)}{when}</Text>;
    case "merged":
      return <Text><Text color="cyan">@{item.author}</Text> <Text color="magenta">merged</Text>{when}</Text>;
    case "review-requested":
      return <Text color="gray"><Text color="cyan">@{item.author}</Text> requested review from @{item.body}{when}</Text>;
  }
}

function ThreadRow({ thread }: { thread: ReviewThread }) {
  const root = thread.comments[0];
  const replies = thread.comments.length - 1;
  return (
    <Text>
      <Text color={thread.isResolved ? "green" : "yellow"}>{thread.isResolved ? "✓" : "○"} </Text>
      <Text color={thread.isResolved ? "gray" : "white"}>{thread.path}:{thread.line ?? "?"}</Text>
      {thread.isOutdated ? <Text color="gray"> [outdated]</Text> : null}
      {root ? <Text color="gray">  <Text color="cyan">@{root.author}</Text> {firstLineOf(root.body)}</Text> : null}
      {replies > 0 ? <Text color="gray">  +{replies}</Text> : null}
    </Text>
  );
}

function CheckRow({ check }: { check: Check }) {
  const { icon, color } = checkIcon(check);
  return (
    <Text>
      <Text color={color}>{icon} </Text>
      {check.name}
      {check.workflow ? <Text color="gray"> ({check.workflow})</Text> : null}
      <Text color="gray">  {formatDuration(check.startedAt, check.completedAt)}</Text>
    </Text>
  );
}

function List({ state }: { state: State }) {
  const { listRows } = layout(state);
  const selection = state.selection[state.tab];
  const top = state.scroll[state.tab];
  let rows: React.ReactNode[];
  let empty: string;
  if (state.tab === "conversation") {
    rows = conversationItems(state).map((item, index) => <TimelineRow key={index} item={item} />);
    empty = "No conversation yet";
  } else if (state.tab === "threads") {
    rows = visibleThreads(state).map((thread) => <ThreadRow key={thread.id} thread={thread} />);
    empty = state.hideResolved ? "No unresolved threads (h shows resolved)" : "No review threads";
  } else {
    rows = state.pr!.checks.map((check, index) => <CheckRow key={index} check={check} />);
    empty = "No checks reported";
  }
  const window = rows.slice(top, top + listRows);
  return (
    <Box flexDirection="column" height={listRows}>
      {window.length === 0 ? <Text color="gray">  {empty}</Text> : null}
      {window.map((row, offset) => {
        const index = top + offset;
        return (
          <Box key={index}>
            <Text color="cyan">{index === selection ? "› " : "  "}</Text>
            <Text wrap="truncate">{row}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

function detailLines(state: State, width: number): LogLine[] {
  const body = (text: string | null, indent = "") =>
    wrapText(text?.trim() ? text : "(empty)", Math.max(width - indent.length, 20)).map((line): LogLine => ({ text: indent + line, kind: text?.trim() ? "text" : "dim" }));
  if (state.tab === "conversation") {
    const item = conversationItems(state)[state.selection.conversation];
    if (!item) return [];
    const when = item.createdAt ? ` · ${relativeTime(item.createdAt)}` : "";
    switch (item.kind) {
      case "description": return [{ text: `@${item.author} · description`, kind: "step" }, ...body(item.body)];
      case "comment": return [{ text: `@${item.author} commented${when}`, kind: "step" }, ...body(item.body)];
      case "review": return [{ text: `@${item.author} ${reviewVerb(item.reviewState).verb}${when}`, kind: "step" }, ...body(item.body)];
      case "commit": return [{ text: `commit ${item.author}${when}`, kind: "step" }, ...body(item.body)];
      case "force-push": return [{ text: `@${item.author} force-pushed${when}`, kind: "step" }];
      case "merged": return [{ text: `@${item.author} merged${when}`, kind: "step" }];
      case "review-requested": return [{ text: `@${item.author} requested review from @${item.body}${when}`, kind: "step" }];
    }
  }
  if (state.tab === "threads") {
    const thread = activeThread(state);
    if (!thread) return [];
    const badges = [thread.isResolved ? "resolved" : "unresolved", thread.isOutdated ? "outdated" : null].filter(Boolean).join(", ");
    const lines: LogLine[] = [{ text: `${thread.path}:${thread.line ?? "?"} (${thread.side.toLowerCase()}) · ${badges}`, kind: "step" }];
    for (const comment of thread.comments) {
      lines.push({ text: `@${comment.author} · ${relativeTime(comment.createdAt)}`, kind: "dim" }, ...body(comment.body, "  "));
    }
    return lines;
  }
  const check = state.pr!.checks[state.selection.checks];
  if (!check) return [];
  const { icon } = checkIcon(check);
  const status = check.status === "COMPLETED" ? (check.conclusion ?? "unknown").toLowerCase() : check.status.toLowerCase().replace("_", " ");
  return [
    { text: `${icon} ${check.name}${check.workflow ? ` · ${check.workflow}` : ""}`, kind: "step" },
    { text: `${status}${check.startedAt ? ` · started ${relativeTime(check.startedAt)}` : ""}${check.startedAt ? ` · ${formatDuration(check.startedAt, check.completedAt)}` : ""}`, kind: checkFailed(check) ? "error" : "text" },
    { text: check.jobId !== null ? `enter opens the ${checkFailed(check) ? "failed-step" : "full"} log` : "no workflow log for this check", kind: "dim" },
  ];
}

function lineColor(line: LogLine): { color?: string; bold?: boolean } {
  switch (line.kind) {
    case "step": return { color: "cyan", bold: true };
    case "error": return { color: "red" };
    case "dim": return { color: "gray" };
    default: return {};
  }
}

function Preview({ state }: { state: State }) {
  const { previewRows } = layout(state);
  const lines = detailLines(state, state.viewport.columns - 4);
  const shown = lines.length > previewRows ? lines.slice(0, previewRows - 1) : lines;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} height={previewRows + 2}>
      {shown.map((line, index) => <Text key={index} wrap="truncate" {...lineColor(line)}>{line.text || " "}</Text>)}
      {lines.length > previewRows ? <Text color="gray">… {lines.length - shown.length} more lines · enter opens</Text> : null}
    </Box>
  );
}

function Footer({ state }: { state: State }) {
  const keys = state.tab === "threads"
    ? "r reply · x resolve · h toggle resolved"
    : state.tab === "checks"
      ? "enter log · u rerun failed"
      : "enter read · c comment";
  const toastColor = state.toast?.kind === "error" ? "red" : state.toast?.kind === "warning" ? "yellow" : "green";
  return (
    <Box flexDirection="column">
      <Text color="gray" wrap="truncate">tab/1-3 switch · j/k move · {keys} · a review · m merge · d diff · R refresh · q quit</Text>
      <Text wrap="truncate">
        {state.busy ? <Text color="yellow">working… </Text> : null}
        {state.toast ? <Text color={toastColor}>{state.toast.text}</Text> : <Text> </Text>}
      </Text>
    </Box>
  );
}

function PagerView({ pager, state }: { pager: Pager; state: State }) {
  const rows = pagerRows(state);
  const width = state.viewport.columns;
  const shown = pager.lines.slice(pager.top, pager.top + rows);
  const needle = pager.query.toLowerCase();
  const last = Math.min(pager.top + rows, pager.lines.length);
  const errors = pager.lines.filter((line) => line.kind === "error").length;
  return (
    <Box flexDirection="column">
      <Text wrap="truncate">
        <Text bold color="cyan">{pager.title}</Text>
        <Text color="gray">  {pager.loading ? "loading…" : `${pager.lines.length} lines${errors > 0 ? ` · ${errors} error lines` : ""}`}</Text>
      </Text>
      <Box flexDirection="column" height={rows}>
        {shown.map((line, index) => {
          const hit = needle.length > 0 && line.text.toLowerCase().includes(needle);
          const text = line.text.slice(pager.column, pager.column + width) || " ";
          return <Text key={pager.top + index} wrap="truncate" {...(hit ? { color: "yellow", bold: true } : lineColor(line))}>{text}</Text>;
        })}
      </Box>
      {pager.searching ? (
        <Box>
          <Text color="cyan">/</Text>
          <TextInput
            value={pager.query}
            onChange={(query) => updatePager({ query })}
            onSubmit={() => {
              updatePager({ searching: false });
              findInPager(1, true);
            }}
          />
        </Box>
      ) : (
        <Text color="gray" wrap="truncate">
          {pager.lines.length === 0 ? "0" : `${pager.top + 1}–${last}`}/{pager.lines.length}
          {pager.column > 0 ? ` · col ${pager.column + 1}` : ""}
          {pager.query ? ` · /${pager.query} (n/N)` : ""}
          {"  ·  j/k scroll · d/u half page · g/G ends · h/l sideways · / search · q close"}
        </Text>
      )}
    </Box>
  );
}

function OverlayView({ overlay }: { overlay: Overlay }) {
  const [value, setValue] = useState("");
  const close = () => setState({ overlay: null });

  if (overlay.kind === "reply" || overlay.kind === "comment") {
    const submit = (text: string) => {
      close();
      if (!text.trim()) return;
      if (overlay.kind === "reply") void actions.reply(overlay.threadId, text.trim());
      else void actions.comment(text.trim());
    };
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text color="cyan">{overlay.title}</Text>
        <TextInput value={value} onChange={setValue} onSubmit={submit} placeholder="type, enter sends, esc cancels" />
      </Box>
    );
  }
  if (overlay.kind === "review-type") {
    const items = [
      { label: "Comment", value: "COMMENT" },
      { label: "Approve", value: "APPROVE" },
      { label: "Request changes", value: "REQUEST_CHANGES" },
    ];
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text color="cyan">Review type (esc cancels)</Text>
        <SelectInput items={items} onSelect={(item) => setState({ overlay: { kind: "review-body", event: item.value, required: item.value === "COMMENT" } })} />
      </Box>
    );
  }
  if (overlay.kind === "review-body") {
    const submit = (text: string) => {
      const body = text.trim();
      if (overlay.required && !body) {
        toast("a Comment review needs a body", "warning");
        return;
      }
      close();
      void actions.submitReview(overlay.event, body);
    };
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text color="cyan">Review body{overlay.required ? " (required)" : " (optional, enter to skip)"}</Text>
        <TextInput value={value} onChange={setValue} onSubmit={submit} placeholder="top-level review comment" />
      </Box>
    );
  }
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text color="cyan">Merge method (enter merges now, esc cancels)</Text>
      <SelectInput
        items={overlay.methods.map((method) => ({ label: method.label, value: method.flag }))}
        onSelect={(item) => {
          close();
          void actions.merge(item.value);
        }}
      />
    </Box>
  );
}

export function App() {
  const state = useStore();
  const { exit } = useApp();

  useInput((input, key) => {
    if (state.pager) {
      const pager = state.pager;
      if (pager.searching) {
        if (key.escape) updatePager({ searching: false, query: "" });
        return;
      }
      if (key.escape || input === "q") return setState({ pager: null });
      if (input === "j" || key.downArrow) return scrollPager(1);
      if (input === "k" || key.upArrow) return scrollPager(-1);
      if (input === "d" || key.pageDown) return scrollPager(Math.floor(pagerRows(state) / 2));
      if (input === "u" || key.pageUp) return scrollPager(-Math.floor(pagerRows(state) / 2));
      if (input === "g") return scrollPager("first");
      if (input === "G") return scrollPager("last");
      if (input === "l" || key.rightArrow) return updatePager({ column: pager.column + 20 });
      if (input === "h" || key.leftArrow) return updatePager({ column: Math.max(pager.column - 20, 0) });
      if (input === "/") return updatePager({ searching: true, query: "" });
      if (input === "n") return findInPager(1);
      if (input === "N") return findInPager(-1);
      return;
    }
    if (state.overlay) {
      if (key.escape) setState({ overlay: null });
      return;
    }
    if (input === "q" || (key.ctrl && input === "c")) {
      requestExit("quit");
      exit();
      return;
    }
    if (state.phase !== "ready") return;

    if (key.tab) { setTab(state.tab === "conversation" ? "threads" : state.tab === "threads" ? "checks" : "conversation"); return; }
    if (input === "1") return setTab("conversation");
    if (input === "2") return setTab("threads");
    if (input === "3") return setTab("checks");
    if (input === "j" || key.downArrow) return moveSelection(1);
    if (input === "k" || key.upArrow) return moveSelection(-1);
    if (input === "g") return moveSelection("first");
    if (input === "G") return moveSelection("last");
    if (input === "R") { void actions.refresh(); return; }
    if (input === "d") { requestExit("diff"); exit(); return; }

    if (input === "a") { setState({ overlay: { kind: "review-type" } }); return; }
    if (input === "m") {
      const methods = actions.mergeMethods();
      if (methods.length === 0) { toast("no merge methods allowed", "warning"); return; }
      setState({ overlay: { kind: "merge-method", methods } });
      return;
    }
    if (key.return) {
      if (state.tab === "checks") {
        const check = state.pr!.checks[state.selection.checks];
        if (check) void actions.openLog(check);
        return;
      }
      const lines = detailLines(state, state.viewport.columns);
      if (lines.length > 0) setState({ pager: { title: lines[0].text, lines: lines.slice(1), top: 0, column: 0, query: "", searching: false, loading: false } });
      return;
    }

    if (state.tab === "threads") {
      const thread = activeThread(state);
      if (input === "r") {
        if (!thread) { toast("no thread selected", "warning"); return; }
        setState({ overlay: { kind: "reply", threadId: thread.id, title: `Reply to @${thread.comments[0]?.author} (${thread.path}:${thread.line ?? "?"})` } });
      } else if (input === "x") {
        void actions.toggleResolve();
      } else if (input === "h") {
        setState({ hideResolved: !state.hideResolved });
        moveSelection("first");
      }
    } else if (state.tab === "conversation") {
      if (input === "c") setState({ overlay: { kind: "comment", title: `Comment on PR #${state.number}` } });
    } else if (state.tab === "checks") {
      if (input === "u") void actions.rerun();
    }
  });

  if (state.phase === "loading") return <Text color="yellow">Loading {state.number !== null ? `PR #${state.number}` : "the current branch's PR"}{state.repo ? ` from ${state.repo}` : ""}…</Text>;
  if (state.phase === "error") return <Text color="red">Error: {state.message}</Text>;
  if (state.pager) return <PagerView pager={state.pager} state={state} />;

  return (
    <Box flexDirection="column">
      <Header state={state} />
      <Tabs state={state} />
      <List state={state} />
      {state.overlay ? <OverlayView overlay={state.overlay} /> : <Preview state={state} />}
      <Footer state={state} />
    </Box>
  );
}
