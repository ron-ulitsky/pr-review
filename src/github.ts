import { Notice, requestUrl } from "obsidian";
import type { PendingReviewComment, PullRequestFile, PullRequestSummary, ReviewComment, ReviewEvent } from "./types";

export class GitHubClient {
  constructor(private readonly host: string, private readonly token: string) {}

  async request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    if (!this.token) {
      throw new Error("Configure a GitHub token before calling the GitHub API.");
    }

    const url = `${this.host.replace(/\/+$/, "")}${path}`;
    const response = await requestUrl({
      url,
      method: init.method ?? "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json"
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
      throw: false
    });

    if (response.status < 200 || response.status >= 300) {
      const message = typeof response.json?.message === "string" ? response.json.message : response.text;
      throw new Error(`GitHub API ${response.status}: ${message}`);
    }

    return response.json as T;
  }
}

export class PullRequestService {
  constructor(private readonly client: GitHubClient) {}

  async listPullRequests(owner: string, repo: string, base: string): Promise<PullRequestSummary[]> {
    const prs = await this.client.request<PullRequestSummary[]>(
      `/repos/${owner}/${repo}/pulls?state=open&base=${encodeURIComponent(base)}&per_page=50&sort=updated&direction=desc`
    );
    const withReviewState = await Promise.all(prs.map(async (pr) => ({
      ...pr,
      reviewState: await this.getLatestReviewState(owner, repo, pr.number).catch(() => "unknown")
    })));
    return withReviewState;
  }

  async getPullRequest(owner: string, repo: string, number: number): Promise<PullRequestSummary> {
    return this.client.request<PullRequestSummary>(`/repos/${owner}/${repo}/pulls/${number}`);
  }

  async listFiles(owner: string, repo: string, number: number): Promise<PullRequestFile[]> {
    return this.client.request<PullRequestFile[]>(`/repos/${owner}/${repo}/pulls/${number}/files?per_page=100`);
  }

  async listReviewComments(owner: string, repo: string, number: number): Promise<ReviewComment[]> {
    return this.client.request<ReviewComment[]>(`/repos/${owner}/${repo}/pulls/${number}/comments?per_page=100`);
  }

  async submitReview(
    owner: string,
    repo: string,
    number: number,
    event: ReviewEvent,
    body: string,
    comments: PendingReviewComment[]
  ): Promise<void> {
    await this.client.request(`/repos/${owner}/${repo}/pulls/${number}/reviews`, {
      method: "POST",
      body: {
        event,
        body,
        comments: comments.map((comment) => ({
          path: comment.path,
          line: comment.line,
          side: comment.side,
          body: comment.body
        }))
      }
    });
  }

  private async getLatestReviewState(owner: string, repo: string, number: number): Promise<string> {
    const reviews = await this.client.request<Array<{ state: string }>>(
      `/repos/${owner}/${repo}/pulls/${number}/reviews?per_page=30`
    );
    return reviews[reviews.length - 1]?.state ?? "none";
  }
}

export function showGitHubError(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  new Notice(message.replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer ***"));
}
