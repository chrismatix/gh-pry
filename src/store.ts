import { useSyncExternalStore } from "react";
import type { PrDetails, ReviewThread, StackInfo } from "./model.ts";

export type Tab = "conversation" | "threads" | "checks";

export type Toast = { text: string; kind: "info" | "warning" | "error" };

export type Overlay =
  | { kind: "reply"; threadId: string; title: string }
  | { kind: "comment"; title: string }
  | { kind: "review-type" }
  | { kind: "review-body"; event: string; required: boolean }
  | { kind: "merge-method"; methods: { label: string; flag: string }[] }
  | { kind: "confirm-merge"; body: string }
  | { kind: "log"; checkName: string; lines: string[] };

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
  hideResolved: boolean;
  overlay: Overlay | null;
  toast: Toast | null;
  busy: boolean;
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
  hideResolved: true,
  overlay: null,
  toast: null,
  busy: false,
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

export function toast(text: string, kind: Toast["kind"] = "info"): void {
  setState({ toast: { text, kind } });
}

export function visibleThreads(current: State): ReviewThread[] {
  if (!current.pr) return [];
  return current.hideResolved ? current.pr.threads.filter((thread) => !thread.isResolved) : current.pr.threads;
}

export function tabLength(current: State): number {
  switch (current.tab) {
    case "conversation": return current.pr?.timeline.length ?? 0;
    case "threads": return visibleThreads(current).length;
    case "checks": return current.pr?.checks.length ?? 0;
  }
}

export function moveSelection(delta: number | "first" | "last"): void {
  const length = tabLength(state);
  const current = state.selection[state.tab];
  let next: number;
  if (delta === "first") next = 0;
  else if (delta === "last") next = Math.max(length - 1, 0);
  else next = Math.min(Math.max(current + delta, 0), Math.max(length - 1, 0));
  setState({ selection: { ...state.selection, [state.tab]: next } });
}

export function setTab(tab: Tab): void {
  setState({ tab });
}

export function activeThread(current: State) {
  const threads = visibleThreads(current);
  return threads[current.selection.threads] ?? null;
}
