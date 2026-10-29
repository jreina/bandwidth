import { spawn } from 'child_process';

function ghApi(endpoint) {
  return new Promise((resolve, reject) => {
    const child = spawn('gh', ['api', endpoint]);
    let stdout = '', stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('close', code => {
      if (code !== 0) reject(new Error(stderr.trim() || `gh api exited with code ${code}`));
      else {
        try { resolve(JSON.parse(stdout)); }
        catch { reject(new Error('Failed to parse gh api response')); }
      }
    });
    child.on('error', reject);
  });
}

function repoFromUrl(repositoryUrl) {
  const match = repositoryUrl.match(/repos\/([^/]+)\/([^/]+)$/);
  return match ? { owner: match[1], repo: match[2] } : null;
}

function inferCategoryFromLabels(labels) {
  if (labels.some(l => l.includes('bug') || l.includes('fix'))) return 'bug';
  if (labels.some(l => l.includes('doc'))) return 'docs';
  return 'task';
}

function summarizeChecks(checkRuns) {
  if (!checkRuns?.length) return null;
  const failed = ['failure', 'timed_out', 'cancelled', 'action_required'];
  if (checkRuns.some(r => failed.includes(r.conclusion))) return 'failing';
  if (checkRuns.some(r => r.status !== 'completed')) return 'pending';
  return 'passing';
}

const AUTHORED_SUBTITLES = {
  'draft': 'Your draft PR',
  'changes-requested': 'Changes requested',
  'approved': 'Approved',
  'awaiting-review': 'Awaiting review'
};

export async function getGitHubItems() {
  const items = [];
  const includeIssues = process.env.GITHUB_INCLUDE_ISSUES !== 'false';

  // @me is resolved by gh CLI to the authenticated user — no token config needed
  const calls = [
    ghApi('search/issues?q=is:pr+state:open+review-requested:@me&per_page=50'),
    ghApi('search/issues?q=is:pr+state:open+author:@me&per_page=50'),
    ghApi('search/issues?q=is:pr+state:open+author:@me+review:changes_requested&per_page=50'),
    ghApi('search/issues?q=is:pr+state:open+author:@me+review:approved&per_page=50')
  ];
  if (includeIssues) {
    calls.push(ghApi('search/issues?q=is:issue+state:open+assignee:@me&per_page=50'));
  }
  const [reviewRes, myPRRes, changesRes, approvedRes, issueRes] = await Promise.allSettled(calls);

  const reviewPRs = reviewRes.status === 'fulfilled' ? reviewRes.value.items : [];
  const myPRs = myPRRes.status === 'fulfilled' ? myPRRes.value.items : [];
  const changesRequested = new Set(
    changesRes.status === 'fulfilled' ? changesRes.value.items.map(p => p.html_url) : []
  );
  const approved = new Set(
    approvedRes.status === 'fulfilled' ? approvedRes.value.items.map(p => p.html_url) : []
  );
  const assignedIssues = issueRes?.status === 'fulfilled' ? issueRes.value.items : [];

  // Deduplicate by URL
  const allPRItems = [...reviewPRs];
  const seen = new Set(reviewPRs.map(p => p.html_url));
  for (const pr of myPRs) {
    if (!seen.has(pr.html_url)) allPRItems.push(pr);
  }

  // Fetch full PR details for branch name + additions/deletions, and CI status for authored PRs
  const prDetails = await Promise.allSettled(
    allPRItems.map(async (item) => {
      const r = repoFromUrl(item.repository_url);
      if (!r) return null;
      const pr = await ghApi(`repos/${r.owner}/${r.repo}/pulls/${item.number}`);
      const isReviewer = reviewPRs.some(p => p.html_url === item.html_url);
      let checks = null;
      if (!isReviewer) {
        try {
          const res = await ghApi(`repos/${r.owner}/${r.repo}/commits/${pr.head.sha}/check-runs`);
          checks = summarizeChecks(res.check_runs);
        } catch {}
      }
      return { pr, owner: r.owner, repo: r.repo, isReviewer, checks };
    })
  );

  for (const result of prDetails) {
    if (result.status !== 'fulfilled' || !result.value) continue;
    const { pr, owner, repo, isReviewer, checks } = result.value;
    const changes = (pr.additions || 0) + (pr.deletions || 0);
    const prState = isReviewer ? null
      : pr.draft ? 'draft'
      : changesRequested.has(pr.html_url) ? 'changes-requested'
      : approved.has(pr.html_url) ? 'approved'
      : 'awaiting-review';
    items.push({
      id: `github-pr-${owner}-${repo}-${pr.number}`,
      title: pr.title,
      description: (pr.body || '').slice(0, 200),
      url: pr.html_url,
      source: 'github-pr',
      category: 'code-review',
      effort: changes < 100 ? 'small' : changes < 500 ? 'medium' : 'large',
      repo: `${owner}/${repo}`,
      repoName: repo,
      branch: pr.head.ref,
      number: pr.number,
      author: pr.user?.login,
      role: isReviewer ? 'reviewer' : 'author',
      prState,
      checks,
      conflicts: pr.mergeable_state === 'dirty',
      subtitle: isReviewer ? 'Review requested' : AUTHORED_SUBTITLES[prState],
      createdAt: pr.created_at,
      updatedAt: pr.updated_at
    });
  }

  for (const issue of assignedIssues) {
    const r = repoFromUrl(issue.repository_url);
    if (!r) continue;
    const labels = issue.labels.map(l => l.name.toLowerCase());
    items.push({
      id: `github-issue-${r.owner}-${r.repo}-${issue.number}`,
      title: issue.title,
      description: (issue.body || '').slice(0, 200),
      url: issue.html_url,
      source: 'github-issue',
      category: inferCategoryFromLabels(labels),
      effort: 'medium',
      repo: `${r.owner}/${r.repo}`,
      repoName: r.repo,
      branch: null,
      number: issue.number,
      createdAt: issue.created_at,
      updatedAt: issue.updated_at
    });
  }

  return items;
}
