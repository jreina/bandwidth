import { useState } from 'react';
import WorkItem from './WorkItem.jsx';
import { DORMANT_AFTER_DAYS } from '../inFlight.js';

export default function InFlight({ entries, dormant, repos, onCreateWorktree, onRemoveWorktree }) {
  const [showDormant, setShowDormant] = useState(false);
  if (entries.length === 0 && dormant.length === 0) return null;
  const staleCount = entries.filter(e => e.stale).length;

  const renderEntry = entry => (
    <WorkItem
      key={entry.item.id}
      item={entry.item}
      worktree={entry.worktree ?? null}
      signals={entry.signals}
      stale={entry.stale}
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
        Work you've already started, actionable and most neglected first.
      </p>
      {entries.length > 0 && (
        <div className="in-flight-grid">{entries.map(renderEntry)}</div>
      )}
      {dormant.length > 0 && (
        <>
          <button className="in-flight-dormant-toggle" onClick={() => setShowDormant(v => !v)}>
            {showDormant ? '▾' : '▸'} {dormant.length} dormant (idle {DORMANT_AFTER_DAYS}+ days). Finish or close these.
          </button>
          {showDormant && (
            <div className="in-flight-grid">{dormant.map(renderEntry)}</div>
          )}
        </>
      )}
    </section>
  );
}
