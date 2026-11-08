import { useState } from 'react';
import WorkItem from './WorkItem.jsx';
import { DORMANT_AFTER_DAYS } from '../inFlight.js';

function NewCommitment({ onAdd }) {
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const result = await onAdd({ title: title.trim(), dueDate: dueDate || null });
      if (result?.error) setErr(result.error);
      else { setTitle(''); setDueDate(''); }
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="commitment-form" onSubmit={handleSubmit}>
      <input
        className="new-worktree-input commitment-input"
        type="text"
        placeholder="I said I'd…"
        value={title}
        onChange={e => setTitle(e.target.value)}
        disabled={busy}
      />
      <input
        className="new-worktree-input commitment-date"
        type="date"
        value={dueDate}
        onChange={e => setDueDate(e.target.value)}
        disabled={busy}
        aria-label="Due date (optional)"
      />
      <button className="worktree-btn create" type="submit" disabled={busy || !title.trim()}>
        {busy ? '…' : 'Add commitment'}
      </button>
      {err && <span className="worktree-error">{err}</span>}
    </form>
  );
}

export default function InFlight({
  entries, dormant, searching, repos, onAnnotate, onAddCommitment, onCompleteCommitment,
  onCreateWorktree, onRemoveWorktree
}) {
  const [showDormant, setShowDormant] = useState(false);
  const staleCount = entries.filter(e => e.stale).length;

  const renderEntry = entry => (
    <WorkItem
      key={entry.item.id}
      item={entry.item}
      worktree={entry.worktree ?? null}
      signals={entry.signals}
      stale={entry.stale}
      annotation={entry.annotation}
      onAnnotate={onAnnotate}
      onDone={entry.item.source === 'commitment' ? onCompleteCommitment : undefined}
      repos={repos}
      onCreateWorktree={onCreateWorktree}
      onRemoveWorktree={onRemoveWorktree}
    />
  );

  return (
    <section className="in-flight">
      <h2 className="in-flight-title">
        In flight
        <span className="in-flight-count">{entries.length}</span>
        {staleCount > 0 && <span className="in-flight-stale">{staleCount} stalled</span>}
      </h2>
      <p className="in-flight-hint">
        Work you've started or committed to: pinned first, then actionable, then most neglected.
      </p>
      <NewCommitment onAdd={onAddCommitment} />
      {entries.length > 0 && (
        <div className="in-flight-grid">{entries.map(renderEntry)}</div>
      )}
      {dormant.length > 0 && (
        <>
          <button className="in-flight-dormant-toggle" onClick={() => setShowDormant(v => !v)}>
            {showDormant || searching ? '▾' : '▸'} {dormant.length} dormant (idle {DORMANT_AFTER_DAYS}+ days). Finish or close these.
          </button>
          {(showDormant || searching) && (
            <div className="in-flight-grid">{dormant.map(renderEntry)}</div>
          )}
        </>
      )}
    </section>
  );
}
