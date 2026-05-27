import simpleGit from 'simple-git';
import { spawn } from 'child_process';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync } from 'fs';

function resolveBase() {
  const base = process.env.LOCAL_REPO_BASE || '~/development';
  return base.replace(/^~/, homedir());
}

function getRepoPath(repoName) {
  return join(resolveBase(), repoName);
}

function getWorktreePath(repoName, branch) {
  const safeBranch = branch.replace(/\//g, '-');
  return join(resolveBase(), `${repoName}-worktrees`, safeBranch);
}

function parseWorktreeList(output) {
  const worktrees = [];
  const blocks = output.trim().split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    const wt = {};
    for (const line of lines) {
      if (line.startsWith('worktree ')) wt.path = line.slice(9);
      else if (line.startsWith('HEAD ')) wt.head = line.slice(5);
      else if (line.startsWith('branch ')) wt.branch = line.slice(7).replace('refs/heads/', '');
      else if (line === 'bare') wt.bare = true;
    }
    if (wt.path && !wt.bare) worktrees.push(wt);
  }
  return worktrees;
}

export async function listWorktrees(repoName) {
  const repoPath = getRepoPath(repoName);
  if (!existsSync(repoPath)) return [];
  try {
    const git = simpleGit(repoPath);
    const output = await git.raw(['worktree', 'list', '--porcelain']);
    return parseWorktreeList(output);
  } catch {
    return [];
  }
}

export async function createWorktree(repoName, branch) {
  const repoPath = getRepoPath(repoName);
  if (!existsSync(repoPath)) {
    throw new Error(`Repo not found locally: ${repoPath}`);
  }

  const worktreePath = getWorktreePath(repoName, branch);
  const git = simpleGit(repoPath);

  // Fetch branch from origin so it exists locally
  try {
    await git.raw(['fetch', 'origin', `${branch}:${branch}`]);
  } catch {
    // Branch may already exist locally — continue
  }

  await git.raw(['worktree', 'add', worktreePath, branch]);
  return worktreePath;
}

export async function removeWorktree(repoName, branch) {
  const repoPath = getRepoPath(repoName);
  const worktreePath = getWorktreePath(repoName, branch);
  const git = simpleGit(repoPath);
  await git.raw(['worktree', 'remove', '--force', worktreePath]);
}

export function openInCode(worktreePath) {
  if (!existsSync(worktreePath)) {
    throw new Error(`Path not found: ${worktreePath}`);
  }
  // Use `open -a` so Launch Services starts VS Code with the user's login env,
  // not the dev server's (which has nvm shims / a modified PATH).
  const child = spawn('open', ['-a', 'Visual Studio Code', worktreePath], {
    detached: true,
    stdio: 'ignore',
    env: { HOME: process.env.HOME, PATH: '/usr/bin:/bin:/usr/sbin:/sbin' }
  });
  child.unref();
}
