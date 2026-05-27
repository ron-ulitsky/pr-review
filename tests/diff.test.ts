import { describe, expect, it } from "vitest";
import { composeCommentBody, matchesDocsGlobs, parsePatch, toReviewCommentPayload } from "../src/diff";

const patch = `@@ -1,4 +1,5 @@
 # Title
-old line
+new line
 context
+added
 tail`;

describe("parsePatch", () => {
  it("tracks hunk lines and GitHub positions", () => {
    const [hunk] = parsePatch(patch);
    expect(hunk.oldStart).toBe(1);
    expect(hunk.newStart).toBe(1);
    expect(hunk.lines.map((line) => [line.type, line.oldLine, line.newLine, line.position])).toEqual([
      ["context", 1, 1, 1],
      ["removed", 2, undefined, 2],
      ["added", undefined, 2, 3],
      ["context", 3, 3, 4],
      ["added", undefined, 4, 5],
      ["context", 4, 5, 6]
    ]);
  });

  it("maps added and context lines to modern review comment payloads", () => {
    const [hunk] = parsePatch(patch);
    expect(toReviewCommentPayload("docs/a.md", hunk.lines[2], "Looks good")).toEqual({
      path: "docs/a.md",
      line: 2,
      side: "RIGHT",
      body: "Looks good"
    });
    expect(() => toReviewCommentPayload("docs/a.md", hunk.lines[1], "Nope")).toThrow();
  });

  it("wraps suggestions while preserving normal comments", () => {
    expect(composeCommentBody("Before", "replacement text", "After")).toBe("Before\n\n```suggestion\nreplacement text\n```\n\nAfter");
  });

  it("matches default Markdown docs globs", () => {
    expect(matchesDocsGlobs("README.md", "**/*.md, **/*.mdx, docs/**")).toBe(true);
    expect(matchesDocsGlobs("guide/page.mdx", "**/*.md, **/*.mdx, docs/**")).toBe(true);
    expect(matchesDocsGlobs("docs/api/file.txt", "**/*.md, **/*.mdx, docs/**")).toBe(true);
    expect(matchesDocsGlobs("src/index.ts", "**/*.md, **/*.mdx, docs/**")).toBe(false);
  });
});
