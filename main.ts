import {
  App,
  ButtonComponent,
  ItemView,
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  WorkspaceLeaf,
  normalizePath
} from "obsidian";
import { composeCommentBody, matchesDocsGlobs, parsePatch, toReviewCommentPayload, type DiffLine } from "./src/diff";
import { ReviewDraftStore } from "./src/drafts";
import { chooseGitAdapter } from "./src/git";
import { GitHubClient, PullRequestService, showGitHubError } from "./src/github";
import { DEFAULT_SETTINGS, maskToken, normalizeSettings } from "./src/settings";
import type {
  GitAdapter,
  PendingReviewComment,
  PrReviewSettings,
  PullRequestFile,
  PullRequestSummary,
  ReviewComment,
  ReviewDraft,
  ReviewEvent
} from "./src/types";

const VIEW_TYPE_PR_REVIEW = "pr-review-for-obsidian-view";
type TextSettingKey = "githubHost" | "defaultOwner" | "defaultRepo" | "defaultBaseBranch" | "docsFileGlobs";

export default class PrReviewPlugin extends Plugin {
  settings: PrReviewSettings = DEFAULT_SETTINGS;
  statusBar!: HTMLElement;
  draftStore!: ReviewDraftStore;
  gitAdapter: GitAdapter | null = null;

  async onload() {
    const data = await this.loadData();
    this.settings = normalizeSettings(data?.settings ?? data);
    this.draftStore = new ReviewDraftStore(this);
    this.gitAdapter = await chooseGitAdapter(this.app, this.settings.preferObsidianGit, this.settings.useLocalGitFallback);

    this.registerView(VIEW_TYPE_PR_REVIEW, (leaf) => new PrReviewView(leaf, this));
    this.addSettingTab(new PrReviewSettingTab(this.app, this));
    this.statusBar = this.addStatusBarItem();
    this.updateStatus("Ready");

    this.addCommand({
      id: "open-pr-browser",
      name: "PR Review: Open pull request browser",
      callback: () => this.activateView()
    });
    this.addCommand({
      id: "refresh-current-pr",
      name: "PR Review: Refresh current pull request",
      callback: () => this.withView((view) => view.refresh())
    });
    this.addCommand({
      id: "submit-pending-review",
      name: "PR Review: Submit pending review",
      callback: () => this.withView((view) => view.openSubmitModal())
    });
    this.addCommand({
      id: "checkout-selected-pr-branch",
      name: "PR Review: Checkout selected PR branch",
      callback: () => this.withView((view) => view.checkoutSelectedPr())
    });
    this.addCommand({
      id: "open-settings",
      name: "PR Review: Open settings",
      callback: () => {
        (this.app as any).setting.open();
        (this.app as any).setting.openTabById(this.manifest.id);
      }
    });
    this.addCommand({
      id: "clear-pending-review-comments",
      name: "PR Review: Clear pending review comments",
      callback: () => this.withView((view) => view.clearPending())
    });
  }

  async saveSettings() {
    this.settings = normalizeSettings(this.settings);
    const data = (await this.loadData()) ?? {};
    await this.saveData({ ...data, settings: this.settings });
    this.gitAdapter = await chooseGitAdapter(this.app, this.settings.preferObsidianGit, this.settings.useLocalGitFallback);
    this.updateStatus("Settings saved");
  }

  getPrService(): PullRequestService {
    return new PullRequestService(new GitHubClient(this.settings.githubHost, this.settings.githubToken));
  }

  updateStatus(message: string) {
    const repo = this.settings.defaultOwner && this.settings.defaultRepo ? `${this.settings.defaultOwner}/${this.settings.defaultRepo}` : "No repo";
    const adapter = this.gitAdapter ? this.gitAdapter.name : "GitHub read-only";
    this.statusBar?.setText(`PR Review: ${repo} - ${adapter} - ${message}`);
  }

  private async activateView() {
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.setViewState({ type: VIEW_TYPE_PR_REVIEW, active: true });
    this.app.workspace.revealLeaf(leaf);
  }

  private withView(callback: (view: PrReviewView) => void | Promise<void>) {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_PR_REVIEW);
    const view = leaves[0]?.view;
    if (view instanceof PrReviewView) {
      void callback(view);
      return;
    }
    new Notice("Open the PR Review browser first.");
  }
}

class PrReviewView extends ItemView {
  private prs: PullRequestSummary[] = [];
  private selectedPr: PullRequestSummary | null = null;
  private files: PullRequestFile[] = [];
  private comments: ReviewComment[] = [];
  private draft: ReviewDraft | null = null;
  private tab: "files" | "comments" | "pending" = "files";
  private loading = false;
  private error = "";

  constructor(leaf: WorkspaceLeaf, private readonly plugin: PrReviewPlugin) {
    super(leaf);
  }

  getViewType() {
    return VIEW_TYPE_PR_REVIEW;
  }

  getDisplayText() {
    return "PR Review";
  }

  async onOpen() {
    await this.loadPrList();
  }

  async refresh() {
    if (this.selectedPr) {
      await this.openPr(this.selectedPr.number);
    } else {
      await this.loadPrList();
    }
  }

  async loadPrList() {
    this.loading = true;
    this.error = "";
    this.render();
    try {
      this.ensureConfigured();
      this.prs = await this.plugin.getPrService().listPullRequests(
        this.plugin.settings.defaultOwner,
        this.plugin.settings.defaultRepo,
        this.plugin.settings.defaultBaseBranch
      );
      this.plugin.updateStatus(`Loaded ${this.prs.length} PRs`);
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      showGitHubError(error);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  async openPr(number: number) {
    this.loading = true;
    this.error = "";
    this.render();
    const { defaultOwner: owner, defaultRepo: repo, docsFileGlobs } = this.plugin.settings;
    try {
      const service = this.plugin.getPrService();
      this.selectedPr = await service.getPullRequest(owner, repo, number);
      this.files = (await service.listFiles(owner, repo, number)).filter((file) => matchesDocsGlobs(file.filename, docsFileGlobs));
      this.comments = await service.listReviewComments(owner, repo, number);
      this.draft = await this.plugin.draftStore.setMetadata(owner, repo, number, this.selectedPr);
      this.plugin.updateStatus(`#${number} loaded`);
    } catch (error) {
      this.error = error instanceof Error ? error.message : String(error);
      showGitHubError(error);
    } finally {
      this.loading = false;
      this.render();
    }
  }

  async checkoutSelectedPr() {
    if (!this.selectedPr) {
      new Notice("Select a PR first.");
      return;
    }
    const adapter = this.plugin.gitAdapter;
    if (!adapter) {
      new Notice("No Git adapter is available. Review remains GitHub-only.");
      return;
    }
    const branch = `pr-review/${this.selectedPr.number}`;
    const fetch = await adapter.fetch(`pull/${this.selectedPr.number}/head:${branch}`);
    if (!fetch.ok) {
      new Notice(`Fetch failed: ${fetch.message}`);
      return;
    }
    const checkout = await adapter.checkoutBranch(branch);
    new Notice(checkout.ok ? `Checked out ${branch}` : `Checkout failed: ${checkout.message}`);
    this.plugin.updateStatus(checkout.ok ? `Checked out ${branch}` : "Checkout failed");
  }

  async clearPending() {
    if (!this.selectedPr) return;
    this.draft = await this.plugin.draftStore.clearPending(
      this.plugin.settings.defaultOwner,
      this.plugin.settings.defaultRepo,
      this.selectedPr.number
    );
    this.render();
  }

  openSubmitModal() {
    if (!this.selectedPr || !this.draft) {
      new Notice("Select a PR with pending review content first.");
      return;
    }
    new SubmitReviewModal(this.app, this.plugin, this, this.selectedPr, this.draft).open();
  }

  render() {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("pr-review-view");

    this.renderToolbar(container);
    if (this.loading) container.createDiv({ cls: "pr-review-status", text: "Loading pull request data..." });
    if (this.error) container.createDiv({ cls: "pr-review-warning", text: this.error });

    const layout = container.createDiv({ cls: "pr-review-layout" });
    const sidebar = layout.createDiv({ cls: "pr-review-sidebar" });
    const main = layout.createDiv({ cls: "pr-review-main" });

    this.renderPrList(sidebar);
    if (this.selectedPr) {
      this.renderPrDetail(main);
    } else {
      this.renderWelcome(main);
    }
  }

  private renderToolbar(container: HTMLElement) {
    const toolbar = container.createDiv({ cls: "pr-review-toolbar" });
    const repoText = this.plugin.settings.defaultOwner && this.plugin.settings.defaultRepo
      ? `${this.plugin.settings.defaultOwner}/${this.plugin.settings.defaultRepo}`
      : "No repository configured";
    toolbar.createDiv({ cls: "pr-review-toolbar-title", text: repoText });
    new ButtonComponent(toolbar).setButtonText("All PRs").onClick(() => {
      this.selectedPr = null;
      this.files = [];
      this.comments = [];
      this.draft = null;
      this.render();
    });
    new ButtonComponent(toolbar).setButtonText("Refresh").onClick(() => this.refresh());
    new ButtonComponent(toolbar).setButtonText("Settings").onClick(() => {
      (this.app as any).setting.open();
      (this.app as any).setting.openTabById(this.plugin.manifest.id);
    });
    toolbar.createSpan({
      cls: "pr-review-small",
      text: this.plugin.gitAdapter ? `Using ${this.plugin.gitAdapter.name}` : "Using GitHub read-only mode"
    });
  }

  private renderPrList(container: HTMLElement) {
    const heading = container.createDiv({ cls: "pr-review-sidebar-heading" });
    heading.createDiv({ cls: "pr-review-title", text: "Open PRs" });
    heading.createDiv({ cls: "pr-review-count", text: this.prs.length.toString() });
    if (!this.plugin.settings.defaultOwner || !this.plugin.settings.defaultRepo) {
      container.createDiv({ cls: "pr-review-empty", text: "Configure owner, repo, and GitHub token in settings." });
      return;
    }
    if (this.prs.length === 0 && !this.loading) {
      container.createDiv({ cls: "pr-review-empty", text: "No open pull requests found." });
      return;
    }

    const list = container.createDiv({ cls: "pr-review-list" });
    for (const pr of this.prs) {
      const row = list.createDiv({ cls: "pr-review-pr-row" });
      row.toggleClass("is-selected", this.selectedPr?.number === pr.number);
      row.onclick = () => this.openPr(pr.number);
      const top = row.createDiv({ cls: "pr-review-row-top" });
      top.createDiv({ cls: "pr-review-pr-title", text: pr.title });
      top.createDiv({ cls: "pr-review-pr-number", text: `#${pr.number}` });
      row.createDiv({
        cls: "pr-review-meta",
        text: `${pr.user.login} - ${pr.changed_files ?? "?"} files - ${this.formatRelativeDate(pr.updated_at)}`
      });
      row.createDiv({ cls: "pr-review-review-state", text: pr.reviewState ? `Review: ${pr.reviewState}` : "Review: unknown" });
      const labels = row.createDiv({ cls: "pr-review-labels" });
      for (const label of pr.labels ?? []) labels.createSpan({ cls: "pr-review-label", text: label.name });
    }
  }

  private renderWelcome(container: HTMLElement) {
    const welcome = container.createDiv({ cls: "pr-review-welcome" });
    welcome.createDiv({ cls: "pr-review-title", text: "Select a pull request" });
    welcome.createDiv({
      cls: "pr-review-meta",
      text: "Choose an open PR from the left to inspect Markdown changes, read existing review comments, and draft a review."
    });
    const steps = welcome.createEl("ol", { cls: "pr-review-steps" });
    for (const step of ["Open PR #1 for the README test", "Review the Files and Comments tabs", "Add a pending comment from a diff line", "Submit a COMMENT review when ready"]) {
      steps.createEl("li", { text: step });
    }
  }

  private renderPrDetail(container: HTMLElement) {
    if (!this.selectedPr) return;

    const header = container.createDiv({ cls: "pr-review-header" });
    const titleWrap = header.createDiv();
    titleWrap.createDiv({ cls: "pr-review-title", text: `#${this.selectedPr.number} ${this.selectedPr.title}` });
    titleWrap.createDiv({
      cls: "pr-review-meta",
      text: `${this.selectedPr.user.login} - ${this.selectedPr.head.ref} into ${this.selectedPr.base.ref}`
    });
    const actions = header.createDiv({ cls: "pr-review-file-actions" });
    new ButtonComponent(actions).setButtonText("Open on GitHub").onClick(() => window.open(this.selectedPr?.html_url));
    new ButtonComponent(actions).setButtonText("Checkout").onClick(() => this.checkoutSelectedPr());
    new ButtonComponent(actions).setButtonText("New review branch").onClick(() => this.createLocalReviewBranch());
    new ButtonComponent(actions).setButtonText("Pull").onClick(() => this.gitAction("pull"));
    new ButtonComponent(actions).setButtonText("Push").onClick(() => this.gitAction("push"));
    if (this.plugin.gitAdapter?.openSourceControlView) {
      new ButtonComponent(actions).setButtonText("Source control").onClick(() => this.gitAction("source"));
    }

    const tabs = container.createDiv({ cls: "pr-review-tabs" });
    this.addTabButton(tabs, "files", `Files (${this.files.length})`);
    this.addTabButton(tabs, "comments", `Comments (${this.comments.length})`);
    this.addTabButton(tabs, "pending", `Pending (${this.draft?.pendingComments.length ?? 0})`);

    if (this.tab === "files") this.renderFiles(container);
    if (this.tab === "comments") this.renderComments(container);
    if (this.tab === "pending") this.renderPending(container);
  }

  private addTabButton(container: HTMLElement, tab: "files" | "comments" | "pending", label: string) {
    const button = container.createEl("button", { text: label });
    button.toggleClass("is-active", this.tab === tab);
    button.onclick = () => {
      this.tab = tab;
      this.render();
    };
  }

  private renderFiles(container: HTMLElement) {
    const filesEl = container.createDiv({ cls: "pr-review-files" });
    const summary = filesEl.createDiv({ cls: "pr-review-section-summary" });
    summary.createSpan({ text: `${this.files.length} docs file${this.files.length === 1 ? "" : "s"}` });
    summary.createSpan({ cls: "pr-review-small", text: this.plugin.settings.docsFileGlobs });
    if (this.files.length === 0) {
      filesEl.createDiv({ cls: "pr-review-empty", text: "No Markdown/docs files matched the configured globs." });
      return;
    }

    for (const file of this.files) {
      const fileEl = filesEl.createDiv({ cls: "pr-review-file" });
      const top = fileEl.createDiv({ cls: "pr-review-file-top" });
      const fileTitle = top.createDiv();
      fileTitle.createDiv({ cls: "pr-review-file-name", text: file.filename });
      fileTitle.createDiv({ cls: "pr-review-meta", text: `${file.status} - +${file.additions}/-${file.deletions}` });
      const actions = top.createDiv({ cls: "pr-review-file-actions" });
      new ButtonComponent(actions).setButtonText("Open local").onClick(() => this.openLocalFile(file.filename));
      new ButtonComponent(actions).setButtonText("Open GitHub").onClick(() => window.open(file.blob_url));

      if (!file.patch) {
        fileEl.createDiv({ cls: "pr-review-warning", text: "GitHub did not include a patch for this file." });
        continue;
      }
      this.renderPatch(fileEl, file);
    }
  }

  private renderPatch(container: HTMLElement, file: PullRequestFile) {
    const diff = container.createDiv({ cls: "pr-review-diff" });
    for (const hunk of parsePatch(file.patch)) {
      const details = diff.createEl("details", { cls: "pr-review-hunk" });
      details.open = true;
      details.createEl("summary", { cls: "pr-review-hunk-header", text: hunk.header });
      for (const line of hunk.lines) {
        const row = details.createDiv({ cls: `pr-review-diff-line is-${line.type}` });
        row.createSpan({ cls: "pr-review-line-no", text: line.oldLine?.toString() ?? "" });
        row.createSpan({ cls: "pr-review-line-no", text: line.newLine?.toString() ?? "" });
        row.createSpan({ cls: "pr-review-line-text", text: `${line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}${line.content}` });
        if (line.canComment) {
          new ButtonComponent(row.createDiv())
            .setButtonText("+")
            .setTooltip("Add review comment")
            .onClick(() => this.openCommentModal(file.filename, line));
        } else {
          row.createSpan({ cls: "pr-review-small", text: "" });
        }
      }
    }
  }

  private renderComments(container: HTMLElement) {
    const root = container.createDiv({ cls: "pr-review-comments" });
    root.createDiv({ cls: "pr-review-section-summary", text: `${this.comments.length} existing review comment${this.comments.length === 1 ? "" : "s"}` });
    if (this.comments.length === 0) {
      root.createDiv({ cls: "pr-review-empty", text: "No existing review comments found." });
      return;
    }
    const grouped = new Map<string, ReviewComment[]>();
    for (const comment of this.comments) grouped.set(comment.path, [...(grouped.get(comment.path) ?? []), comment]);
    for (const [path, comments] of grouped) {
      const group = root.createDiv({ cls: "pr-review-file" });
      group.createDiv({ cls: "pr-review-title", text: path });
      for (const comment of comments) {
        const item = group.createDiv({ cls: "pr-review-comment" });
        item.createDiv({
          cls: "pr-review-meta",
          text: `${comment.user.login} - line ${comment.line ?? comment.original_line ?? "?"}${comment.outdated ? " - outdated" : ""}`
        });
        item.createEl("pre", { cls: "pr-review-comment-body", text: comment.body });
        if (comment.html_url) new ButtonComponent(item).setButtonText("Open on GitHub").onClick(() => window.open(comment.html_url));
        item.createDiv({ cls: "pr-review-small", text: "Resolving review threads is unsupported in this MVP." });
      }
    }
  }

  private renderPending(container: HTMLElement) {
    const root = container.createDiv({ cls: "pr-review-pending" });
    const pendingTop = root.createDiv({ cls: "pr-review-section-summary" });
    pendingTop.createSpan({ text: `${this.draft?.pendingComments.length ?? 0} pending comment${this.draft?.pendingComments.length === 1 ? "" : "s"}` });
    new ButtonComponent(pendingTop).setButtonText("Submit review").setCta().onClick(() => this.openSubmitModal());
    if (!this.draft || this.draft.pendingComments.length === 0) {
      root.createDiv({ cls: "pr-review-empty", text: "No pending review comments." });
      return;
    }
    for (const comment of this.draft.pendingComments) {
      const item = root.createDiv({ cls: "pr-review-pending-comment" });
      item.createDiv({ cls: "pr-review-meta", text: `${comment.path}:${comment.line}` });
      item.createEl("pre", { cls: "pr-review-comment-body", text: comment.body });
      new ButtonComponent(item).setButtonText("Remove").onClick(async () => {
        if (!this.selectedPr) return;
        this.draft = await this.plugin.draftStore.removePending(
          this.plugin.settings.defaultOwner,
          this.plugin.settings.defaultRepo,
          this.selectedPr.number,
          comment.id
        );
        this.render();
      });
    }
  }

  private async openLocalFile(path: string) {
    const file = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf(false).openFile(file);
      return;
    }
    new Notice("File was not found in this vault.");
  }

  private openCommentModal(path: string, line: DiffLine) {
    try {
      toReviewCommentPayload(path, line, "");
      new AddCommentModal(this.app, this.plugin, this, path, line).open();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }

  async addPendingComment(path: string, line: DiffLine, normalComment: string, suggestion: string, followupComment: string) {
    if (!this.selectedPr) return;
    const payload = toReviewCommentPayload(path, line, composeCommentBody(normalComment, suggestion, followupComment));
    const comment: PendingReviewComment = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      path: payload.path,
      line: payload.line,
      side: payload.side,
      body: payload.body,
      normalComment,
      suggestion,
      followupComment,
      diffPosition: line.position,
      createdAt: new Date().toISOString()
    };
    this.draft = await this.plugin.draftStore.addPending(
      this.plugin.settings.defaultOwner,
      this.plugin.settings.defaultRepo,
      this.selectedPr.number,
      comment
    );
    this.tab = "pending";
    this.render();
  }

  async submitReview(event: ReviewEvent, body: string) {
    if (!this.selectedPr || !this.draft) return;
    await this.plugin.draftStore.setReviewBody(
      this.plugin.settings.defaultOwner,
      this.plugin.settings.defaultRepo,
      this.selectedPr.number,
      body
    );
    await this.plugin.getPrService().submitReview(
      this.plugin.settings.defaultOwner,
      this.plugin.settings.defaultRepo,
      this.selectedPr.number,
      event,
      body,
      this.draft.pendingComments
    );
    await this.clearPending();
    new Notice("Review submitted.");
    await this.refresh();
  }

  private async createLocalReviewBranch() {
    if (!this.selectedPr) {
      new Notice("Select a PR first.");
      return;
    }
    const adapter = this.plugin.gitAdapter;
    if (!adapter) {
      new Notice("No Git adapter is available.");
      return;
    }
    const branch = `review/pr-${this.selectedPr.number}`;
    const response = await adapter.createBranch(branch, this.selectedPr.head.sha);
    new Notice(response.ok ? `Created ${branch}` : `Branch creation failed: ${response.message}`);
    this.plugin.updateStatus(response.ok ? `Created ${branch}` : "Branch creation failed");
  }

  private async gitAction(action: "pull" | "push" | "source") {
    const adapter = this.plugin.gitAdapter;
    if (!adapter) {
      new Notice("No Git adapter is available.");
      return;
    }
    const response = action === "pull"
      ? await adapter.pull()
      : action === "push"
        ? await adapter.push()
        : ((await adapter.openSourceControlView?.()) ?? { ok: false, message: "Source control view is unsupported." });
    new Notice(response.message);
    this.plugin.updateStatus(response.ok ? `${action} complete` : `${action} failed`);
  }

  private ensureConfigured() {
    if (!this.plugin.settings.githubToken) throw new Error("GitHub token is required.");
    if (!this.plugin.settings.defaultOwner || !this.plugin.settings.defaultRepo) {
      throw new Error("Default owner and repo are required.");
    }
  }

  private formatRelativeDate(dateText: string): string {
    const date = new Date(dateText);
    if (Number.isNaN(date.getTime())) return "updated date unknown";
    const diffMs = Date.now() - date.getTime();
    const minutes = Math.max(1, Math.round(diffMs / 60000));
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 48) return `${hours}h ago`;
    const days = Math.round(hours / 24);
    return `${days}d ago`;
  }
}

class AddCommentModal extends Modal {
  constructor(
    app: App,
    private readonly plugin: PrReviewPlugin,
    private readonly view: PrReviewView,
    private readonly path: string,
    private readonly line: DiffLine
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("pr-review-modal");
    contentEl.createEl("h2", { text: `Comment on ${this.path}:${this.line.newLine}` });
    contentEl.createDiv({ cls: "pr-review-small", text: "Suggestion text will be wrapped in GitHub's suggestion fence." });
    const normal = contentEl.createEl("textarea", { attr: { placeholder: "Comment before suggestion" } });
    const suggestion = contentEl.createEl("textarea", { attr: { placeholder: "Replacement text for suggestion mode" } });
    const followup = contentEl.createEl("textarea", { attr: { placeholder: "Comment after suggestion" } });
    const actions = contentEl.createDiv({ cls: "pr-review-comment-actions" });
    new ButtonComponent(actions).setButtonText("Add pending comment").setCta().onClick(async () => {
      if (!normal.value.trim() && !suggestion.value.trim() && !followup.value.trim()) {
        new Notice("Add a comment or suggestion first.");
        return;
      }
      await this.view.addPendingComment(this.path, this.line, normal.value, suggestion.value, followup.value);
      this.close();
    });
    new ButtonComponent(actions).setButtonText("Cancel").onClick(() => this.close());
  }
}

class SubmitReviewModal extends Modal {
  constructor(
    app: App,
    private readonly plugin: PrReviewPlugin,
    private readonly view: PrReviewView,
    private readonly pr: PullRequestSummary,
    private readonly draft: ReviewDraft
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("pr-review-modal");
    contentEl.createEl("h2", { text: `Submit review for #${this.pr.number}` });
    contentEl.createDiv({ cls: "pr-review-small", text: `${this.draft.pendingComments.length} pending line comments` });
    const body = contentEl.createEl("textarea", { attr: { placeholder: "Overall review body" } });
    body.value = this.draft.reviewBody;
    const actions = contentEl.createDiv({ cls: "pr-review-pending-actions" });
    this.addSubmitButton(actions, "COMMENT", "Comment", body);
    this.addSubmitButton(actions, "APPROVE", "Approve", body);
    this.addSubmitButton(actions, "REQUEST_CHANGES", "Request changes", body);
    new ButtonComponent(actions).setButtonText("Cancel").onClick(() => this.close());
  }

  private addSubmitButton(container: HTMLElement, event: ReviewEvent, label: string, body: HTMLTextAreaElement) {
    new ButtonComponent(container).setButtonText(label).onClick(async () => {
      try {
        await this.view.submitReview(event, body.value);
        this.close();
      } catch (error) {
        showGitHubError(error);
      }
    });
  }
}

class PrReviewSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: PrReviewPlugin) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "PR Review for Obsidian" });
    containerEl.createDiv({
      cls: "pr-review-small",
      text: `Status: ${this.plugin.gitAdapter ? `Using ${this.plugin.gitAdapter.name}` : "Using GitHub read-only mode"}`
    });

    new Setting(containerEl)
      .setName("GitHub token")
      .setDesc(`Stored in plugin settings for the MVP. Current: ${maskToken(this.plugin.settings.githubToken)}`)
      .addText((text) => text
        .setPlaceholder("github_pat_...")
        .setValue("")
        .onChange(async (value) => {
          if (value.trim()) {
            this.plugin.settings.githubToken = value.trim();
            await this.plugin.saveSettings();
          }
        }));

    this.textSetting(containerEl, "GitHub host", "Use https://api.github.com unless you are testing GitHub Enterprise.", "githubHost");
    this.textSetting(containerEl, "Default owner", "GitHub organization or user.", "defaultOwner");
    this.textSetting(containerEl, "Default repo", "Repository name.", "defaultRepo");
    this.textSetting(containerEl, "Default base branch", "Usually main.", "defaultBaseBranch");
    this.textSetting(containerEl, "Docs file globs", "Comma-separated file filters.", "docsFileGlobs");

    new Setting(containerEl)
      .setName("Prefer Obsidian Git integration")
      .setDesc("Best-effort only. The plugin falls back when Obsidian Git has no stable command for an action.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.preferObsidianGit)
        .onChange(async (value) => {
          this.plugin.settings.preferObsidianGit = value;
          await this.plugin.saveSettings();
          this.display();
        }));

    new Setting(containerEl)
      .setName("Use local Git fallback")
      .setDesc("Desktop only. Runs git with Node child_process execFile.")
      .addToggle((toggle) => toggle
        .setValue(this.plugin.settings.useLocalGitFallback)
        .onChange(async (value) => {
          this.plugin.settings.useLocalGitFallback = value;
          await this.plugin.saveSettings();
          this.display();
        }));
  }

  private textSetting(containerEl: HTMLElement, name: string, desc: string, key: TextSettingKey) {
    new Setting(containerEl)
      .setName(name)
      .setDesc(desc)
      .addText((text) => text
        .setValue(String(this.plugin.settings[key] ?? ""))
        .onChange(async (value) => {
          this.plugin.settings[key] = value;
          await this.plugin.saveSettings();
        }));
  }
}
