import { Modal, Notice, Plugin } from "obsidian";

interface DebugData {
  debugLog?: string[];
}

const MAX_LOG_LINES = 250;

export class DebugLogger {
  private lines: string[] = [];
  private saveTimer: number | null = null;

  constructor(private readonly plugin: Plugin & { settings?: { debugLogging?: boolean } }) {}

  async load() {
    const data = ((await this.plugin.loadData()) ?? {}) as DebugData;
    this.lines = data.debugLog ?? [];
  }

  log(event: string, details: Record<string, unknown> = {}) {
    if (!this.plugin.settings?.debugLogging) return;
    const safeDetails = this.sanitize(details);
    const suffix = Object.keys(safeDetails).length ? ` ${JSON.stringify(safeDetails)}` : "";
    const line = `${new Date().toISOString()} ${event}${suffix}`;
    this.lines.push(line);
    this.lines = this.lines.slice(-MAX_LOG_LINES);
    this.scheduleSave();
  }

  error(event: string, error: unknown, details: Record<string, unknown> = {}) {
    this.log(event, {
      ...details,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  getText() {
    return this.lines.join("\n");
  }

  async clear() {
    this.lines = [];
    await this.flush();
  }

  async flush() {
    if (this.saveTimer !== null) {
      window.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const data = ((await this.plugin.loadData()) ?? {}) as DebugData;
    await this.plugin.saveData({ ...data, debugLog: this.lines });
  }

  show() {
    new DebugLogModal(this.plugin.app, this).open();
  }

  private scheduleSave() {
    if (this.saveTimer !== null) return;
    this.saveTimer = window.setTimeout(() => {
      void this.flush();
    }, 300);
  }

  private sanitize(details: Record<string, unknown>) {
    return Object.fromEntries(
      Object.entries(details).map(([key, value]) => {
        if (/token|authorization|secret/i.test(key)) return [key, "***"];
        if (typeof value === "string" && value.length > 500) return [key, `${value.slice(0, 500)}...`];
        return [key, value];
      })
    );
  }
}

class DebugLogModal extends Modal {
  constructor(app: Plugin["app"], private readonly logger: DebugLogger) {
    super(app);
  }

  onOpen() {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("pr-review-modal");
    contentEl.createEl("h2", { text: "PR Review debug log" });
    const text = contentEl.createEl("textarea");
    text.value = this.logger.getText() || "No debug log entries yet.";
    text.readOnly = true;
    text.rows = 18;

    const actions = contentEl.createDiv({ cls: "pr-review-comment-actions" });
    actions.createEl("button", { text: "Copy" }).onclick = async () => {
      await navigator.clipboard.writeText(this.logger.getText());
      new Notice("Copied PR Review debug log.");
    };
    actions.createEl("button", { text: "Clear" }).onclick = async () => {
      await this.logger.clear();
      text.value = "No debug log entries yet.";
    };
  }
}
