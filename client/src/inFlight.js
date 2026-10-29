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

export function ageLabel(ms) {
  if (ms >= 365 * DAY) return `${Math.floor(ms / (365 * DAY))}y ago`;
  if (ms >= DAY) return `${Math.floor(ms / DAY)}d ago`;
  if (ms >= HOUR) return `${Math.floor(ms / HOUR)}h ago`;
  return 'just now';
}

export function isSnoozed(annotation, now = Date.now()) {
  const until = Date.parse(annotation?.snoozedUntil);
  return !Number.isNaN(until) && until > now;
}

// dueDate is a local calendar date ("YYYY-MM-DD") from a date input
function dueSignal(dueDate, now) {
  const due = new Date(`${dueDate}T00:00`);
  if (Number.isNaN(due.getTime())) return null;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const days = Math.round((due - today) / DAY);
  if (days < 0) return { label: `Overdue by ${-days}d`, tone: 'alert' };
  if (days === 0) return { label: 'Due today', tone: 'warn' };
  if (days === 1) return { label: 'Due tomorrow', tone: 'warn' };
  return { label: `Due in ${days}d`, tone: 'muted' };
}

function commitmentItem(c) {
  return {
    id: c.id,
    title: c.title,
    source: 'commitment',
    dueDate: c.dueDate,
    createdAt: c.createdAt,
    updatedAt: c.createdAt
  };
}

function latestTimestamp(...isoStrings) {
  const times = isoStrings.map(s => Date.parse(s)).filter(t => !Number.isNaN(t));
  return times.length ? Math.max(...times) : null;
}

function describe(item, worktree, annotation, now) {
  const signals = [];

  const due = item.dueDate && dueSignal(item.dueDate, now);
  if (due) signals.push(due);

  const prSignal = PR_STATE_SIGNALS[item.prState];
  if (prSignal) signals.push(prSignal);
  if (item.checks === 'failing') signals.push({ label: 'CI failing', tone: 'alert' });
  else if (item.checks === 'pending') signals.push({ label: 'CI running', tone: 'muted' });
  if (item.conflicts) signals.push({ label: 'Merge conflicts', tone: 'alert' });
  if (item.inProgress && item.subtitle) signals.push({ label: item.subtitle, tone: 'muted' });
  if (worktree?.claudeRunning) signals.push({ label: 'Claude running', tone: 'live' });
  if (worktree?.dirtyCount) {
    const n = worktree.dirtyCount;
    signals.push({ label: `${n} uncommitted file${n !== 1 ? 's' : ''}`, tone: 'warn' });
  }

  const lastTouched = latestTimestamp(
    item.updatedAt, worktree?.lastCommitAt, worktree?.lastEditAt, worktree?.lastSessionAt,
    annotation?.updatedAt
  );
  const idleMs = lastTouched ? now - lastTouched : null;
  const stale = idleMs !== null && idleMs > STALE_AFTER_DAYS * DAY;
  if (idleMs !== null) {
    signals.push({ label: `Last activity ${ageLabel(idleMs)}`, tone: stale ? 'warn' : 'muted' });
  }

  // Something you can act on right now: fix feedback/CI/conflicts, overdue, or merge
  const needsAction = signals.some(s => s.tone === 'alert' || s.tone === 'good');
  const pinned = !!annotation?.pinned;
  // Things you've explicitly committed to never drift into the dormant pile
  const dormant = !pinned && item.source !== 'commitment' &&
    idleMs !== null && idleMs > DORMANT_AFTER_DAYS * DAY;
  return { item, worktree, annotation, signals, needsAction, pinned, stale, dormant, idleMs };
}

// Work you've already started or committed to: pinned items, your commitments,
// your open PRs, Jira issues in an in-progress status, anything with a worktree,
// and ad-hoc worktrees with uncommitted changes or a running Claude session.
// Snoozed items are set aside.
export function buildInFlight(items, worktrees, { annotations = {}, commitments = [] } = {}, now = Date.now()) {
  const entries = [];
  const snoozed = [];
  const itemIds = new Set();     // handled here (in flight or snoozed) — kept out of the categories
  const worktreeKeys = new Set(); // claimed worktrees — kept out of "stale worktrees"

  function consider(item, worktree, startedWork) {
    const annotation = annotations[item.id];
    if (isSnoozed(annotation, now)) {
      itemIds.add(item.id);
      snoozed.push({ item, worktree, annotation });
    } else if (startedWork || annotation?.pinned) {
      itemIds.add(item.id);
      entries.push(describe(item, worktree, annotation, now));
    }
  }

  for (const c of commitments) consider(commitmentItem(c), null, true);

  for (const item of items) {
    const key = item.repoName && item.branch ? `${item.repoName}/${item.branch}` : null;
    const worktree = key ? worktrees[key] : null;
    if (worktree) worktreeKeys.add(key);
    consider(item, worktree, item.role === 'author' || item.inProgress || !!worktree);
  }

  for (const [key, wt] of Object.entries(worktrees)) {
    if (worktreeKeys.has(key) || !(wt.dirtyCount || wt.claudeRunning)) continue;
    worktreeKeys.add(key);
    consider({
      id: `worktree-${key}`,
      title: wt.branch,
      source: 'worktree',
      repo: wt.repoName,
      repoName: wt.repoName,
      branch: wt.branch,
      subtitle: 'Local work with no matching PR or ticket'
    }, wt, true);
  }

  // Pinned first, then actionable, then the longest-neglected
  entries.sort((a, b) =>
    (b.pinned - a.pinned) ||
    (b.needsAction - a.needsAction) ||
    (b.stale - a.stale) ||
    ((b.idleMs ?? 0) - (a.idleMs ?? 0))
  );
  // Soonest to wake up first
  snoozed.sort((a, b) => Date.parse(a.annotation.snoozedUntil) - Date.parse(b.annotation.snoozedUntil));

  return {
    entries: entries.filter(e => !e.dormant),
    dormant: entries.filter(e => e.dormant),
    snoozed,
    itemIds,
    worktreeKeys
  };
}
