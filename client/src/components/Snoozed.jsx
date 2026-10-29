import { useState } from 'react';
import WorkItem from './WorkItem.jsx';

export default function Snoozed({ entries, repos, onAnnotate, onCompleteCommitment, onCreateWorktree, onRemoveWorktree }) {
  const [open, setOpen] = useState(false);
  if (entries.length === 0) return null;

  return (
    <section className="orphan-section">
      <button className="snoozed-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <h2 className="orphan-title">
          {open ? '▾' : '▸'} Snoozed
          <span className="orphan-count">{entries.length}</span>
        </h2>
      </button>
      <p className="orphan-hint">Set aside on purpose. Each comes back on its own when its snooze ends.</p>
      {open && (
        <div className="in-flight-grid">
          {entries.map(({ item, worktree, annotation }) => (
            <WorkItem
              key={item.id}
              item={item}
              worktree={worktree ?? null}
              annotation={annotation}
              onAnnotate={onAnnotate}
              onDone={item.source === 'commitment' ? onCompleteCommitment : undefined}
              repos={repos}
              onCreateWorktree={onCreateWorktree}
              onRemoveWorktree={onRemoveWorktree}
            />
          ))}
        </div>
      )}
    </section>
  );
}
