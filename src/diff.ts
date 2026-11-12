import { spawnSync } from "node:child_process";
import { writeSync } from "node:fs";
import { diffTarget } from "./actions.ts";
import { getState } from "./store.ts";

async function diffCommand(): Promise<string> {
  const target = await diffTarget();
  const { repo, number } = getState();
  if (target.mode === "merge-base") return `hunk diff ${target.ref}`;
  return `gh pr diff ${number} -R ${repo} | hunk patch -`;
}

/** Blocking: hands the terminal to hunk to view the PR diff, returns when hunk exits. */
export async function openDiffInHunk(): Promise<void> {
  spawnSync("sh", ["-c", await diffCommand()], { cwd: getState().cwd, stdio: "inherit" });
}

/** Embedded in a host like gh-dash, which runs the command full-screen instead of in our small pane. */
export const hostDiffFd = process.env.GH_PRY_DIFF_FD ? parseInt(process.env.GH_PRY_DIFF_FD, 10) : null;

export async function sendDiffToHost(fd: number): Promise<void> {
  writeSync(fd, `${await diffCommand()}\n`);
}
