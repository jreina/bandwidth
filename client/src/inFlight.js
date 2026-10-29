const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
export const STALE_AFTER_DAYS = 7;
// Idle this long and it's probably abandoned — collapsed rather than mixed in with live work
export const DORMANT_AFTER_DAYS = 90;

const PR_STATE_SIGNALS = {
  'changes-requested': { label: 'Changes requested', tone: 'alert' },
  'approved':          { label: 'Approved — merge it', tone: 'good' },
  'awaiting-review':   { label: 'Awaiting review', tone: 'muted' },
  'draft':             { label: 'Draft', tone: 'muted' }
};

function ageLabel(ms) {
  if (ms >= 365 * DAY) return `${Math.floor(ms / (365 * DAY))}y ago`;
  if (ms >= DAY) return `${Math.floor(ms / DAY)}d ago`;
  if (ms >= HOUR) return `${Math.floor(ms / HOUR)}h ago`;
  return 'just now';
}

function latestTimestamp(...isoStrings) {
  const times = isoStrings.map(s => Date.parse(s)).filter(t => !Number.isNaN(t));
  return times.length ? Math.max(...times) : null;
}

function describe(item, worktree, now) {
  const signals = [];

  const prSignal = PR_STATE_SIGNALS[item.prState];
  if (prSignal) signals.push(prSignal);
  if (item.checks === 'failing') signals.push({ label: 'CI failing', tone: 'alert' });
  else if (item.checks === 'pending') signals.push({ label: 'CI running', tone: 'muted' });
  if (item.conflicts) signals.push({ label: 'Merge conflicts', tone: 'alert' });
  if (item.inProgress && item.subtitle) signals.push({ label: item.subtitle, tone: 'muted' });
  if (worktree?.dirtyCount) {
    const n = worktree.dirtyCount;
    signals.push({ label: `${n} uncommitted file${n !== 1 ? 's' : ''}`, tone: 'warn' });
  }

  const lastTouched = latestTimestamp(item.updatedAt, worktree?.lastCommitAt, worktree?.lastEditAt);
  const idleMs = lastTouched ? now - lastTouched : null;
  const stale = idleMs !== null && idleMs > STALE_AFTER_DAYS * DAY;
  if (idleMs !== null) {
    signals.push({ label: `Last activity ${ageLabel(idleMs)}`, tone: stale ? 'warn' : 'muted' });
  }

  // Something you can act on right now: fix feedback/CI/conflicts, or merge
  const needsAction = signals.some(s => s.tone === 'alert' || s.tone === 'good');
  const dormant = idleMs !== null && idleMs > DORMANT_AFTER_DAYS * DAY;
  return { item, worktree, signals, needsAction, stale, dormant, idleMs };
}

// Work you've already started: your open PRs, Jira issues in an in-progress
// status, anything with a worktree, and ad-hoc worktrees with uncommitted changes.
export function buildInFlight(items, worktrees, now = Date.now()) {
  const entries = [];
  const itemIds = new Set();
  const worktreeKeys = new Set();

  for (const item of items) {
    const key = item.repoName && item.branch ? `${item.repoName}/${item.branch}` : null;
    const worktree = key ? worktrees[key] : null;
    if (!(item.role === 'author' || item.inProgress || worktree)) continue;
    itemIds.add(item.id);
    if (worktree) worktreeKeys.add(key);
    entries.push(describe(item, worktree, now));
  }

  for (const [key, wt] of Object.entries(worktrees)) {
    if (worktreeKeys.has(key) || !wt.dirtyCount) continue;
    worktreeKeys.add(key);
    entries.push(describe({
      id: `worktree-${key}`,
      title: wt.branch,
      source: 'worktree',
      repo: wt.repoName,
      repoName: wt.repoName,
      branch: wt.branch,
      subtitle: 'Local work with no matching PR or ticket'
    }, wt, now));
  }

  // Actionable first, then the longest-neglected
  entries.sort((a, b) =>
    (b.needsAction - a.needsAction) ||
    (b.stale - a.stale) ||
    ((b.idleMs ?? 0) - (a.idleMs ?? 0))
  );

  return {
    entries: entries.filter(e => !e.dormant),
    dormant: entries.filter(e => e.dormant),
    itemIds,
    worktreeKeys
  };
}
