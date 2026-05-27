import type { App } from "obsidian";
import type { GitActionResult, GitAdapter } from "./types";

type ExecFile = typeof import("child_process").execFile;

function result(ok: boolean, message: string): GitActionResult {
  return { ok, message };
}

export class ObsidianGitAdapter implements GitAdapter {
  readonly name = "Obsidian Git";

  constructor(private readonly app: App) {}

  async isAvailable(): Promise<boolean> {
    const plugins = (this.app as any).plugins;
    return Boolean(plugins?.enabledPlugins?.has?.("obsidian-git") || plugins?.plugins?.["obsidian-git"]);
  }

  async getCurrentBranch() {
    return { ...result(false, "Current branch is unsupported by the Obsidian Git adapter.") };
  }

  async checkoutBranch() {
    return result(false, "Checkout is unsupported by the Obsidian Git adapter.");
  }

  async fetch() {
    return this.executeCommandByWords(["git", "fetch"], "Fetch is unsupported by the Obsidian Git adapter.");
  }

  async pull() {
    return this.executeCommandByWords(["git", "pull"], "Pull is unsupported by the Obsidian Git adapter.");
  }

  async push() {
    return this.executeCommandByWords(["git", "push"], "Push is unsupported by the Obsidian Git adapter.");
  }

  async createBranch() {
    return this.executeCommandByWords(["git", "branch"], "Branch creation is unsupported by the Obsidian Git adapter.");
  }

  async getRepoRoot() {
    return { ...result(false, "Repository root is unsupported by the Obsidian Git adapter.") };
  }

  async getRemoteUrl() {
    return { ...result(false, "Remote URL is unsupported by the Obsidian Git adapter.") };
  }

  async openSourceControlView() {
    return this.executeCommandByWords(["git", "source"], "Opening source control is unsupported by the Obsidian Git adapter.");
  }

  private async executeCommandByWords(words: string[], unsupported: string): Promise<GitActionResult> {
    const commands = (this.app as any).commands?.commands ?? {};
    const entries = Object.entries(commands) as Array<[string, { name?: string }]>;
    const match = entries.find(([id, command]) => {
      const haystack = `${id} ${command.name ?? ""}`.toLowerCase();
      return words.every((word) => haystack.includes(word));
    });

    if (!match) {
      if (process.env.NODE_ENV !== "production") {
        const available = entries
          .filter(([id, command]) => /git|obsidian git|pull|push|branch/i.test(`${id} ${command.name ?? ""}`))
          .map(([id, command]) => `${id}: ${command.name ?? ""}`);
        console.debug("PR Review available Git commands", available);
      }
      return result(false, unsupported);
    }

    await (this.app as any).commands.executeCommandById(match[0]);
    return result(true, `Ran ${match[1].name ?? match[0]} through Obsidian Git.`);
  }
}

export class LocalGitAdapter implements GitAdapter {
  readonly name = "Local Git fallback";

  constructor(private readonly app: App) {}

  async isAvailable(): Promise<boolean> {
    const repo = await this.getRepoRoot();
    return repo.ok;
  }

  async getCurrentBranch() {
    const run = await this.git(["rev-parse", "--abbrev-ref", "HEAD"]);
    return { ...run, branch: run.ok ? run.message.trim() : undefined };
  }

  async checkoutBranch(branchName: string) {
    return this.git(["checkout", branchName]);
  }

  async fetch(refspec?: string) {
    return this.git(refspec ? ["fetch", "origin", refspec] : ["fetch", "origin"]);
  }

  async pull() {
    return this.git(["pull", "--ff-only"]);
  }

  async push() {
    return this.git(["push"]);
  }

  async createBranch(branchName: string, fromRef?: string) {
    return this.git(fromRef ? ["checkout", "-b", branchName, fromRef] : ["checkout", "-b", branchName]);
  }

  async getRepoRoot() {
    return this.git(["rev-parse", "--show-toplevel"]);
  }

  async getRemoteUrl() {
    const run = await this.git(["remote", "get-url", "origin"]);
    return { ...run, remoteUrl: run.ok ? run.message.trim() : undefined };
  }

  private getVaultPath(): string | null {
    const adapter = this.app.vault.adapter as any;
    return typeof adapter.getBasePath === "function" ? adapter.getBasePath() : null;
  }

  private async git(args: string[]): Promise<GitActionResult> {
    const cwd = this.getVaultPath();
    if (!cwd) return result(false, "Local Git is available only on desktop vaults.");

    try {
      const { execFile } = await import("child_process") as { execFile: ExecFile };
      const output = await new Promise<string>((resolve, reject) => {
        execFile("git", args, { cwd, windowsHide: true }, (error, stdout, stderr) => {
          if (error) {
            reject(new Error((stderr || stdout || error.message).trim()));
            return;
          }
          resolve((stdout || stderr).trim());
        });
      });
      return result(true, output || "Git command completed.");
    } catch (error) {
      return result(false, error instanceof Error ? error.message : String(error));
    }
  }
}

export async function chooseGitAdapter(app: App, preferObsidianGit: boolean, allowLocalFallback: boolean): Promise<GitAdapter | null> {
  if (preferObsidianGit) {
    const obsidianGit = new ObsidianGitAdapter(app);
    if (await obsidianGit.isAvailable()) return obsidianGit;
  }

  if (allowLocalFallback) {
    const local = new LocalGitAdapter(app);
    if (await local.isAvailable()) return local;
  }

  return null;
}
