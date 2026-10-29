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

1. On load, the client fetches `/api/config` and `/api/repos` in parallel, then `/api/github/items`, `/api/jira/items` and `/api/state`.
2. It then fetches `/api/worktrees` (a single call that lists worktrees across every repo under `LOCAL_REPO_BASE`) to hydrate worktree status.
3. `buildInFlight()` (`client/src/inFlight.js`) pulls already-started work out of the categories into an **In flight** lane at the top: pinned items, commitments, your open PRs, Jira issues whose status category is "In Progress", any item with a worktree, and ad-hoc worktrees with uncommitted changes. Snoozed items (from anywhere) go to a collapsed "Snoozed" section until their snooze ends. Entries carry signals (due date, PR state, CI, conflicts, uncommitted files, last activity) and are sorted pinned-first, then actionable, then most neglected. Pinned items and commitments never go dormant. Entries idle more than 7 days are flagged as stalled; entries idle more than 90 days are collapsed under "dormant".
4. The remaining items are sorted by `byUrgency()` (`client/src/urgency.js`: review requests first, then Jira priority, then oldest first) and grouped into category columns. Nothing is filtered out.
5. Worktrees on disk with no uncommitted changes, no running Claude session, and no matching item are shown in a "Stale worktrees" section under the categories grid.

### Work item shape

```js
{
  id, title, description, url,
  source: 'github-pr' | 'github-issue' | 'jira',
  category: 'code-review' | 'bug' | 'task' | 'docs' | <spotlightProject.toLowerCase()>,
  effort: 'small' | 'medium' | 'large',  // shown as a badge only
  repo,        // "owner/repo-name" (GitHub) or just "repo-name" (Jira auto-match)
  repoName,    // just "repo-name" — used for worktree API calls
  branch,      // PR head ref (GitHub PR) or matched local branch (Jira); null otherwise
  subtitle,    // "Review requested" / "Changes requested" / Jira status name
  createdAt,   // used as "waiting since" for urgency sorting
  updatedAt,

  // Jira-only fields:
  suggestedBranch, // `{KEY}-{slug-of-summary}` — used when no local branch matches
  branchMatches,   // [{ repoName, branch }] — every local branch whose name contains the Jira key
  projectKey,      // e.g. "SOC" — used by the client to remember repo picks per-project
  inProgress,      // status category is "In Progress"
  priority,        // Jira priority name, e.g. "High"

  // GitHub PR-only fields:
  role,            // 'reviewer' | 'author'
  prState,         // authored only: 'draft' | 'changes-requested' | 'approved' | 'awaiting-review'
  checks,          // authored only: 'failing' | 'pending' | 'passing' | null (from check-runs)
  conflicts,       // mergeable_state === 'dirty'
}
```

### GitHub integration

`server/services/github.js` uses the **`gh` CLI** via `spawn('gh', ['api', endpoint])` — no token config required, just `gh auth login`. (No shell, so `&` in query strings reaches `gh` intact.) Searches run in parallel: review-requested PRs, all my open PRs, my PRs with changes-requested, my approved PRs, and (when `GITHUB_INCLUDE_ISSUES` is not `false`) assigned issues. PRs then get a detail call for branch name, additions/deletions (effort) and merge conflicts; authored PRs also get a check-runs call for CI status.

### Jira integration

`server/services/jira.js` calls the Jira REST API v3 directly with Basic auth. `JIRA_SPOTLIGHT_PROJECT` (e.g. `SOC`) causes issues from that project to bypass bug/docs type detection and land in their own category column. The category ID is `spotlightProject.toLowerCase()`. The frontend fetches this value from `/api/config` on mount and appends the column dynamically.

After fetching issues, the service calls `listAllBranchesAcrossRepos()` once and scans every local branch for a word-boundary match on each issue key (e.g. `SOC-123`). If exactly one repo has a matching branch, `repoName` + `branch` are prefilled so the issue gets a worktree button identical to a GitHub PR. Otherwise the issue ships with `suggestedBranch` (synthesized as `{KEY}-{slug-of-summary}`) and the client renders a repo picker; the choice is remembered per-project in `localStorage` under `jiraProjectRepo:{KEY}`.

### Git worktree integration

`server/services/git.js` uses `simple-git`. The local repo is expected at `{LOCAL_REPO_BASE}/{repoName}`. Worktrees are created at `{LOCAL_REPO_BASE}/{repoName}-worktrees/{branch}` (slashes in branch names become dashes). `createWorktree` fetches `origin`, then handles three cases:
1. Branch exists locally → `git worktree add {path} {branch}`.
2. Only `origin/{branch}` exists → `git worktree add --track -b {branch} {path} origin/{branch}`.
3. Neither exists → `git worktree add -b {branch} {path}` (new branch from current HEAD), used when creating a worktree for a fresh Jira ticket.

Other helpers in this module:
- `listAllWorktrees()` — scans `{LOCAL_REPO_BASE}` for `*-worktrees` directories and returns every worktree across all repos, each tagged with `repoName` plus activity: `dirtyCount`, `lastCommitAt`, `lastEditAt` (newest mtime of changed files). Backs `GET /api/worktrees`.
- `listLocalRepos()` — returns the names of all git repos directly under `{LOCAL_REPO_BASE}`. Backs `GET /api/repos`.
- `listAllBranchesAcrossRepos()` — `{ repoName: [branch, ...] }`, deduped and stripped of `origin/` prefix. Used by Jira auto-match.
- `openInCode(path)` — launches VS Code via `open -a "Visual Studio Code"` with a minimal env (`HOME` + a stock `PATH`) so Launch Services starts it with the user's login env, not the dev server's nvm-modified one. Backs `POST /api/worktrees/open`.

### Claude Code sessions

`server/services/claude.js` reads Claude Code's transcripts at `~/.claude/projects/*/{sessionId}.jsonl`. It reads only the first 64 KB (for `cwd` and first prompt) and the last 256 KB (for the latest `custom-title` / `ai-title` entry and last typed prompt), and caches the results by mtime and size. `GET /api/worktrees` runs through `attachClaudeSessions()`, which adds `claudeSessions` (newest first), `claudeRunning` and `lastSessionAt` to each worktree by matching session `cwd` to the worktree path. A worktree counts as running when `ps` + `lsof -d cwd` finds a `claude` process inside it; the process can't be tied to a session id, so the newest session there is the one marked `running`.

`POST /api/claude/resume { sessionId }` validates the id as a UUID, looks the session up server-side (the client never sends a path or command), and runs `osascript` to open a Terminal.app window with `cd '{cwd}' && claude --resume {id}`.

### Personal state

`server/services/store.js` keeps what GitHub/Jira don't know in `server/data/state.json` (gitignored), served under `/api/state`:
- `annotations: { [itemId]: { note, pinned, snoozedUntil, updatedAt } }`: any item can be annotated, including commitments and ad-hoc worktrees (`worktree-{repo}/{branch}`). `PUT /api/state/annotations` takes `{ id, ...patch }` (id goes in the body because it can contain slashes). `null` / `''` / `false` clear a field, and an annotation with no fields left is deleted. An annotation edit counts as activity for staleness.
- `commitments: [{ id, title, dueDate, createdAt }]`: free-text promises with an optional local `YYYY-MM-DD` due date. `POST /api/state/commitments` adds one; `DELETE /api/state/commitments/:id` marks it done (removes it and its annotation).

Writes are serialized through a promise queue and written atomically (tmp file + rename). A corrupt file errors instead of being reset.

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
