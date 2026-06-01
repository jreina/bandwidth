import { useState } from 'react';

const SOURCE_LABELS = {
  'github-pr':    'PR',
  'github-issue': 'Issue',
  'jira':         'Jira'
};

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

export default function WorkItem({ item, worktree, repos = [], onCreateWorktree, onRemoveWorktree }) {
  const [busy, setBusy] = useState(false);
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

      {showWorktreeSection && (
        <div className="item-worktree">
          {activeWorktree && (
            <div className="worktree-active">
              <span className="worktree-dot" />
              <code className="worktree-path">{activeWorktree.path}</code>
            </div>
          )}
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
          </div>
        </div>
      )}
    </div>
  );
}
