/** @jsxImportSource react */
import { render } from "ink";
import { load, refresh } from "./actions.ts";
import { App } from "./app.tsx";
import { takeExitReason } from "./control.ts";
import { openDiffInHunk } from "./diff.ts";

async function main(): Promise<void> {
  const arg = process.argv[2];
  const number = arg && /^\d+$/.test(arg) ? parseInt(arg, 10) : null;
  await load(process.cwd(), number);

  while (true) {
    const app = render(<App />);
    await app.waitUntilExit();
    if (takeExitReason() !== "diff") break;
    await openDiffInHunk();
    void refresh();
  }
}

void main();
