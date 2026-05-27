export type ReviewEvent = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";

export interface PrReviewSettings {
  githubToken: string;
  githubHost: string;
  defaultOwner: string;
  defaultRepo: string;
  defaultBaseBranch: string;
  preferObsidianGit: boolean;
  useLocalGitFallback: boolean;
  docsFileGlobs: string;
}

export interface PullRequestSummary {
  number: number;
  title: string;
  user: { login: string };
  html_url: string;
  head: { ref: string; repo: { full_name: string } | null; sha: string };
  base: { ref: string; repo: { full_name: string } | null };
  updated_at: string;
  labels?: Array<{ name: string; color?: string }>;
  changed_files?: number;
  reviewState?: string;
}

export interface PullRequestFile {
  sha: string;
  filename: string;
  status: "added" | "removed" | "modified" | "renamed" | "changed" | string;
  additions: number;
  deletions: number;
  changes: number;
  blob_url: string;
  raw_url: string;
  contents_url: string;
  patch?: string;
  previous_filename?: string;
}

export interface FilePullRequestMatch {
  pr: PullRequestSummary;
  file: PullRequestFile;
}

export interface ReviewComment {
  id: number;
  user: { login: string };
  body: string;
  path: string;
  line?: number | null;
  original_line?: number | null;
  position?: number | null;
  original_position?: number | null;
  html_url?: string;
  outdated?: boolean;
}

export interface PendingReviewComment {
  id: string;
  path: string;
  line: number;
  side: "RIGHT";
  body: string;
  normalComment: string;
  suggestion: string;
  followupComment: string;
  diffPosition?: number;
  createdAt: string;
}

export interface ReviewDraft {
  owner: string;
  repo: string;
  prNumber: number;
  pendingComments: PendingReviewComment[];
  selectedFiles: string[];
  reviewBody: string;
  lastFetchedPr?: PullRequestSummary;
}

export interface GitActionResult {
  ok: boolean;
  message: string;
}

export interface GitAdapter {
  name: string;
  isAvailable(): Promise<boolean>;
  getCurrentBranch(): Promise<GitActionResult & { branch?: string }>;
  checkoutBranch(branchName: string): Promise<GitActionResult>;
  fetch(refspec?: string): Promise<GitActionResult>;
  pull(): Promise<GitActionResult>;
  push(): Promise<GitActionResult>;
  createBranch(branchName: string, fromRef?: string): Promise<GitActionResult>;
  getRepoRoot(): Promise<GitActionResult & { repoRoot?: string }>;
  getRemoteUrl(): Promise<GitActionResult & { remoteUrl?: string }>;
  openSourceControlView?(): Promise<GitActionResult>;
}
