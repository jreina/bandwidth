# Attention Budget

A personal dashboard that asks *"what do you have energy to work on?"* — pulls your open GitHub PRs, review requests, and Jira tickets into one view, filtered by how much focus you have right now.

## Prerequisites

- Node.js 18+
- [gh CLI](https://cli.github.com/) — run `gh auth login` once before starting

## Setup

```bash
# 1. Install dependencies
npm run install:all

# 2. Configure
cp .env.example .env
# Edit .env with your Jira credentials and paths
```

## Running

```bash
npm run dev
```

Opens at `http://localhost:5173`. The Express API runs on `:3001`.

## Configuration (`.env`)

| Variable | Description |
|---|---|
| `JIRA_HOST` | Your Jira domain, e.g. `yourco.atlassian.net` |
| `JIRA_EMAIL` | Your Atlassian account email |
| `JIRA_API_TOKEN` | API token from [id.atlassian.com](https://id.atlassian.com/manage-profile/security/api-tokens) |
| `JIRA_PROJECT_KEYS` | Comma-separated project keys to include, e.g. `PROJ,API` |
| `JIRA_SPOTLIGHT_PROJECT` | A project key that gets its own dedicated column, e.g. `SOC` |
| `LOCAL_REPO_BASE` | Parent directory of your local git repos (default: `~/development`) |
| `GITHUB_INCLUDE_ISSUES` | Set to `false` to hide assigned GitHub issues and only show PRs (default: `true`) |

GitHub auth is handled entirely by the `gh` CLI — no token needed in `.env`.

## How it works

**Energy selector** — choose Low, Medium, or High. This filters items by estimated effort:
- Low → small items only (PRs under 100 lines, Jira tickets ≤ 2 points)
- Medium → small + medium
- High → everything

**Categories** — items are bucketed into Code Review, Bugs, Tasks, and Docs based on PR labels and Jira issue types. If `JIRA_SPOTLIGHT_PROJECT` is set, that project gets its own column.

**Git worktrees** — GitHub PRs have a "Create worktree" button. Clicking it runs `git worktree add` so you can context-switch between tasks without stashing. The worktree path is shown on the card; "Remove worktree" cleans it up. Worktrees are created at `{LOCAL_REPO_BASE}/{repo-name}-worktrees/{branch-name}`.
