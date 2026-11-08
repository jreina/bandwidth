// Case-insensitive partial match. Every whitespace-separated term must appear
// somewhere in the item's text: title, key, repo#number, branch, worktree path,
// note, or Claude session titles.

export function parseQuery(query) {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

function haystack(item, worktree, annotation) {
  return [
    item.title,
    item.key,
    item.repo,
    item.number != null && `#${item.number}`,
    item.number != null && item.repo && `${item.repo}#${item.number}`,
    item.branch,
    item.suggestedBranch,
    item.subtitle,
    worktree?.path,
    worktree?.branch,
    annotation?.note,
    ...(worktree?.claudeSessions ?? []).map(s => s.title)
  ].filter(Boolean).join('\n').toLowerCase();
}

export function matches(terms, item, worktree, annotation) {
  if (terms.length === 0) return true;
  const text = haystack(item, worktree, annotation);
  return terms.every(t => text.includes(t));
}

export function worktreeMatches(terms, wt) {
  return matches(terms, { title: wt.branch, repo: wt.repoName, branch: wt.branch }, wt, null);
}
