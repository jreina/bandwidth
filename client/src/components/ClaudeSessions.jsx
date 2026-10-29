import { useState } from 'react';
import { ageLabel } from '../inFlight.js';

const COLLAPSED_COUNT = 2;

function Session({ session }) {
  const [status, setStatus] = useState(null);

  async function resume() {
    setStatus(null);
    try {
      const res = await fetch('/api/claude/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id })
      });
      const data = await res.json();
      setStatus(data.error ? { error: data.error } : { ok: 'Opened in Terminal' });
    } catch (e) {
      setStatus({ error: e.message });
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(session.resumeCommand);
      setStatus({ ok: 'Copied' });
    } catch {
      setStatus({ error: 'Clipboard unavailable' });
    }
  }

  return (
    <li className="claude-session">
      <div className="claude-session-head">
        {session.running && <span className="claude-running-dot" title="Claude is running in this worktree" />}
        <span className="claude-session-title" title={session.title}>{session.title}</span>
        <span className="claude-session-age">
          {session.running ? 'running' : ageLabel(Date.now() - Date.parse(session.lastActiveAt))}
        </span>
      </div>
      {session.lastPrompt && (
        <div className="claude-session-prompt" title={session.lastPrompt}>“{session.lastPrompt}”</div>
      )}
      <div className="claude-session-actions">
        {!session.running && (
          <button className="item-action" onClick={resume}>Resume</button>
        )}
        <button className="item-action" onClick={copy} title={session.resumeCommand}>Copy command</button>
        {status?.ok && <span className="claude-session-ok">{status.ok}</span>}
        {status?.error && <span className="worktree-error">{status.error}</span>}
      </div>
    </li>
  );
}

export default function ClaudeSessions({ sessions = [] }) {
  const [expanded, setExpanded] = useState(false);
  if (sessions.length === 0) return null;
  const visible = expanded ? sessions : sessions.slice(0, COLLAPSED_COUNT);

  return (
    <div className="claude-sessions">
      <div className="claude-sessions-label">Claude sessions</div>
      <ul className="claude-session-list">
        {visible.map(s => <Session key={s.id} session={s} />)}
      </ul>
      {sessions.length > COLLAPSED_COUNT && (
        <button className="in-flight-dormant-toggle" onClick={() => setExpanded(v => !v)}>
          {expanded ? 'Show fewer' : `+${sessions.length - COLLAPSED_COUNT} older`}
        </button>
      )}
    </div>
  );
}
