# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Dev commands

```bash
# Install all dependencies (root + server + client)
npm run install:all

# Run both server and client in parallel
npm run dev

# Run individually
npm run dev:server   # Express on :3001
npm run dev:client   # Vite on :5173
```

There are no tests or lint scripts configured.

## Architecture

This is a two-process app: an Express server (`server/`) and a React+Vite client (`client/`). In dev, Vite proxies all `/api/*` requests to `:3001`, so the client never makes cross-origin calls.

### Data flow

1. On load, the client fetches `/api/config` and `/api/repos` in parallel, then `/api/github/items` and `/api/jira/items`.
2. It then fetches `/api/worktrees` (a single call that lists worktrees across every repo under `LOCAL_REPO_BASE`) to hydrate worktree status.
3. All items are categorized and filtered client-side based on the selected energy level.
4. Worktrees on disk whose branch doesn't match any active item are shown in a "Stale worktrees" section under the categories grid.

### Energy filter

Each item has an `effort` field (`small` | `medium` | `large`). The energy selector controls which efforts are visible:
- **Low** → small only
- **Medium** → small + medium
- **High** → all

### Work item shape

```js
{
  id, title, description, url,
  source: 'github-pr' | 'github-issue' | 'jira',
  category: 'code-review' | 'bug' | 'task' | 'docs' | <spotlightProject.toLowerCase()>,
  effort: 'small' | 'medium' | 'large',
  repo,        // "owner/repo-name" (GitHub) or just "repo-name" (Jira auto-match)
  repoName,    // just "repo-name" — used for worktree API calls
  branch,      // PR head ref (GitHub PR) or matched local branch (Jira); null otherwise
  subtitle,    // "Review requested" / "Changes requested" / Jira status name

  // Jira-only fields:
  suggestedBranch, // `{KEY}-{slug-of-summary}` — used when no local branch matches
  branchMatches,   // [{ repoName, branch }] — every local branch whose name contains the Jira key
  projectKey,      // e.g. "SOC" — used by the client to remember repo picks per-project
}
```

### GitHub integration

`server/services/github.js` uses the **`gh` CLI** via `spawn('gh', ['api', endpoint], { shell: true })` — no token config required, just `gh auth login`. Two-to-three searches run in parallel: review-requested PRs, my PRs with changes-requested, and (when `GITHUB_INCLUDE_ISSUES` is not `false`) assigned issues. PRs then get a second detail call to retrieve the branch name and additions/deletions for effort estimation.

### Jira integration

`server/services/jira.js` calls the Jira REST API v3 directly with Basic auth. `JIRA_SPOTLIGHT_PROJECT` (e.g. `SOC`) causes issues from that project to bypass bug/docs type detection and land in their own category column. The category ID is `spotlightProject.toLowerCase()`. The frontend fetches this value from `/api/config` on mount and appends the column dynamically.

After fetching issues, the service calls `listAllBranchesAcrossRepos()` once and scans every local branch for a word-boundary match on each issue key (e.g. `SOC-123`). If exactly one repo has a matching branch, `repoName` + `branch` are prefilled so the issue gets a worktree button identical to a GitHub PR. Otherwise the issue ships with `suggestedBranch` (synthesized as `{KEY}-{slug-of-summary}`) and the client renders a repo picker; the choice is remembered per-project in `localStorage` under `jiraProjectRepo:{KEY}`.

### Git worktree integration

`server/services/git.js` uses `simple-git`. The local repo is expected at `{LOCAL_REPO_BASE}/{repoName}`. Worktrees are created at `{LOCAL_REPO_BASE}/{repoName}-worktrees/{branch}` (slashes in branch names become dashes). `createWorktree` fetches `origin`, then handles three cases:
1. Branch exists locally → `git worktree add {path} {branch}`.
2. Only `origin/{branch}` exists → `git worktree add --track -b {branch} {path} origin/{branch}`.
3. Neither exists → `git worktree add -b {branch} {path}` (new branch from current HEAD), used when creating a worktree for a fresh Jira ticket.

Other helpers in this module:
- `listAllWorktrees()` — scans `{LOCAL_REPO_BASE}` for `*-worktrees` directories and returns every worktree across all repos, each tagged with `repoName`. Backs `GET /api/worktrees`.
- `listLocalRepos()` — returns the names of all git repos directly under `{LOCAL_REPO_BASE}`. Backs `GET /api/repos`.
- `listAllBranchesAcrossRepos()` — `{ repoName: [branch, ...] }`, deduped and stripped of `origin/` prefix. Used by Jira auto-match.
- `openInCode(path)` — launches VS Code via `open -a "Visual Studio Code"` with a minimal env (`HOME` + a stock `PATH`) so Launch Services starts it with the user's login env, not the dev server's nvm-modified one. Backs `POST /api/worktrees/open`.

## Environment

Copy `.env.example` to `.env` at the repo root. The server loads it from `../  .env` relative to `server/`. Key vars:

| Var | Purpose |
|---|---|
| `JIRA_HOST` | e.g. `yourco.atlassian.net` |
| `JIRA_EMAIL` / `JIRA_API_TOKEN` | Basic auth for Jira REST API |
| `JIRA_PROJECT_KEYS` | Comma-separated keys to filter JQL results |
| `JIRA_SPOTLIGHT_PROJECT` | Project key that gets its own category column |
| `LOCAL_REPO_BASE` | Parent dir of local repos; defaults to `~/development` |
| `GITHUB_INCLUDE_ISSUES` | Set to `false` to skip the assigned-issues fetch; PRs only. Defaults to `true` |
