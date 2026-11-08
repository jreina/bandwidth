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

function jiraConfig() {
  const { JIRA_HOST, JIRA_EMAIL, JIRA_API_TOKEN } = process.env;
  if (!JIRA_HOST || !JIRA_EMAIL || !JIRA_API_TOKEN) throw new Error('Jira is not configured');
  return { host: JIRA_HOST, auth: Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64') };
}

async function jiraFetch(path, { method = 'GET', body } = {}) {
  const { host, auth } = jiraConfig();
  const res = await fetch(`https://${host}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: 'application/json',
      ...(body && { 'Content-Type': 'application/json' })
    },
    body: body && JSON.stringify(body)
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    // Jira reports problems as { errorMessages: [...], errors: { field: message } }
    const details = [...(data?.errorMessages ?? []), ...Object.values(data?.errors ?? {})];
    throw new Error(details.length ? details.join('; ') : `Jira API error ${res.status}`);
  }
  return data;
}

// Plain text → ADF: blank lines separate paragraphs, single newlines are line breaks
function textToAdf(text) {
  const paragraphs = text.trim().split(/\n\s*\n/).map(para => ({
    type: 'paragraph',
    content: para.split('\n').flatMap((line, i) => [
      ...(i > 0 ? [{ type: 'hardBreak' }] : []),
      ...(line ? [{ type: 'text', text: line }] : [])
    ])
  }));
  return { type: 'doc', version: 1, content: paragraphs };
}

// Every board tied to a project, with the configured projects first
export async function getJiraBoards() {
  const boards = [];
  for (let startAt = 0; ; ) {
    const page = await jiraFetch(`/rest/agile/1.0/board?startAt=${startAt}&maxResults=50`);
    boards.push(...page.values);
    startAt += page.values.length;
    if (page.isLast || page.values.length === 0) break;
  }
  const preferred = (process.env.JIRA_PROJECT_KEYS || '').split(',').map(k => k.trim().toUpperCase());
  const rank = b => (preferred.includes(b.projectKey) ? 0 : 1);
  return boards
    .filter(b => b.location?.projectKey)
    .map(b => ({ id: b.id, name: b.name, type: b.type, projectKey: b.location.projectKey }))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}

const PROJECT_KEY_RE = /^[A-Z][A-Z0-9_]*$/;

export async function getJiraIssueTypes(projectKey) {
  if (!PROJECT_KEY_RE.test(projectKey)) throw new Error('Invalid project key');
  const data = await jiraFetch(`/rest/api/3/issue/createmeta/${projectKey}/issuetypes?maxResults=100`);
  return (data.issueTypes ?? data.values ?? [])
    .filter(t => !t.subtask)
    .map(t => ({ id: t.id, name: t.name }));
}

let myAccountId = null;

export async function createJiraIssue({ projectKey, issueTypeId, summary, description, assignToMe }) {
  if (!PROJECT_KEY_RE.test(projectKey ?? '')) throw new Error('Invalid project key');
  if (!/^\d+$/.test(issueTypeId ?? '')) throw new Error('Invalid issue type');
  const title = (summary ?? '').replace(/\s+/g, ' ').trim();
  if (!title) throw new Error('Summary is required');
  if (title.length > 255) throw new Error('Summary must be 255 characters or fewer');

  if (assignToMe && !myAccountId) myAccountId = (await jiraFetch('/rest/api/3/myself')).accountId;
  const fields = {
    project: { key: projectKey },
    issuetype: { id: issueTypeId },
    summary: title,
    ...(description?.trim() && { description: textToAdf(description) }),
    ...(assignToMe && { assignee: { accountId: myAccountId } })
  };
  const { key } = await jiraFetch('/rest/api/3/issue', { method: 'POST', body: { fields } });
  return { key, url: `https://${jiraConfig().host}/browse/${key}` };
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
