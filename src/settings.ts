import type { PrReviewSettings } from "./types";

export const DEFAULT_SETTINGS: PrReviewSettings = {
  githubToken: "",
  githubHost: "https://api.github.com",
  defaultOwner: "",
  defaultRepo: "",
  defaultBaseBranch: "main",
  preferObsidianGit: true,
  useLocalGitFallback: true,
  debugLogging: false,
  docsFileGlobs: "**/*.md, **/*.mdx, docs/**"
};

export function normalizeSettings(data: Partial<PrReviewSettings> | null | undefined): PrReviewSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...(data ?? {}),
    githubHost: (data?.githubHost || DEFAULT_SETTINGS.githubHost).replace(/\/+$/, ""),
    defaultBaseBranch: data?.defaultBaseBranch || DEFAULT_SETTINGS.defaultBaseBranch,
    docsFileGlobs: data?.docsFileGlobs || DEFAULT_SETTINGS.docsFileGlobs
  };
}

export function maskToken(token: string): string {
  if (!token) return "";
  if (token.length <= 8) return "********";
  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}
