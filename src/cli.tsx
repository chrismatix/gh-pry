/** @jsxImportSource react */
import { render } from "ink";
import { load, refresh } from "./actions.ts";
import { App } from "./app.tsx";
import { takeExitReason } from "./control.ts";
import { openDiffInHunk } from "./diff.ts";
import { setViewport } from "./store.ts";

async function main(): Promise<void> {
  const arg = process.argv[2];
  const number = arg && /^\d+$/.test(arg) ? parseInt(arg, 10) : null;
  const syncViewport = () => setViewport(process.stdout.columns || 100, process.stdout.rows || 30);
  syncViewport();
  process.stdout.on("resize", syncViewport);
  await load(process.cwd(), number);

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
