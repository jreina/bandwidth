export async function getJiraItems() {
  const { JIRA_HOST, JIRA_EMAIL, JIRA_API_TOKEN, JIRA_PROJECT_KEYS } = process.env;
  if (!JIRA_HOST || !JIRA_EMAIL || !JIRA_API_TOKEN) return [];

  const auth = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');
  const projectClause = JIRA_PROJECT_KEYS
    ? ` AND project in (${JIRA_PROJECT_KEYS})`
    : '';
  const jql = `assignee = currentUser() AND status not in (Done, Closed, Resolved)${projectClause} ORDER BY updated DESC`;

  const url = `https://${JIRA_HOST}/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=50&fields=summary,description,issuetype,priority,status,labels,customfield_10016,updated`;

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

    return {
      id: `jira-${issue.key}`,
      title: `[${issue.key}] ${issue.fields.summary}`,
      description: bodyText.slice(0, 200),
      url: `https://${JIRA_HOST}/browse/${issue.key}`,
      source: 'jira',
      category,
      effort,
      repo: null,
      repoName: null,
      branch: null,
      key: issue.key,
      subtitle: issue.fields.status?.name,
      updatedAt: issue.fields.updated
    };
  });
}
