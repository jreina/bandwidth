# bandwidth

A personal dashboard that shows *what needs you*: it pulls your open GitHub PRs, review requests, and Jira tickets into one view, with work you've already started pinned at the top so it doesn't get forgotten.

This was not my original idea and I definitely stole it from [Scott Hanselman](https://github.com/shanselman). This is also 100% vibe coded so use at your own risk.

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

**In flight** — work you've already started sits in its own lane at the top: your open PRs, Jira tickets in an "In Progress" status, anything with a worktree, and local worktrees with uncommitted changes. Each card shows PR state, CI failures, merge conflicts, uncommitted files, and time since last activity. Actionable items (conflicts, failing CI, requested changes, approved-and-ready-to-merge) sort first, then the most neglected. Anything idle over 7 days is flagged as stalled, and anything idle over 90 days is collapsed under "dormant".

**Notes, pins, snoozes and commitments** — every card has:
- **Pin**: moves it into In flight, at the top. Use it for things you've promised.
- **Snooze**: hides it until tomorrow, next Monday, or two weeks out, then it comes back on its own. Snoozed items are listed in a collapsed section at the bottom so they're never lost.
- **Note**: where you left off, or the next step. Shown on the card.

The **"I said I'd…"** box in In flight adds a commitment that has no ticket, with an optional due date. Overdue commitments sort to the top. Click **Done** when it's finished. All of this is stored locally in `server/data/state.json` (gitignored).

**Categories** — everything else is sorted by urgency (review requests first since someone is blocked on you, then Jira priority, then oldest first) and bucketed into Code Review, Bugs, Tasks, and Docs based on PR labels and Jira issue types. If `JIRA_SPOTLIGHT_PROJECT` is set, that project gets its own column.

**Git worktrees** — GitHub PRs have a "Create worktree" button. Clicking it runs `git worktree add` so you can context-switch between tasks without stashing. The worktree path is shown on the card; "Remove worktree" cleans it up. "Open in Code" launches VS Code on the worktree. Worktrees are created at `{LOCAL_REPO_BASE}/{repo-name}-worktrees/{branch-name}`.

Jira items also get a worktree button. If a local branch already mentions the issue key (e.g. `feature/SOC-123-foo`), the matching repo + branch are auto-detected. Otherwise you pick a repo from a dropdown of everything under `LOCAL_REPO_BASE`, and the worktree is created on a fresh branch named `{KEY}-{slugified-summary}`. The repo you picked is remembered per Jira project, so the next ticket in that project defaults to the same repo.

**Stale worktrees** — when a PR is merged (or a Jira ticket closed) the worktree stays on disk but no longer matches an active item. Any unmatched worktrees show up in a "Stale worktrees" section at the bottom of the page with Open and Remove buttons so you can clean them up.

**Claude Code sessions**: every worktree card lists the Claude Code sessions started in it, showing each session's title, your last prompt, and how long ago it was active. A green dot marks a worktree where `claude` is running right now. **Resume** opens a Terminal.app window running `claude --resume` in that worktree; **Copy command** gives you the same command to paste anywhere. Session activity counts toward "last activity", and a worktree with Claude running shows up in In flight even if it has no matching PR or ticket.

**Assign to Claude**: Jira, PR and issue cards with a worktree get an **Assign to Claude** button (**Review with Claude** for review requests). It opens Claude Code in Terminal, inside that worktree, with the task already loaded: the full Jira issue with its recent comments, or instructions to pull PR feedback and CI status with `gh`. Claude works interactively, asks when something is unclear, and commits locally, but won't push, open PRs, post comments or change the Jira issue without asking you.

**"Open in Code" prerequisite** — the server uses `open -a "Visual Studio Code"` on macOS. VS Code must be installed in `/Applications`; the `code` CLI itself is not required.
