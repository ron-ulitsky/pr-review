# PR Review for Obsidian

PR Review for Obsidian is a lightweight docs-review client for GitHub pull requests. It is aimed at Markdown-heavy repositories where reviewers want to read changed `.md`, `.mdx`, and docs files inside Obsidian without turning the vault into a full IDE.

## Current MVP

- Configure a GitHub token, API host, owner, repo, base branch, and docs file globs.
- List open pull requests for the configured repository.
- Open a pull request and view Markdown/docs changed files.
- Read GitHub patches as simple diff hunks.
- Add pending line comments on new-side added/context lines.
- Add GitHub suggestion comments with a normal comment above and/or below.
- Submit pending review comments as `COMMENT`, `APPROVE`, or `REQUEST_CHANGES`.
- View existing pull request review comments grouped by file.
- Detect Obsidian Git when installed and use its commands where discoverable.
- Fall back to local `git` commands on desktop when enabled.

## Manual Installation

1. Clone or copy this folder into your vault at `.obsidian/plugins/pr-review-for-obsidian`.
2. Run `npm install`.
3. Run `npm run build`.
4. Run `npm run package`.
5. Copy `dist/pr-review-for-obsidian` into your vault at `.obsidian/plugins/pr-review-for-obsidian`.
6. Enable the plugin in Obsidian community plugin settings.

The plugin artifact is a folder containing:

- `manifest.json`
- `main.js`
- `styles.css`
- `README.md`

Only the first three files are required by Obsidian.

## Docker Build

If Node/npm is not installed locally, use Docker:

```bash
docker build --target artifact --output type=local,dest=./artifact .
```

That writes the plugin artifact to:

```text
artifact/pr-review-for-obsidian/
```

Copy that folder into your vault:

```text
<your-vault>/.obsidian/plugins/pr-review-for-obsidian/
```

## BRAT Installation

This plugin can be tested with BRAT after it is pushed to GitHub:

1. Install the BRAT plugin in Obsidian.
2. Add the repository URL in BRAT.
3. Enable `PR Review for Obsidian`.

## GitHub Token

Create a classic or fine-grained GitHub token with access to the repository pull requests. For private repositories, the token needs repository read access and pull request review write access.

The MVP stores the token in Obsidian plugin settings. Treat the vault and `.obsidian` folder accordingly. The plugin masks the token in settings UI and does not intentionally log it.

## Obsidian Git

If Obsidian Git is installed, this plugin tries to detect it through Obsidian's private plugin registry and execute registered commands whose IDs or names look like Git pull, push, branch, fetch, or source-control actions.

This is intentionally best-effort. Obsidian Git does not expose a stable public API for this use case, so unsupported actions return a clear message and local Git fallback can take over.

## Without Obsidian Git

On desktop, local Git fallback uses Node `child_process.execFile` to run `git` directly from the vault folder. It supports:

- `git rev-parse --abbrev-ref HEAD`
- `git rev-parse --show-toplevel`
- `git remote get-url origin`
- `git fetch origin`
- `git checkout`
- `git pull --ff-only`
- `git push`
- `git checkout -b`

If neither Obsidian Git nor local Git is available, GitHub PR browsing, comments, and review submission still work, but local checkout and source-control actions are disabled.

## Security And Privacy

- GitHub API calls are scoped to the configured GitHub host, owner, and repo.
- Vault content is not sent to third parties except for review comments and review bodies submitted to GitHub.
- Tokens are masked in the settings UI.
- The MVP stores the token in plugin settings. Future versions should use a more secure token storage option if Obsidian exposes one.
- Local Git commands are executed with `execFile` arguments, not interpolated shell strings.

## Limitations

- The plugin is primarily for Markdown/MDX/docs PR review.
- Resolving review threads is shown as unsupported in the MVP.
- Fork checkout is experimental. The first local workflow fetches `pull/<number>/head` into `pr-review/<number>`.
- GitHub Enterprise support is experimental via the configurable API host.
- Mobile support is limited. Local Git fallback is desktop-only.
- Large PRs currently fetch the first 100 files and first 100 review comments.
- Diff rendering is intentionally simple and optimized for docs review.

## Development

```bash
npm install
npm run build
npm run package
npm test
```

The core diff and remote parsing logic is tested with Vitest. The Obsidian UI is built with the official plugin API patterns: `Plugin`, `PluginSettingTab`, `registerView`, `ItemView`, `WorkspaceLeaf`, and `loadData`/`saveData`.
