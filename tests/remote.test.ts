import { describe, expect, it } from "vitest";
import { parseGitHubRemote } from "../src/remote";

describe("parseGitHubRemote", () => {
  it("extracts owner/repo from HTTPS remotes", () => {
    expect(parseGitHubRemote("https://github.com/ron-ulitsky/docs.git")).toEqual({
      owner: "ron-ulitsky",
      repo: "docs"
    });
  });

  it("extracts owner/repo from SSH remotes", () => {
    expect(parseGitHubRemote("git@github.com:ron-ulitsky/docs.git")).toEqual({
      owner: "ron-ulitsky",
      repo: "docs"
    });
  });

  it("extracts owner/repo from ssh:// remotes", () => {
    expect(parseGitHubRemote("ssh://git@github.com/ron-ulitsky/docs.git")).toEqual({
      owner: "ron-ulitsky",
      repo: "docs"
    });
  });
});
