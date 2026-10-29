import { listAllBranchesAcrossRepos } from './git.js';

function slugify(s) {
  return (s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function findBranchMatches(key, branchesByRepo) {
  const re = new RegExp(`(^|[^a-z0-9])${key.toLowerCase()}([^0-9]|$)`);
  const matches = [];
  for (const [repoName, branches] of Object.entries(branchesByRepo)) {
    for (const branch of branches) {
      if (re.test(branch.toLowerCase())) {
        matches.push({ repoName, branch });
      }
    }
  }
  return matches;
}

export async function getJiraItems() {
  const { JIRA_HOST, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEYS } = process.env;
  if (!JIRA_HOST || !JIRA_EMAIL || !JIRA_API_TOKEN) return [];

  const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');
  const projectClause = JIRA_PROJECT_KEYS
    ? ` AND project in (${JIRA_PROJECT_KEYS})`
    : '';
  const jql = `assignee = currentUser() AND status not in (Done, Closed, Resolved)${projectClause} ORDER BY updated DESC`;

  const url = `https://${JIRA_HOST}/rest/api/3/search/jql?jql=${encodeURIComponent(jql)}&maxResults=50&fields=summary,description,issuetype,priority,status,labels,customfield_10016,updated,created`;

  let res;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' }
    });
  } catch (err) {
    console.error('Jira fetch error:', err.message);
    return [];
  }

  if (!res.ok) {
    console.error('Jira API error:', res.status);
    return [];
  }

  const data = await res.json();

  let branchesByRepo = {};
  try {
    branchesByRepo = await listAllBranchesAcrossRepos();
  } catch {}

  return data.issues.map(issue => {
    const points = issue.fields.customfield_10016;
    let effort = 'medium';
    if (typeof points === 'number') {
      effort = points <= 2 ? 'small' : points <= 5 ? 'medium' : 'large';
    }

    const typeName = (issue.fields.issuetype?.name || '').toLowerCase();
    const spotlightProject = process.env.JIRA_SPOTLIGHT_PROJECT?.toUpperCase();
    const projectKey = issue.key.split('-')[0].toUpperCase();

    let category = 'task';
    if (spotlightProject && projectKey === spotlightProject) {
      category = spotlightProject.toLowerCase();
    } else if (typeName.includes('bug')) {
      category = 'bug';
    } else if (typeName.includes('doc')) {
      category = 'docs';
    }

    const bodyText = issue.fields.description?.content?.[0]?.content?.[0]?.text || '';

    const suggestedBranch = `${issue.key}-${slugify(issue.fields.summary)}`;
    const matches = findBranchMatches(issue.key, branchesByRepo);
    const single = matches.length === 1 ? matches[0] : null;

    return {
      id: `jira-${issue.key}`,
      title: `[${issue.key}] ${issue.fields.summary}`,
      description: bodyText.slice(0, 200),
      url: `https://${JIRA_HOST}/browse/${issue.key}`,
      source: 'jira',
      category,
      effort,
      repo: single ? single.repoName : null,
      repoName: single ? single.repoName : null,
      branch: single ? single.branch : null,
      suggestedBranch,
      branchMatches: matches,
      projectKey,
      key: issue.key,
      subtitle: issue.fields.status?.name,
      inProgress: issue.fields.status?.statusCategory?.key === 'indeterminate',
      priority: issue.fields.priority?.name ?? null,
      createdAt: issue.fields.created,
      updatedAt: issue.fields.updated
    };
  });
}
