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

1. On load, the client fetches `/api/config`, `/api/github/items`, and `/api/jira/items` in parallel.
2. It then fetches `/api/worktrees/{repoName}` for each unique repo found in the items to hydrate worktree status.
3. All items are categorized and filtered client-side based on the selected energy level.

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
  repo,        // "owner/repo-name"
  repoName,    // just "repo-name" — used for worktree API calls
  branch,      // present on github-pr items only; null otherwise
  subtitle,    // "Review requested" / "Changes requested" / Jira status name
}
```

### GitHub integration

`server/services/github.js` uses the **`gh` CLI** via `spawn('gh', ['api', endpoint], { shell: true })` — no token config required, just `gh auth login`. Two-to-three searches run in parallel: review-requested PRs, my PRs with changes-requested, and (when `GITHUB_INCLUDE_ISSUES` is not `false`) assigned issues. PRs then get a second detail call to retrieve the branch name and additions/deletions for effort estimation.

### Jira integration

`server/services/jira.js` calls the Jira REST API v3 directly with Basic auth. `JIRA_SPOTLIGHT_PROJECT` (e.g. `SOC`) causes issues from that project to bypass bug/docs type detection and land in their own category column. The category ID is `spotlightProject.toLowerCase()`. The frontend fetches this value from `/api/config` on mount and appends the column dynamically.

### Git worktree integration

`server/services/git.js` uses `simple-git`. The local repo is expected at `{LOCAL_REPO_BASE}/{repoName}`. Worktrees are created at `{LOCAL_REPO_BASE}/{repoName}-worktrees/{branch}` (slashes in branch names become dashes). On create, it first fetches `origin/{branch}:{branch}` to ensure a local tracking branch exists, then runs `git worktree add`.

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
