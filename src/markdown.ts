import type { LogLine, LogSegment } from "./model.ts";

/** Drops what GitHub hides when it renders a comment: HTML comments, and tags around text. */
export function cleanBody(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    // Badge images (CodeRabbit's severity) carry no alt text and say nothing in a terminal.
    .replace(/<img\b[^>]*?(?:alt="([^"]*)")?[^>]*>/gi, (_match, alt: string | undefined) => (alt ? `[image: ${alt}]` : ""))
    .replace(/!\[\]\([^)\s]*\)/g, "")
    .replace(/<\/?[a-z][a-z0-9]*\b[^>]*>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// CodeRabbit opens every finding with a line like "**Major** · **Security** · **Quick win**".
const BADGE = /^\W*(Critical|Major|Minor|Trivial|Nitpick)\b[^\n]*·/i;

const SEVERITY_COLORS: Record<string, string> = { critical: "red", major: "yellow", minor: "blue" };

export function severity(text: string | null): { label: string; color: string } | null {
  const first = cleanBody(text ?? "").split("\n").find((line) => line.trim());
  const match = first?.match(BADGE);
  return match ? { label: match[1].toLowerCase(), color: SEVERITY_COLORS[match[1].toLowerCase()] ?? "gray" } : null;
}

/** One line that says what a comment is about, for list rows; headings only when nothing else is there. */
export function summary(text: string | null): string {
  let heading = "";
  for (const raw of cleanBody(text ?? "").split("\n")) {
    if (/^\s*(```|\|?\s*:?-{3,})/.test(raw) || BADGE.test(raw) || /^\s*>\s*\[!\w+\]\s*$/.test(raw)) continue;
    const plain = raw
      .replace(/^\s*(#{1,6}|>|[-*+]|\d+[.)])\s+/, "")
      .replace(/^\[[ xX]\]\s+/, "")
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\*\*|__|`/g, "")
      .replace(/\\([\\`*_{}[\]()#+\-.!|>])/g, "$1")
      .trim();
    if (!plain) continue;
    if (!/^\s*#{1,6}\s/.test(raw)) return plain;
    heading ||= plain;
  }
  return heading;
}

const INLINE = /(`[^`]+`)|(\*\*[^*]+\*\*)|(!?\[[^\]]*\]\([^)\s]+\))|(https?:\/\/[^\s)]+)/g;

function inline(text: string, base: Omit<LogSegment, "text"> = {}): LogSegment[] {
  const out: LogSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    if (match.index > last) out.push({ ...base, text: text.slice(last, match.index) });
    const [token, code, bold, link] = match;
    if (code) out.push({ ...base, text: code.slice(1, -1), color: "yellow" });
    else if (bold) out.push({ ...base, text: bold.slice(2, -2), bold: true });
    else if (link?.startsWith("!")) out.push({ ...base, text: `[image${link.slice(2, link.indexOf("]")) ? `: ${link.slice(2, link.indexOf("]"))}` : ""}]`, dim: true });
    else if (link) out.push({ ...base, text: link.slice(1, link.indexOf("]")), color: "blue" });
    else out.push({ ...base, text: token, color: "blue" });
    last = match.index + token.length;
  }
  if (last < text.length) out.push({ ...base, text: text.slice(last) });
  return out;
}

function toLine(segments: LogSegment[]): LogLine {
  return { text: segments.map((segment) => segment.text).join(""), segments, kind: "text" };
}

const width = (segments: LogSegment[]) => segments.reduce((sum, segment) => sum + segment.text.length, 0);

/** Word-wraps styled text; continuation lines get `rest` instead of `first`. */
function wrap(segments: LogSegment[], max: number, first: LogSegment[], rest: LogSegment[]): LogLine[] {
  const lines: LogLine[] = [];
  let current = [...first];
  let empty = true;
  for (const segment of segments) {
    for (const word of segment.text.split(/(\s+)/)) {
      if (!word) continue;
      const isSpace = /^\s+$/.test(word);
      if (isSpace && empty) continue;
      if (!isSpace && !empty && width(current) + word.length > max) {
        while (current.length && /^\s+$/.test(current[current.length - 1].text)) current.pop();
        lines.push(toLine(current));
        current = [...rest];
        empty = true;
      }
      current.push({ ...segment, text: isSpace ? " " : word });
      empty = false;
    }
  }
  if (!empty) lines.push(toLine(current));
  return lines;
}

function diffColor(line: string): string {
  if (/^(\+\+\+|---|@@)/.test(line)) return "cyan";
  return line.startsWith("+") ? "green" : line.startsWith("-") ? "red" : "gray";
}

/** Renders a comment body as styled lines, each starting with `gutter`. */
export function renderMarkdown(body: string, max: number, gutter: LogSegment[] = []): LogLine[] {
  const text = cleanBody(body);
  if (!text) return [toLine([...gutter, { text: "(empty)", dim: true }])];
  const room = Math.max(max - width(gutter), 20);
  const lines: LogLine[] = [];
  const blank = () => {
    if (lines.length && lines[lines.length - 1].text.trim() !== "") lines.push(toLine([...gutter]));
  };
  let fence: string | null = null;
  for (const raw of text.split("\n")) {
    const fenceMatch = raw.match(/^\s*```(\S*)/);
    if (fenceMatch) {
      fence = fence === null ? fenceMatch[1] : null;
      if (fence === "suggestion") lines.push(toLine([...gutter, { text: "suggested change", color: "green", bold: true }]));
      continue;
    }
    if (fence !== null) {
      lines.push(toLine(fence === "suggestion"
        ? [...gutter, { text: "+ ", color: "green" }, { text: raw, color: "green" }]
        : [...gutter, { text: "  " }, { text: raw, color: fence === "diff" ? diffColor(raw) : "yellow" }]));
      continue;
    }
    if (!raw.trim()) { blank(); continue; }

    const heading = raw.match(/^#{1,6}\s+(.*)/);
    const quote = raw.match(/^\s*>\s?(.*)/);
    const alert = quote?.[1].match(/^\[!(\w+)\]\s*$/);
    const item = raw.match(/^(\s*)([-*+]|\d+[.)])\s+(?:\[([ xX])\]\s+)?(.*)/);
    if (heading) {
      blank();
      lines.push(...wrap(inline(heading[1], { bold: true, color: "cyan" }), room, gutter, gutter));
    } else if (alert) {
      lines.push(toLine([...gutter, { text: "▎ ", color: "magenta" }, { text: alert[1].toLowerCase(), color: "magenta", bold: true }]));
    } else if (quote) {
      const bar = [...gutter, { text: "▎ ", dim: true }];
      lines.push(...wrap(inline(quote[1], { dim: true }), room, bar, bar));
    } else if (item) {
      const indent = " ".repeat(Math.floor(item[1].length / 2) * 2);
      const marker = item[3] !== undefined ? (item[3] === " " ? "☐ " : "☑ ") : /\d/.test(item[2]) ? `${item[2]} ` : "• ";
      lines.push(...wrap(inline(item[4]), room, [...gutter, { text: indent }, { text: marker, color: "cyan" }], [...gutter, { text: indent + " ".repeat(marker.length) }]));
    } else if (/^\s*\|/.test(raw)) {
      if (/^\s*\|?\s*:?-{3,}/.test(raw)) continue;
      const cells = raw.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
      lines.push(toLine([...gutter, ...cells.flatMap((cell, index) => [...(index ? [{ text: "  │  ", dim: true }] : []), ...inline(cell)])]));
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(raw)) {
      lines.push(toLine([...gutter, { text: "─".repeat(Math.min(room, 40)), dim: true }]));
    } else {
      lines.push(...wrap(inline(raw), room, gutter, gutter));
    }
  }
  while (lines.length > 1 && lines[lines.length - 1].text.trim() === "") lines.pop();
  return lines;
}
