import simpleGit from 'simple-git';
import { spawn } from 'child_process';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, readdirSync } from 'fs';

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

export async function listAllWorktrees() {
  const base = resolveBase();
  if (!existsSync(base)) return [];
  let entries;
  try {
    entries = readdirSync(base, { withFileTypes: true });
  } catch {
    return [];
  }
  const repoNames = entries
    .filter(e => e.isDirectory() && e.name.endsWith('-worktrees'))
    .map(e => e.name.slice(0, -'-worktrees'.length))
    .filter(name => existsSync(getRepoPath(name)));

  const results = await Promise.all(repoNames.map(async repoName => {
    const wts = await listWorktrees(repoName);
    return wts.map(wt => ({ ...wt, repoName }));
  }));
  // The main repo checkout shows up in `git worktree list` too — filter it out
  // so only actual added worktrees (those under {repoName}-worktrees/) remain.
  return results.flat().filter(wt =>
    wt.path.includes(`${wt.repoName}-worktrees`)
  );
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

  // Refresh remote-tracking refs so we can detect origin/{branch}
  try {
    await git.raw(['fetch', 'origin']);
  } catch {}

  const hasLocal = (await git.raw(['branch', '--list', branch])).trim().length > 0;
  const hasRemote = (await git.raw(['branch', '-r', '--list', `origin/${branch}`])).trim().length > 0;

  if (hasLocal) {
    await git.raw(['worktree', 'add', worktreePath, branch]);
  } else if (hasRemote) {
    await git.raw(['worktree', 'add', '--track', '-b', branch, worktreePath, `origin/${branch}`]);
  } else {
    await git.raw(['worktree', 'add', '-b', branch, worktreePath]);
  }
  return worktreePath;
}

export function listLocalRepos() {
  const base = resolveBase();
  if (!existsSync(base)) return [];
  let entries;
  try {
    entries = readdirSync(base, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(e => e.isDirectory() && !e.name.endsWith('-worktrees'))
    .map(e => e.name)
    .filter(name => existsSync(join(resolveBase(), name, '.git')));
}

export async function listAllBranchesAcrossRepos() {
  const repos = listLocalRepos();
  const result = {};
  await Promise.all(repos.map(async repoName => {
    const repoPath = getRepoPath(repoName);
    try {
      const git = simpleGit(repoPath);
      const out = await git.raw([
        'for-each-ref',
        '--format=%(refname:short)',
        'refs/heads/',
        'refs/remotes/origin/'
      ]);
      const branches = new Set();
      for (const raw of out.trim().split('\n')) {
        const name = raw.trim();
        if (!name || name.endsWith('/HEAD')) continue;
        branches.add(name.replace(/^origin\//, ''));
      }
      result[repoName] = [...branches];
    } catch {
      result[repoName] = [];
    }
  }));
  return result;
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
