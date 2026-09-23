import { spawnSync } from "node:child_process";
import { diffTarget } from "./actions.ts";
import { getState } from "./store.ts";

/** Blocking: hands the terminal to hunk to view the PR diff, returns when hunk exits. */
export async function openDiffInHunk(): Promise<void> {
  const target = await diffTarget();
  const { cwd, repo, number } = getState();
  if (target.mode === "merge-base") {
    spawnSync("hunk", ["diff", target.ref], { cwd, stdio: "inherit" });
    return;
  }
  spawnSync("sh", ["-c", `gh pr diff ${number} -R ${repo} | hunk patch -`], { cwd, stdio: "inherit" });
}
