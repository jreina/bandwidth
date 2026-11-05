import { useState, useRef } from 'react';
import { ageLabel, isSnoozed } from '../inFlight.js';
import { priorityRank, waitingSince } from '../urgency.js';
import ClaudeSessions from './ClaudeSessions.jsx';

const SOURCE_LABELS = {
  'github-pr':    'PR',
  'github-issue': 'Issue',
  'jira':         'Jira',
  'worktree':     'Local',
  'commitment':   'Commitment'
};

const ASSIGNABLE_SOURCES = new Set(['jira', 'github-pr', 'github-issue']);

function at8am(daysFromNow) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  d.setHours(8, 0, 0, 0);
  return d.toISOString();
}

function snoozeOptions() {
  const daysToMonday = ((8 - new Date().getDay()) % 7) || 7;
  return [
    { label: 'Tomorrow', until: at8am(1) },
    { label: 'Next week', until: at8am(daysToMonday) },
    { label: '2 weeks', until: at8am(14) }
  ];
}

function formatDay(iso) {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

const PROJECT_REPO_PREFIX = 'jiraProjectRepo:';

function loadRememberedRepo(projectKey) {
  if (!projectKey) return null;
  try {
    return localStorage.getItem(PROJECT_REPO_PREFIX + projectKey);
  } catch {
    return null;
  }
}

function rememberRepo(projectKey, repoName) {
  if (!projectKey || !repoName) return;
  try {
    localStorage.setItem(PROJECT_REPO_PREFIX + projectKey, repoName);
  } catch {}
}

export default function WorkItem({
  item, worktree, signals = [], stale = false, repos = [],
  annotation, onAnnotate, onDone, onCreateWorktree, onRemoveWorktree
}) {
  const [busy, setBusy] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const cancelNoteRef = useRef(false);
  const note = annotation?.note || '';
  const pinned = !!annotation?.pinned;
  const snoozed = isSnoozed(annotation);
  const [err, setErr] = useState(null);
  const [localWorktree, setLocalWorktree] = useState(undefined);

  const needsPicker = item.source === 'jira' && !item.branch && !!item.suggestedBranch;
  const matches = item.branchMatches || [];
  const pickerOptions = matches.length > 0
    ? matches.map(m => ({ repoName: m.repoName, branch: m.branch, label: `${m.repoName} · ${m.branch}` }))
    : repos.map(r => ({ repoName: r, branch: item.suggestedBranch, label: r }));

  const remembered = loadRememberedRepo(item.projectKey);
  const defaultPicked = pickerOptions.find(o => o.repoName === remembered)?.repoName
    || pickerOptions[0]?.repoName
    || '';
  const [pickedRepo, setPickedRepo] = useState(defaultPicked);

  const activeWorktree = localWorktree !== undefined ? localWorktree : worktree;

  async function toggleWorktree() {
    setBusy(true);
    setErr(null);
    try {
      if (activeWorktree) {
        const override = needsPicker
          ? { repoName: activeWorktree.repoName, branch: activeWorktree.branch }
          : {};
        await onRemoveWorktree(item, override);
        setLocalWorktree(null);
      } else {
        let override = {};
        if (needsPicker) {
          if (!pickedRepo) {
            setErr('Pick a repo first');
            setBusy(false);
            return;
          }
          const opt = pickerOptions.find(o => o.repoName === pickedRepo);
          override = { repoName: pickedRepo, branch: opt?.branch || item.suggestedBranch };
          rememberRepo(item.projectKey, pickedRepo);
        }
        const result = await onCreateWorktree(item, override);
        if (result?.error) {
          setErr(result.error);
        } else if (result?.path) {
          setLocalWorktree({
            path: result.path,
            branch: result.branch || item.branch,
            repoName: result.repoName || item.repoName
          });
        }
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function openInCode() {
    if (!activeWorktree?.path) return;
    setErr(null);
    try {
      const res = await fetch('/api/worktrees/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: activeWorktree.path })
      });
      const data = await res.json();
      if (data?.error) setErr(data.error);
    } catch (e) {
      setErr(e.message);
    }
  }

  const showWorktreeSection = !!item.branch || needsPicker;
  const canAssign = !!activeWorktree?.path && ASSIGNABLE_SOURCES.has(item.source);
  const [assignStatus, setAssignStatus] = useState(null);

  async function assignToClaude() {
    if (activeWorktree.claudeRunning &&
        !window.confirm('Claude is already running in this worktree. Start another session?')) return;
    setAssignStatus({ busy: true });
    try {
      const res = await fetch('/api/claude/assign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          worktreePath: activeWorktree.path,
          item: {
            source: item.source, key: item.key, repo: item.repo, number: item.number,
            role: item.role, title: item.title, url: item.url
          }
        })
      });
      const data = await res.json();
      setAssignStatus(data.error ? { error: data.error } : { ok: 'Claude started in Terminal' });
    } catch (e) {
      setAssignStatus({ error: e.message });
    }
  }

  function startEditingNote() {
    cancelNoteRef.current = false;
    setEditingNote(true);
  }

  function finishEditingNote(value) {
    setEditingNote(false);
    if (cancelNoteRef.current) return;
    if (value.trim() !== note) onAnnotate(item, { note: value.trim() });
  }

  return (
    <div className={`work-item ${activeWorktree ? 'has-worktree' : ''} ${stale ? 'is-stale' : ''}`}>
      <div className="item-badges">
        <span className="badge badge-source">{SOURCE_LABELS[item.source] ?? item.source}</span>
        {item.effort && <span className={`badge badge-effort ${item.effort}`}>{item.effort}</span>}
        {priorityRank(item) <= 1 && <span className="badge badge-priority">{item.priority}</span>}
        {item.role === 'reviewer' && waitingSince(item) && (
          <span className="badge badge-waiting">waiting {ageLabel(Date.now() - waitingSince(item)).replace(' ago', '')}</span>
        )}
      </div>

      {item.url ? (
        <a className="item-title" href={item.url} target="_blank" rel="noopener noreferrer">
          {item.title}
        </a>
      ) : (
        <span className="item-title">{item.title}</span>
      )}

      {signals.length > 0 ? (
        <div className="item-signals">
          {signals.map(s => (
            <span key={s.label} className={`signal signal-${s.tone}`}>{s.label}</span>
          ))}
        </div>
      ) : (
        item.subtitle && <div className="item-subtitle">{item.subtitle}</div>
      )}

      {item.description && (
        <p className="item-description">{item.description}</p>
      )}

      {item.repo && <span className="item-repo">{item.repo}</span>}

      {editingNote ? (
        <textarea
          className="item-note-editor"
          autoFocus
          rows={2}
          defaultValue={note}
          placeholder="Where you left off, or the next step"
          onBlur={e => finishEditingNote(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.blur(); }
            if (e.key === 'Escape') { cancelNoteRef.current = true; e.currentTarget.blur(); }
          }}
        />
      ) : note && (
        <p className="item-note" onClick={onAnnotate ? startEditingNote : undefined}>{note}</p>
      )}

      {onAnnotate && (
        <div className="item-actions">
          <button
            className={`item-action ${pinned ? 'active' : ''}`}
            onClick={() => onAnnotate(item, { pinned: !pinned })}
            title={pinned ? 'Unpin' : 'Pin to In flight'}
          >
            {pinned ? 'Pinned' : 'Pin'}
          </button>
          {snoozed ? (
            <button className="item-action" onClick={() => onAnnotate(item, { snoozedUntil: null })}>
              Wake (snoozed to {formatDay(annotation.snoozedUntil)})
            </button>
          ) : (
            <select
              className="item-action"
              value=""
              onChange={e => e.target.value && onAnnotate(item, { snoozedUntil: e.target.value })}
              aria-label="Snooze"
            >
              <option value="">Snooze…</option>
              {snoozeOptions().map(o => <option key={o.label} value={o.until}>{o.label}</option>)}
            </select>
          )}
          {!editingNote && (
            <button className="item-action" onClick={startEditingNote}>
              {note ? 'Edit note' : 'Add note'}
            </button>
          )}
          {onDone && (
            <button className="item-action done" onClick={() => onDone(item)}>Done</button>
          )}
        </div>
      )}

      {showWorktreeSection && (
        <div className="item-worktree">
          {activeWorktree && (
            <div className="worktree-active">
              <span className="worktree-dot" />
              <code className="worktree-path">{activeWorktree.path}</code>
            </div>
          )}
          {activeWorktree && <ClaudeSessions sessions={activeWorktree.claudeSessions} />}
          {needsPicker && !activeWorktree && (
            <div className="repo-picker">
              <div className="repo-picker-row">
                <label className="repo-picker-label">
                  {matches.length > 0 ? 'Matched repo' : 'Repo'}
                </label>
                <select
                  className="repo-picker-select"
                  value={pickedRepo}
                  onChange={e => setPickedRepo(e.target.value)}
                  disabled={busy}
                >
                  {pickerOptions.length === 0 && <option value="">No repos found</option>}
                  {pickerOptions.map(o => (
                    <option key={`${o.repoName}/${o.branch}`} value={o.repoName}>{o.label}</option>
                  ))}
                </select>
              </div>
              <code className="repo-picker-branch">
                {pickerOptions.find(o => o.repoName === pickedRepo)?.branch || item.suggestedBranch}
              </code>
            </div>
          )}
          {err && <span className="worktree-error">{err}</span>}
          <div className="worktree-actions">
            <button
              className={`worktree-btn ${activeWorktree ? 'remove' : 'create'}`}
              onClick={toggleWorktree}
              disabled={busy || (needsPicker && !activeWorktree && !pickedRepo)}
            >
              {busy ? '…' : activeWorktree ? 'Remove worktree' : 'Create worktree'}
            </button>
            {activeWorktree && (
              <button
                className="worktree-btn open"
                onClick={openInCode}
              >
                Open in Code
              </button>
            )}
            {canAssign && (
              <button
                className="worktree-btn claude"
                onClick={assignToClaude}
                disabled={assignStatus?.busy}
                title="Open Claude Code in this worktree with the task loaded"
              >
                {assignStatus?.busy ? '…' : item.role === 'reviewer' ? 'Review with Claude' : 'Assign to Claude'}
              </button>
            )}
          </div>
          {assignStatus?.ok && <span className="claude-session-ok">{assignStatus.ok}</span>}
          {assignStatus?.error && <span className="worktree-error">{assignStatus.error}</span>}
        </div>
      )}
    </div>
  );
}
