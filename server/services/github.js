import { spawn } from 'child_process';

function ghApi(endpoint) {
  return new Promise((resolve, reject) => {
    const child = spawn('gh', ['api', endpoint], { shell: true });
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

export async function getGitHubItems() {
  const items = [];

  // @me is resolved by gh CLI to the authenticated user — no token config needed
  const [reviewRes, myPRRes, issueRes] = await Promise.allSettled([
    ghApi('search/issues?q=is:pr+state:open+review-requested:@me&per_page=50'),
    ghApi('search/issues?q=is:pr+state:open+author:@me+review:changes_requested&per_page=25'),
    ghApi('search/issues?q=is:issue+state:open+assignee:@me&per_page=50')
  ]);

  const reviewPRs = reviewRes.status === 'fulfilled' ? reviewRes.value.items : [];
  const myPRs = myPRRes.status === 'fulfilled' ? myPRRes.value.items : [];
  const assignedIssues = issueRes.status === 'fulfilled' ? issueRes.value.items : [];

  // Deduplicate by URL
  const allPRItems = [...reviewPRs];
  const seen = new Set(reviewPRs.map(p => p.html_url));
  for (const pr of myPRs) {
    if (!seen.has(pr.html_url)) allPRItems.push(pr);
  }

  // Fetch full PR details for branch name + additions/deletions
  const prDetails = await Promise.allSettled(
    allPRItems.map(async (item) => {
      const r = repoFromUrl(item.repository_url);
      if (!r) return null;
      const pr = await ghApi(`repos/${r.owner}/${r.repo}/pulls/${item.number}`);
      const isReviewer = reviewPRs.some(p => p.html_url === item.html_url);
      return { pr, owner: r.owner, repo: r.repo, isReviewer };
    })
  );

  for (const result of prDetails) {
    if (result.status !== 'fulfilled' || !result.value) continue;
    const { pr, owner, repo, isReviewer } = result.value;
    const changes = (pr.additions || 0) + (pr.deletions || 0);
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
      subtitle: isReviewer ? 'Review requested' : 'Changes requested',
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
      updatedAt: issue.updated_at
    });
  }

  return items;
}
