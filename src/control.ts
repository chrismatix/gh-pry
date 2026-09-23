export type ExitReason = "quit" | "diff";

let exitReason: ExitReason | null = null;

export function requestExit(reason: ExitReason): void {
  exitReason = reason;
}

export function takeExitReason(): ExitReason | null {
  const reason = exitReason;
  exitReason = null;
  return reason;
}
