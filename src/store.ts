import { useSyncExternalStore } from "react";
import type { LogLine, PrDetails, ReviewThread, StackInfo, TimelineItem } from "./model.ts";

export type Tab = "conversation" | "threads" | "checks";

export type Toast = { text: string; kind: "info" | "warning" | "error" };

export type Overlay =
  | { kind: "reply"; threadId: string; title: string }
  | { kind: "comment"; title: string }
  | { kind: "review-type" }
  | { kind: "review-body"; event: string; required: boolean }
  | { kind: "merge-method"; methods: { label: string; flag: string }[] };

export type Pager = {
  title: string;
  lines: LogLine[];
  top: number;
  column: number;
  query: string;
  searching: boolean;
  loading: boolean;
};

export type State = {
  phase: "loading" | "error" | "ready";
  message?: string;
  repo: string | null;
  number: number | null;
  cwd: string;
  pr: PrDetails | null;
  stack: StackInfo | null;
  tab: Tab;
  selection: Record<Tab, number>;
  scroll: Record<Tab, number>;
  hideResolved: boolean;
  overlay: Overlay | null;
  pager: Pager | null;
  toast: Toast | null;
  busy: boolean;
  viewport: { columns: number; rows: number };
};

let state: State = {
  phase: "loading",
  repo: null,
  number: null,
  cwd: process.cwd(),
  pr: null,
  stack: null,
  tab: "conversation",
  selection: { conversation: 0, threads: 0, checks: 0 },
  scroll: { conversation: 0, threads: 0, checks: 0 },
  hideResolved: true,
  overlay: null,
  pager: null,
  toast: null,
  busy: false,
  viewport: { columns: 100, rows: 30 },
};

const listeners = new Set<() => void>();

export function getState(): State {
  return state;
}

export function setState(update: Partial<State>): void {
  state = { ...state, ...update };
  for (const listener of listeners) listener();
}

export function useStore(): State {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState,
    getState,
  );
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;

export function toast(text: string, kind: Toast["kind"] = "info"): void {
  const next = { text, kind };
  setState({ toast: next });
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (state.toast === next) setState({ toast: null });
  }, 6000);
}

export function conversationItems(current: State): TimelineItem[] {
  if (!current.pr) return [];
  const description: TimelineItem = { kind: "description", author: current.pr.author, body: current.pr.body, reviewState: null, createdAt: "" };
  return [description, ...current.pr.timeline];
}

export function visibleThreads(current: State): ReviewThread[] {
  if (!current.pr) return [];
  return current.hideResolved ? current.pr.threads.filter((thread) => !thread.isResolved) : current.pr.threads;
}

export function tabLength(current: State): number {
  switch (current.tab) {
    case "conversation": return conversationItems(current).length;
    case "threads": return visibleThreads(current).length;
    case "checks": return current.pr?.checks.length ?? 0;
  }
}

/** Rows split: bordered header 4, tabs 1, list, bordered preview, footer 2; one row spare so Ink never clears the screen. */
export function layout(current: State): { listRows: number; previewRows: number } {
  const available = Math.max(current.viewport.rows - 1 - 4 - 1 - 2, 6);
  const previewRows = Math.min(12, Math.max(3, Math.floor(available * 0.45) - 2));
  return { listRows: Math.max(available - previewRows - 2, 3), previewRows };
}

function clampScroll(current: State, tab: Tab, selected: number): number {
  const { listRows } = layout(current);
  let top = current.scroll[tab];
  if (selected < top) top = selected;
  if (selected >= top + listRows) top = selected - listRows + 1;
  return Math.max(0, Math.min(top, Math.max(tabLength(current) - listRows, 0)));
}

export function moveSelection(delta: number | "first" | "last"): void {
  const length = tabLength(state);
  const current = state.selection[state.tab];
  let next: number;
  if (delta === "first") next = 0;
  else if (delta === "last") next = Math.max(length - 1, 0);
  else next = Math.min(Math.max(current + delta, 0), Math.max(length - 1, 0));
  setState({
    selection: { ...state.selection, [state.tab]: next },
    scroll: { ...state.scroll, [state.tab]: clampScroll(state, state.tab, next) },
  });
}

export function setTab(tab: Tab): void {
  setState({ tab });
}

export function setViewport(columns: number, rows: number): void {
  setState({ viewport: { columns, rows } });
  moveSelection(0);
}

export function activeThread(current: State) {
  const threads = visibleThreads(current);
  return threads[current.selection.threads] ?? null;
}

export function openPager(title: string, lines: LogLine[], loading = false): void {
  setState({ pager: { title, lines, top: 0, column: 0, query: "", searching: false, loading } });
}

export function updatePager(update: Partial<Pager>): void {
  if (state.pager) setState({ pager: { ...state.pager, ...update } });
}

export function pagerRows(current: State): number {
  return Math.max(current.viewport.rows - 3, 3);
}

export function scrollPager(delta: number | "first" | "last"): void {
  const pager = state.pager;
  if (!pager) return;
  const maxTop = Math.max(pager.lines.length - pagerRows(state), 0);
  const top = delta === "first" ? 0 : delta === "last" ? maxTop : Math.min(Math.max(pager.top + delta, 0), maxTop);
  updatePager({ top });
}

export function findInPager(direction: 1 | -1, fromCurrent = false): void {
  const pager = state.pager;
  if (!pager || !pager.query) return;
  const needle = pager.query.toLowerCase();
  const count = pager.lines.length;
  const start = fromCurrent ? pager.top : pager.top + direction;
  for (let step = 0; step < count; step += 1) {
    const index = (((start + direction * step) % count) + count) % count;
    if (pager.lines[index].text.toLowerCase().includes(needle)) {
      updatePager({ top: Math.min(index, Math.max(count - pagerRows(state), 0)) });
      return;
    }
  }
  toast(`no match for "${pager.query}"`, "warning");
}
