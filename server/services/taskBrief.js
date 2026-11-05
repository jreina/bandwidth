import { getJiraIssueDetail } from './jira.js';

// The opening prompt for a Claude session assigned to a work item. Jira details
// are fetched here with the server's credentials; for GitHub, Claude runs `gh`
// itself (already authenticated) so it sees the latest comments and CI state.

const WORKING_AGREEMENT = `## How to work
1. Read the task and explore the relevant code before changing anything.
2. If the requirements are ambiguous, or a decision has real tradeoffs, stop and ask me. Don't guess on product decisions.
3. Make the change following the repo's existing conventions, and run its tests, linters or build if it has them.
4. Commit your work to this branch when it's in a good state.
5. Don't push, open or update a PR, post GitHub comments, or change the Jira issue without asking me first.
6. Finish with a short summary: what you changed, how you verified it, and anything still open.`;

function jiraBrief(issue, worktree) {
  const meta = [
    issue.type && `Type: ${issue.type}`,
    issue.status && `Status: ${issue.status}`,
    issue.priority && `Priority: ${issue.priority}`,
    issue.labels.length > 0 && `Labels: ${issue.labels.join(', ')}`,
    issue.parent && `Parent: ${issue.parent}`
  ].filter(Boolean).join('\n');

  const comments = issue.comments.length > 0
    ? `\n\n### Recent comments\n\n${issue.comments.map(c =>
        `**${c.author}** (${c.created.slice(0, 10)}):\n${c.body}`).join('\n\n')}`
    : '';

  return `You've been assigned Jira issue ${issue.key}: ${issue.summary}
${issue.url}

You're in a git worktree for this issue at \`${worktree.path}\`, on branch \`${worktree.branch}\`.

## Issue

${meta}

### Description

${issue.description || '_No description provided._'}${comments}

${WORKING_AGREEMENT.replace("when it's in a good state.", `when it's in a good state, with a message that references ${issue.key}.`)}`;
}

function githubIssueBrief(item, worktree) {
  return `You've been assigned GitHub issue ${item.repo}#${item.number}: ${item.title}
${item.url}

You're in a git worktree at \`${worktree.path}\`, on branch \`${worktree.branch}\`.

Start by reading the full issue and its discussion:
\`gh issue view ${item.number} --repo ${item.repo} --comments\`

${WORKING_AGREEMENT}`;
}

function authoredPrBrief(item, worktree) {
  return `Pick up my pull request ${item.repo}#${item.number}: ${item.title}
${item.url}

You're in a git worktree checked out on the PR branch \`${worktree.branch}\` at \`${worktree.path}\`.

Find out what's blocking it and fix it:
- Review feedback: \`gh pr view ${item.number} --repo ${item.repo} --comments\`, plus inline comments via \`gh api repos/${item.repo}/pulls/${item.number}/comments\`
- CI: \`gh pr checks ${item.number} --repo ${item.repo}\`
- Merge conflicts with the base branch: ask me before rebasing or merging.

Work through the feedback one item at a time. If you disagree with a comment, tell me why rather than silently skipping it.

${WORKING_AGREEMENT}`;
}

function reviewPrBrief(item, worktree) {
  return `I've been asked to review pull request ${item.repo}#${item.number}: ${item.title}
${item.url}

You're in a git worktree checked out on the PR branch \`${worktree.branch}\` at \`${worktree.path}\`.

Help me review it:
1. Read the description and discussion: \`gh pr view ${item.number} --repo ${item.repo} --comments\`
2. Read the diff: \`gh pr diff ${item.number} --repo ${item.repo}\`, and the surrounding code it touches.
3. Run the tests or build if that's practical.
4. Give me your findings, most important first: correctness bugs, risky changes, missing tests, then smaller suggestions. Point to file and line.

Don't modify code, and don't post a review or comments on GitHub. I'll decide what to send.`;
}

export async function buildTaskBrief(item, worktree) {
  switch (item.source) {
    case 'jira':
      return jiraBrief(await getJiraIssueDetail(item.key), worktree);
    case 'github-issue':
      return githubIssueBrief(item, worktree);
    case 'github-pr':
      return item.role === 'reviewer' ? reviewPrBrief(item, worktree) : authoredPrBrief(item, worktree);
    default:
      throw new Error(`Can't assign a ${item.source} item to Claude`);
  }
}

export function sessionName(item) {
  const label = item.source === 'jira' ? item.title : `${item.repo}#${item.number} ${item.title}`;
  // Single line, no control characters, short enough for a terminal title
  return label.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 80);
}
