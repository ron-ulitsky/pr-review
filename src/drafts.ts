import type { Plugin } from "obsidian";
import type { PendingReviewComment, PullRequestSummary, ReviewDraft } from "./types";

type DraftData = {
  settings?: unknown;
  drafts?: Record<string, ReviewDraft>;
};

export class ReviewDraftStore {
  constructor(private readonly plugin: Plugin) {}

  async load(owner: string, repo: string, prNumber: number): Promise<ReviewDraft> {
    const data = ((await this.plugin.loadData()) ?? {}) as DraftData;
    const key = this.key(owner, repo, prNumber);
    return data.drafts?.[key] ?? {
      owner,
      repo,
      prNumber,
      pendingComments: [],
      selectedFiles: [],
      reviewBody: "",
      lastFetchedPr: undefined
    };
  }

  async save(draft: ReviewDraft): Promise<void> {
    const data = ((await this.plugin.loadData()) ?? {}) as DraftData;
    data.drafts = data.drafts ?? {};
    data.drafts[this.key(draft.owner, draft.repo, draft.prNumber)] = draft;
    await this.plugin.saveData(data);
  }

  async setMetadata(owner: string, repo: string, prNumber: number, pr: PullRequestSummary): Promise<ReviewDraft> {
    const draft = await this.load(owner, repo, prNumber);
    draft.lastFetchedPr = pr;
    await this.save(draft);
    return draft;
  }

  async addPending(owner: string, repo: string, prNumber: number, comment: PendingReviewComment): Promise<ReviewDraft> {
    const draft = await this.load(owner, repo, prNumber);
    draft.pendingComments.push(comment);
    await this.save(draft);
    return draft;
  }

  async clearPending(owner: string, repo: string, prNumber: number): Promise<ReviewDraft> {
    const draft = await this.load(owner, repo, prNumber);
    draft.pendingComments = [];
    await this.save(draft);
    return draft;
  }

  async removePending(owner: string, repo: string, prNumber: number, id: string): Promise<ReviewDraft> {
    const draft = await this.load(owner, repo, prNumber);
    draft.pendingComments = draft.pendingComments.filter((comment) => comment.id !== id);
    await this.save(draft);
    return draft;
  }

  async setReviewBody(owner: string, repo: string, prNumber: number, reviewBody: string): Promise<ReviewDraft> {
    const draft = await this.load(owner, repo, prNumber);
    draft.reviewBody = reviewBody;
    await this.save(draft);
    return draft;
  }

  private key(owner: string, repo: string, prNumber: number): string {
    return `${owner}/${repo}#${prNumber}`;
  }
}
