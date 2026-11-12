import { describe, expect, test } from "bun:test";
import { renderMarkdown, summary } from "../src/markdown.ts";

const texts = (body: string, width = 40) => renderMarkdown(body, width).map((line) => line.text);

describe("markdown", () => {
  test("summary skips HTML comments, markers and fences", () => {
    expect(summary("<!-- coderabbit -->\n\n## **Fix** the `clamp`")).toBe("Fix the clamp");
    expect(summary("```ts\nx\n```\n- [see](http://x) this")).toBe("x");
    expect(summary("<!-- only a marker -->")).toBe("");
  });

  test("renders headings, bullets, checkboxes and quotes without their markup", () => {
    expect(texts("# Title\n- one\n- [x] done\n> quoted")).toEqual(["Title", "• one", "☑ done", "▎ quoted"]);
  });

  test("wraps under the bullet, not under its marker", () => {
    expect(texts("- alpha beta gamma delta epsilon", 20)).toEqual(["• alpha beta gamma", "  delta epsilon"]);
  });

  test("a suggestion block reads as the added lines", () => {
    expect(texts("Try:\n```suggestion\nconst x = 1;\n```")).toEqual(["Try:", "suggested change", "+ const x = 1;"]);
  });

  test("styles inline code and links, keeping only link text", () => {
    const [line] = renderMarkdown("use `x` per [docs](https://d)", 80);
    expect(line.text).toBe("use x per docs");
    expect(line.segments.find((segment) => segment.text === "x")?.color).toBe("yellow");
    expect(line.segments.find((segment) => segment.text === "docs")?.color).toBe("blue");
  });

  test("every line carries the gutter", () => {
    const lines = renderMarkdown("one\n\ntwo", 80, [{ text: "│ " }]);
    expect(lines.map((line) => line.text)).toEqual(["│ one", "│ ", "│ two"]);
  });
});
