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

// Atlassian Document Format → plain text with light markdown
function adfToText(node) {
  if (!node) return '';
  if (node.type === 'text') return node.text;
  if (node.type === 'hardBreak') return '\n';
  if (['mention', 'emoji'].includes(node.type)) return node.attrs?.text ?? '';
  if (['inlineCard', 'blockCard'].includes(node.type)) return node.attrs?.url ?? '';
  const inner = (node.content || []).map(adfToText).join('');
  switch (node.type) {
    case 'paragraph': return inner + '\n\n';
    case 'heading': return `${'#'.repeat(node.attrs?.level ?? 3)} ${inner}\n\n`;
    case 'listItem': return `- ${inner.trim().replace(/\n+/g, '\n  ')}\n`;
    case 'bulletList':
    case 'orderedList': return inner + '\n';
    case 'codeBlock': return '```\n' + inner + '\n```\n\n';
    case 'blockquote': return inner.trim().split('\n').map(l => `> ${l}`).join('\n') + '\n\n';
    default: return inner;
  }
}

// Full detail for one issue, for handing off to Claude
export async function getJiraIssueDetail(key) {
  const { JIRA_HOST, JIRA_EMAIL, JIRA_API_TOKEN } = process.env;
  if (!JIRA_HOST || !JIRA_EMAIL || !JIRA_API_TOKEN) throw new Error('Jira is not configured');

  const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');
  const fields = 'summary,description,issuetype,priority,status,labels,parent,comment';
  const res = await fetch(`https://${JIRA_HOST}/rest/api/3/issue/${encodeURIComponent(key)}?fields=${fields}`, {
    headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' }
  });
  if (!res.ok) throw new Error(`Jira API error ${res.status} fetching ${key}`);
  const { fields: f } = await res.json();

  return {
    key,
    url: `https://${JIRA_HOST}/browse/${key}`,
    summary: f.summary,
    type: f.issuetype?.name ?? null,
    status: f.status?.name ?? null,
    priority: f.priority?.name ?? null,
    labels: f.labels ?? [],
    parent: f.parent ? `${f.parent.key}: ${f.parent.fields?.summary ?? ''}` : null,
    description: adfToText(f.description).trim(),
    comments: (f.comment?.comments ?? []).slice(-5).map(c => ({
      author: c.author?.displayName ?? 'Unknown',
      created: c.created,
      body: adfToText(c.body).trim()
    }))
  };
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
