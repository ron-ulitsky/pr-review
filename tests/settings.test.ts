import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, maskToken, normalizeSettings } from "../src/settings";

describe("settings", () => {
  it("fills defaults and normalizes GitHub host", () => {
    expect(normalizeSettings({ githubHost: "https://api.github.com/" })).toEqual({
      ...DEFAULT_SETTINGS,
      githubHost: "https://api.github.com"
    });
  });

  it("masks tokens for display", () => {
    expect(maskToken("github_pat_1234567890")).toBe("gith...7890");
    expect(maskToken("short")).toBe("********");
  });
});
