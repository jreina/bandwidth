import { useState } from 'react';

const SOURCE_LABELS = {
  'github-pr':    'PR',
  'github-issue': 'Issue',
  'jira':         'Jira'
};

export default function WorkItem({ item, worktree, onCreateWorktree, onRemoveWorktree }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [localWorktree, setLocalWorktree] = useState(undefined);

  const activeWorktree = localWorktree !== undefined ? localWorktree : worktree;

  async function toggleWorktree() {
    setBusy(true);
    setErr(null);
    try {
      if (activeWorktree) {
        await onRemoveWorktree(item);
        setLocalWorktree(null);
      } else {
        const result = await onCreateWorktree(item);
        if (result?.error) {
          setErr(result.error);
        } else if (result?.path) {
          setLocalWorktree({ path: result.path, branch: item.branch });
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

  return (
    <div className={`work-item ${activeWorktree ? 'has-worktree' : ''}`}>
      <div className="item-badges">
        <span className="badge badge-source">{SOURCE_LABELS[item.source] ?? item.source}</span>
        <span className={`badge badge-effort ${item.effort}`}>{item.effort}</span>
      </div>

      <a className="item-title" href={item.url} target="_blank" rel="noopener noreferrer">
        {item.title}
      </a>

      {item.subtitle && <div className="item-subtitle">{item.subtitle}</div>}

      {item.description && (
        <p className="item-description">{item.description}</p>
      )}

      {item.repo && <span className="item-repo">{item.repo}</span>}

      {item.branch && (
        <div className="item-worktree">
          {activeWorktree && (
            <div className="worktree-active">
              <span className="worktree-dot" />
              <code className="worktree-path">{activeWorktree.path}</code>
            </div>
          )}
          {err && <span className="worktree-error">{err}</span>}
          <div className="worktree-actions">
            <button
              className={`worktree-btn ${activeWorktree ? 'remove' : 'create'}`}
              onClick={toggleWorktree}
              disabled={busy}
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
          </div>
        </div>
      )}
    </div>
  );
}
