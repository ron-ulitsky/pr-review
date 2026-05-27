export type DiffLineType = "added" | "removed" | "context";

export interface DiffLine {
  type: DiffLineType;
  content: string;
  oldLine?: number;
  newLine?: number;
  position: number;
  canComment: boolean;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export function parsePatch(patch = ""): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  let current: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  let position = 0;

  for (const rawLine of patch.split("\n")) {
    const hunkMatch = rawLine.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hunkMatch) {
      current = {
        header: rawLine,
        oldStart: Number(hunkMatch[1]),
        oldLines: Number(hunkMatch[2] ?? "1"),
        newStart: Number(hunkMatch[3]),
        newLines: Number(hunkMatch[4] ?? "1"),
        lines: []
      };
      hunks.push(current);
      oldLine = current.oldStart;
      newLine = current.newStart;
      position = 0;
      continue;
    }

    if (!current || rawLine === "\\ No newline at end of file") continue;
    position += 1;

    const marker = rawLine[0];
    const content = rawLine.slice(1);
    if (marker === "+") {
      current.lines.push({ type: "added", content, newLine, position, canComment: true });
      newLine += 1;
    } else if (marker === "-") {
      current.lines.push({ type: "removed", content, oldLine, position, canComment: false });
      oldLine += 1;
    } else {
      const text = marker === " " ? content : rawLine;
      current.lines.push({ type: "context", content: text, oldLine, newLine, position, canComment: true });
      oldLine += 1;
      newLine += 1;
    }
  }

  return hunks;
}

export function toReviewCommentPayload(path: string, line: DiffLine, body: string) {
  if (!line.canComment || line.newLine === undefined) {
    throw new Error("This diff line cannot be mapped to a GitHub review comment.");
  }
  return {
    path,
    line: line.newLine,
    side: "RIGHT" as const,
    body
  };
}

export function composeCommentBody(normalComment: string, suggestion: string, followupComment: string): string {
  const parts = [normalComment.trim()];
  if (suggestion.trim()) {
    parts.push(`\`\`\`suggestion\n${suggestion.trimEnd()}\n\`\`\``);
  }
  parts.push(followupComment.trim());
  return parts.filter(Boolean).join("\n\n");
}

export function matchesDocsGlobs(path: string, globsCsv: string): boolean {
  const patterns = globsCsv.split(",").map((item) => item.trim()).filter(Boolean);
  if (patterns.length === 0) return true;
  return patterns.some((pattern) => {
    if (pattern === "**/*.md") return path.toLowerCase().endsWith(".md");
    if (pattern === "**/*.mdx") return path.toLowerCase().endsWith(".mdx");
    if (pattern.endsWith("/**")) return path.startsWith(pattern.slice(0, -3));
    if (pattern.includes("*")) {
      const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*");
      return new RegExp(`^${escaped}$`).test(path);
    }
    return path === pattern || path.startsWith(`${pattern}/`);
  });
}
