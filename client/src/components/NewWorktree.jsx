import { useState } from 'react';

export default function NewWorktree({ repos = [], onCreate }) {
  const [open, setOpen] = useState(false);
  const [repoName, setRepoName] = useState(repos[0] || '');
  const [branch, setBranch] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [created, setCreated] = useState(null);

  const canCreate = repoName && branch.trim() && !busy;

  async function handleCreate() {
    if (!canCreate) return;
    setBusy(true);
    setErr(null);
    setCreated(null);
    try {
      const result = await onCreate(branch.trim(), repoName);
      if (result?.error) {
        setErr(result.error);
      } else if (result?.path) {
        setCreated({ path: result.path });
        setBranch('');
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function openInCode() {
    if (!created?.path) return;
    setErr(null);
    try {
      const res = await fetch('/api/worktrees/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: created.path })
      });
      const data = await res.json();
      if (data?.error) setErr(data.error);
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <section className="new-worktree">
      <button
        className="new-worktree-toggle"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        <span className="new-worktree-plus">{open ? '−' : '+'}</span>
        New worktree
        <span className="new-worktree-hint">no issue needed — for quick fixes</span>
      </button>

      {open && (
        <div className="new-worktree-body">
          <div className="new-worktree-row">
            <label className="new-worktree-label">Repo</label>
            <select
              className="new-worktree-select"
              value={repoName}
              onChange={e => setRepoName(e.target.value)}
              disabled={busy}
            >
              {repos.length === 0 && <option value="">No repos found</option>}
              {repos.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="new-worktree-row">
            <label className="new-worktree-label">Branch</label>
            <div className="new-worktree-field">
              <input
                className="new-worktree-input"
                type="text"
                placeholder="e.g. fix-ci"
                value={branch}
                onChange={e => {
                  setBranch(e.target.value);
                  if (created) setCreated(null);
                  if (err) setErr(null);
                }}
                onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
                disabled={busy}
              />
              {branch && !busy && (
                <button
                  type="button"
                  className="new-worktree-clear"
                  onClick={() => setBranch('')}
                  aria-label="Clear branch name"
                  title="Clear"
                >
                  ×
                </button>
              )}
            </div>
          </div>

          {created && (
            <div className="worktree-active">
              <span className="worktree-dot" />
              <code className="worktree-path">{created.path}</code>
            </div>
          )}
          {err && <span className="worktree-error">{err}</span>}

          <div className="worktree-actions">
            <button
              className="worktree-btn create"
              onClick={handleCreate}
              disabled={!canCreate}
            >
              {busy ? '…' : 'Create worktree'}
            </button>
            {created && (
              <button className="worktree-btn open" onClick={openInCode}>
                Open in Code
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
