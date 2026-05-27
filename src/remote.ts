export function parseGitHubRemote(remoteUrl: string): { owner: string; repo: string } | null {
  const trimmed = remoteUrl.trim().replace(/\.git$/, "");
  const ssh = trimmed.match(/^git@[^:]+:([^/]+)\/(.+)$/);
  if (ssh) return { owner: ssh[1], repo: ssh[2] };

  const sshProtocol = trimmed.match(/^ssh:\/\/git@[^/]+\/([^/]+)\/(.+)$/);
  if (sshProtocol) return { owner: sshProtocol[1], repo: sshProtocol[2] };

  try {
    const url = new URL(trimmed);
    const [, owner, repo] = url.pathname.split("/");
    if (owner && repo) return { owner, repo };
  } catch {
    return null;
  }

  return null;
}
