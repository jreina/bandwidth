import { useState, useEffect } from 'react';

const LAST_BOARD_KEY = 'newJiraIssue:boardId';

function readLastBoard() {
  try { return localStorage.getItem(LAST_BOARD_KEY); } catch { return null; }
}

function writeLastBoard(id) {
  try { localStorage.setItem(LAST_BOARD_KEY, id); } catch {}
}

export default function NewJiraIssue({ onCreated }) {
  const [open, setOpen] = useState(false);
  const [boards, setBoards] = useState(null);
  const [boardId, setBoardId] = useState('');
  const [issueTypes, setIssueTypes] = useState([]);
  const [issueTypeId, setIssueTypeId] = useState('');
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [assignToMe, setAssignToMe] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [created, setCreated] = useState(null);

  const board = boards?.find(b => String(b.id) === boardId);
  const projectKey = board?.projectKey;

  // Boards load the first time the form opens
  useEffect(() => {
    if (!open || boards) return;
    fetch('/api/jira/boards')
      .then(r => r.json())
      .then(list => {
        if (!Array.isArray(list)) throw new Error(list.error || 'Failed to load boards');
        setBoards(list);
        const last = readLastBoard();
        setBoardId(String((list.find(b => String(b.id) === last) ?? list[0])?.id ?? ''));
      })
      .catch(e => { setBoards([]); setErr(e.message); });
  }, [open, boards]);

  // Issue types depend on the board's project
  useEffect(() => {
    if (!projectKey) return;
    let cancelled = false;
    setIssueTypes([]);
    fetch(`/api/jira/projects/${encodeURIComponent(projectKey)}/issuetypes`)
      .then(r => r.json())
      .then(types => {
        if (cancelled) return;
        if (!Array.isArray(types)) throw new Error(types.error || 'Failed to load issue types');
        setIssueTypes(types);
        setIssueTypeId((types.find(t => t.name === 'Task') ?? types[0])?.id ?? '');
      })
      .catch(e => { if (!cancelled) setErr(e.message); });
    return () => { cancelled = true; };
  }, [projectKey]);

  const canCreate = projectKey && issueTypeId && summary.trim() && !busy;

  async function handleCreate(e) {
    e.preventDefault();
    if (!canCreate) return;
    setBusy(true);
    setErr(null);
    setCreated(null);
    try {
      const res = await fetch('/api/jira/issues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectKey, issueTypeId, summary, description, assignToMe })
      });
      const data = await res.json();
      if (data.error) {
        setErr(data.error);
      } else {
        setCreated({ ...data, assignToMe });
        setSummary('');
        setDescription('');
        if (assignToMe) onCreated?.();
      }
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
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
        New Jira issue
        <span className="new-worktree-hint">file it on a board, optionally assigned to you</span>
      </button>

      {open && (
        <form className="new-worktree-body" onSubmit={handleCreate}>
          <div className="new-worktree-row">
            <label className="new-worktree-label">Board</label>
            <select
              className="new-worktree-select"
              value={boardId}
              onChange={e => { setBoardId(e.target.value); writeLastBoard(e.target.value); }}
              disabled={busy || !boards}
            >
              {!boards && <option value="">Loading…</option>}
              {boards?.length === 0 && <option value="">No boards found</option>}
              {boards?.map(b => (
                <option key={b.id} value={b.id}>{b.name} ({b.projectKey})</option>
              ))}
            </select>
          </div>
          <div className="new-worktree-row">
            <label className="new-worktree-label">Type</label>
            <select
              className="new-worktree-select"
              value={issueTypeId}
              onChange={e => setIssueTypeId(e.target.value)}
              disabled={busy || issueTypes.length === 0}
            >
              {issueTypes.length === 0 && <option value="">…</option>}
              {issueTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div className="new-worktree-row">
            <label className="new-worktree-label">Summary</label>
            <input
              className="new-worktree-input jira-summary"
              type="text"
              placeholder="What needs doing"
              maxLength={255}
              value={summary}
              onChange={e => { setSummary(e.target.value); if (created) setCreated(null); }}
              disabled={busy}
            />
          </div>
          <div className="new-worktree-row align-top">
            <label className="new-worktree-label">Details</label>
            <textarea
              className="new-worktree-input jira-description"
              placeholder="Optional description"
              rows={3}
              value={description}
              onChange={e => setDescription(e.target.value)}
              disabled={busy}
            />
          </div>
          <label className="jira-assign">
            <input
              type="checkbox"
              checked={assignToMe}
              onChange={e => setAssignToMe(e.target.checked)}
              disabled={busy}
            />
            Assign to me
          </label>

          {created && (
            <span className="jira-created">
              Created <a href={created.url} target="_blank" rel="noreferrer">{created.key}</a>
              {created.assignToMe ? ', assigned to you' : ', unassigned'}
            </span>
          )}
          {err && <span className="worktree-error">{err}</span>}

          <div className="worktree-actions">
            <button className="worktree-btn create" type="submit" disabled={!canCreate}>
              {busy ? '…' : 'Create issue'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
