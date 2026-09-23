/** @jsxImportSource react */
import { Box, Text, useApp, useInput } from "ink";
import SelectInput from "ink-select-input";
import TextInput from "ink-text-input";
import { useState } from "react";
import * as actions from "./actions.ts";
import { requestExit } from "./control.ts";
import {
  formatDecision,
  summarizeChecks,
  type Check,
  type PrDetails,
  type ReviewThread,
  type TimelineItem,
} from "./model.ts";
import {
  activeThread,
  moveSelection,
  setState,
  setTab,
  toast,
  useStore,
  visibleThreads,
  type Overlay,
  type State,
} from "./store.ts";

function checkIcon(check: Check): { icon: string; color: string } {
  if (check.status !== "COMPLETED") return { icon: "●", color: "yellow" };
  switch (check.conclusion) {
    case "SUCCESS": return { icon: "✓", color: "green" };
    case "NEUTRAL": case "SKIPPED": return { icon: "·", color: "gray" };
    default: return { icon: "✗", color: "red" };
  }
}

function Header({ state }: { state: State }) {
  const pr = state.pr!;
  const stackPosition = state.stack
    ? `  ◂ ${state.stack.entries.findIndex((entry) => entry.isCurrent) + 1}/${state.stack.entries.length} ▸`
    : "";
  const decisionColor = pr.reviewDecision === "APPROVED" ? "green" : pr.reviewDecision === "CHANGES_REQUESTED" ? "red" : "yellow";
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Box>
        <Text bold color="cyan">#{pr.number} </Text>
        <Text bold>{pr.title}</Text>
        {pr.isDraft ? <Text color="gray"> [draft]</Text> : null}
      </Box>
      <Box>
        <Text color="gray">@{pr.author}  {pr.headRefName} → {pr.baseRefName}  </Text>
        <Text color={decisionColor}>{formatDecision(pr.reviewDecision)}</Text>
        <Text color="gray">  ·  </Text>
        <Text>{summarizeChecks(pr)}</Text>
        <Text color="magenta">{stackPosition}</Text>
      </Box>
    </Box>
  );
}

function Tabs({ state }: { state: State }) {
  const threads = visibleThreads(state).length;
  const items: { id: State["tab"]; label: string }[] = [
    { id: "conversation", label: `Conversation ${state.pr!.timeline.length}` },
    { id: "threads", label: `Threads ${threads}` },
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

function Row({ selected, children }: { selected: boolean; children: React.ReactNode }) {
  return (
    <Box>
      <Text color="cyan">{selected ? "› " : "  "}</Text>
      <Box flexDirection="column">{children}</Box>
    </Box>
  );
}

function TimelineRow({ item }: { item: TimelineItem }) {
  switch (item.kind) {
    case "comment":
      return <Text><Text color="cyan">@{item.author}</Text> commented: <Text color="gray">{(item.body ?? "").split("\n")[0].slice(0, 80)}</Text></Text>;
    case "review": {
      const color = item.reviewState === "APPROVED" ? "green" : item.reviewState === "CHANGES_REQUESTED" ? "red" : "yellow";
      const verb = item.reviewState === "APPROVED" ? "approved" : item.reviewState === "CHANGES_REQUESTED" ? "requested changes" : "reviewed";
      return <Text><Text color="cyan">@{item.author}</Text> <Text color={color}>{verb}</Text> <Text color="gray">{(item.body ?? "").split("\n")[0].slice(0, 60)}</Text></Text>;
    }
    case "force-push":
      return <Text><Text color="cyan">@{item.author}</Text> <Text color="red">force-pushed</Text></Text>;
    case "commit":
      return <Text color="gray">◦ {item.author} {(item.body ?? "").slice(0, 80)}</Text>;
    case "merged":
      return <Text><Text color="cyan">@{item.author}</Text> <Text color="magenta">merged</Text></Text>;
    case "review-requested":
      return <Text color="gray"><Text color="cyan">@{item.author}</Text> requested review from @{item.body}</Text>;
  }
}

function ThreadRow({ thread }: { thread: ReviewThread }) {
  const badges = [thread.isResolved ? "resolved" : null, thread.isOutdated ? "outdated" : null].filter(Boolean).join(", ");
  return (
    <>
      <Text>
        <Text color={thread.isResolved ? "gray" : "white"}>{thread.path}:{thread.line ?? "outdated"}</Text>
        {badges ? <Text color="gray"> [{badges}]</Text> : null}
      </Text>
      {thread.comments.slice(0, 3).map((comment, index) => (
        <Text key={index} color="gray">  {index === 0 ? "" : "↳ "}<Text color="cyan">@{comment.author}</Text> {comment.body.split("\n")[0].slice(0, 70)}</Text>
      ))}
    </>
  );
}

function CheckRow({ check }: { check: Check }) {
  const { icon, color } = checkIcon(check);
  return (
    <Text>
      <Text color={color}>{icon} </Text>
      {check.name}
      {check.workflow ? <Text color="gray"> ({check.workflow})</Text> : null}
    </Text>
  );
}

function Body({ state }: { state: State }) {
  const selection = state.selection[state.tab];
  if (state.tab === "conversation") {
    const items = state.pr!.timeline;
    if (items.length === 0) return <Text color="gray">  No conversation yet</Text>;
    return <>{items.map((item, index) => <Row key={index} selected={index === selection}><TimelineRow item={item} /></Row>)}</>;
  }
  if (state.tab === "threads") {
    const threads = visibleThreads(state);
    if (threads.length === 0) return <Text color="gray">  No review threads{state.hideResolved ? " (h to show resolved)" : ""}</Text>;
    return <>{threads.map((thread, index) => <Row key={thread.id} selected={index === selection}><ThreadRow thread={thread} /></Row>)}</>;
  }
  const checks = state.pr!.checks;
  if (checks.length === 0) return <Text color="gray">  No checks reported</Text>;
  return <>{checks.map((check, index) => <Row key={index} selected={index === selection}><CheckRow check={check} /></Row>)}</>;
}

function Footer({ state }: { state: State }) {
  const keys = state.tab === "threads"
    ? "r reply · x resolve · h resolved"
    : state.tab === "checks"
      ? "enter log · u rerun"
      : "c comment";
  return (
    <Box flexDirection="column">
      <Box>
        <Text color="gray">tab switch · j/k move · {keys} · a review · m merge · d diff · R refresh · q quit</Text>
      </Box>
      {state.toast ? (
        <Text color={state.toast.kind === "error" ? "red" : state.toast.kind === "warning" ? "yellow" : "green"}>{state.toast.text}</Text>
      ) : null}
      {state.busy ? <Text color="yellow">working…</Text> : null}
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
        <Text color="cyan">Review type</Text>
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
  if (overlay.kind === "merge-method") {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text color="cyan">Merge method</Text>
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
  if (overlay.kind === "log") {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text color="cyan">{overlay.checkName} — failed log tail (esc closes)</Text>
        {overlay.lines.slice(-30).map((line, index) => <Text key={index} color="gray">{line.slice(0, 120)}</Text>)}
      </Box>
    );
  }
  return null;
}

export function App() {
  const state = useStore();
  const { exit } = useApp();

  useInput((input, key) => {
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

    if (state.tab === "threads") {
      const thread = activeThread(state);
      if (input === "r") {
        if (!thread) { toast("no thread selected", "warning"); return; }
        setState({ overlay: { kind: "reply", threadId: thread.id, title: `Reply to @${thread.comments[0]?.author} (${thread.path}:${thread.line ?? "?"})` } });
      } else if (input === "x") {
        void actions.toggleResolve();
      } else if (input === "h") {
        setState({ hideResolved: !state.hideResolved, selection: { ...state.selection, threads: 0 } });
      }
    } else if (state.tab === "conversation") {
      if (input === "c") setState({ overlay: { kind: "comment", title: `Comment on PR #${state.number}` } });
    } else if (state.tab === "checks") {
      if (input === "u") { void actions.rerun(); }
      else if (key.return) {
        const check = state.pr!.checks[state.selection.checks];
        if (check?.runId != null) {
          const runId = check.runId;
          setState({ overlay: { kind: "log", checkName: check.name, lines: ["loading…"] } });
          void actions.fetchLog(runId).then((lines) => setState({ overlay: { kind: "log", checkName: check.name, lines } }));
        } else {
          toast("no workflow run log for this check", "warning");
        }
      }
    }
  });

  if (state.phase === "loading") return <Text color="yellow">Loading PR…</Text>;
  if (state.phase === "error") return <Text color="red">Error: {state.message}</Text>;

  return (
    <Box flexDirection="column">
      <Header state={state} />
      <Tabs state={state} />
      <Box flexDirection="column" marginY={1}>
        <Body state={state} />
      </Box>
      {state.overlay ? <OverlayView overlay={state.overlay} /> : <Footer state={state} />}
    </Box>
  );
}
