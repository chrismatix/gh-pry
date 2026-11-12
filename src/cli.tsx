/** @jsxImportSource react */
import { render } from "ink";
import { load, refresh } from "./actions.ts";
import { App } from "./app.tsx";
import { takeExitReason } from "./control.ts";
import { openDiffInHunk } from "./diff.ts";
import { setViewport } from "./store.ts";

async function main(): Promise<void> {
  if (!process.stdin.isTTY) {
    console.error("gh pry needs an interactive terminal (stdin is not a TTY).");
    process.exit(1);
  }
  const args = process.argv.slice(2);
  const repoFlag = args.findIndex((arg) => arg === "-R" || arg === "--repo");
  const repo = repoFlag >= 0 ? args.splice(repoFlag, 2)[1] ?? null : null;
  const arg = args[0];
  const number = arg && /^\d+$/.test(arg) ? parseInt(arg, 10) : null;
  const syncViewport = () => setViewport(process.stdout.columns || 100, process.stdout.rows || 30);
  syncViewport();
  process.stdout.on("resize", syncViewport);
  // Mount first so the loading line is on screen while gh is still talking.
  void load(process.cwd(), number, repo);

  while (true) {
    syncViewport();
    const app = render(<App />);
    await app.waitUntilExit();
    if (takeExitReason() !== "diff") break;
    await openDiffInHunk();
    void refresh();
  }
}

void main();
