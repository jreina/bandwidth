import { useState, useEffect, useCallback } from 'react';
import './App.css';
import EnergySelector from './components/EnergySelector.jsx';
import WorkCategory from './components/WorkCategory.jsx';

const BASE_CATEGORIES = [
  { id: 'code-review', label: 'Code Review', color: '#3b82f6' },
  { id: 'bug',         label: 'Bugs',        color: '#ef4444' },
  { id: 'task',        label: 'Tasks',       color: '#10b981' },
  { id: 'docs',        label: 'Docs',        color: '#8b5cf6' }
];

const EFFORT_BY_ENERGY = {
  low:    ['small'],
  medium: ['small', 'medium'],
  high:   ['small', 'medium', 'large']
};

export default function App() {
  const [items, setItems] = useState([]);
  const [worktrees, setWorktrees] = useState({});
  const [energy, setEnergy] = useState('medium');
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [spotlightProject, setSpotlightProject] = useState(null);
  const [repos, setRepos] = useState([]);

  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then(c => setSpotlightProject(c.spotlightProject || null))
      .catch(() => {});
    fetch('/api/repos')
      .then(r => r.json())
      .then(list => setRepos(Array.isArray(list) ? list : []))
      .catch(() => {});
  }, []);

  const fetchAll = useCallback(async () => {
    setRefreshing(true);
    const errs = [];

    const [githubRes, jiraRes] = await Promise.allSettled([
      fetch('/api/github/items').then(r => r.json()),
      fetch('/api/jira/items').then(r => r.json())
    ]);

    const githubItems = githubRes.status === 'fulfilled' && Array.isArray(githubRes.value)
      ? githubRes.value
      : (errs.push('GitHub: ' + (githubRes.reason?.message || 'failed')), []);

    const jiraItems = jiraRes.status === 'fulfilled' && Array.isArray(jiraRes.value)
      ? jiraRes.value
      : (errs.push('Jira: ' + (jiraRes.reason?.message || 'failed')), []);

    const allItems = [...githubItems, ...jiraItems];
    setItems(allItems);
    setErrors(errs);

    // Fetch all worktrees across all repos in one call
    const wtMap = {};
    try {
      const res = await fetch('/api/worktrees');
      if (res.ok) {
        const wts = await res.json();
        for (const wt of wts) {
          if (wt.branch && wt.repoName) wtMap[`${wt.repoName}/${wt.branch}`] = wt;
        }
      }
    } catch {}
    setWorktrees(wtMap);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  async function handleCreateWorktree(item, override = {}) {
    const repoName = override.repoName || item.repoName;
    const branch = override.branch || item.branch;
    const res = await fetch('/api/worktrees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoName, branch })
    });
    const data = await res.json();
    if (data.path) {
      setWorktrees(prev => ({
        ...prev,
        [`${repoName}/${branch}`]: { path: data.path, branch, repoName }
      }));
    }
    return { ...data, repoName, branch };
  }

  async function handleRemoveWorktree(item, override = {}) {
    const repoName = override.repoName || item.repoName;
    const branch = override.branch || item.branch;
    await fetch('/api/worktrees', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoName, branch })
    });
    setWorktrees(prev => {
      const next = { ...prev };
      delete next[`${repoName}/${branch}`];
      return next;
    });
  }

  const categories = spotlightProject
    ? [...BASE_CATEGORIES, { id: spotlightProject.toLowerCase(), label: spotlightProject, color: '#f97316' }]
    : BASE_CATEGORIES;

  const allowedEfforts = EFFORT_BY_ENERGY[energy];
  const filteredItems = items.filter(i => allowedEfforts.includes(i.effort));
  const grouped = categories.map(cat => ({
    ...cat,
    items: filteredItems.filter(i => i.category === cat.id)
  }));
  const totalVisible = filteredItems.length;

  // Orphan worktrees: on disk but no active item references them
  const activeKeys = new Set(
    items.filter(i => i.repoName && i.branch).map(i => `${i.repoName}/${i.branch}`)
  );
  const orphanWorktrees = Object.entries(worktrees)
    .filter(([key]) => !activeKeys.has(key))
    .map(([key, wt]) => ({ key, ...wt }));

  async function handleRemoveOrphan(wt) {
    await fetch('/api/worktrees', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoName: wt.repoName, branch: wt.branch })
    });
    setWorktrees(prev => {
      const next = { ...prev };
      delete next[wt.key];
      return next;
    });
  }

  async function handleOpenOrphan(wt) {
    await fetch('/api/worktrees/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: wt.path })
    });
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-top">
          <div>
            <h1>What do you have energy to work on?</h1>
            {!loading && (
              <p className="item-count">
                {totalVisible} item{totalVisible !== 1 ? 's' : ''} at this energy level
                {items.length > totalVisible && ` · ${items.length - totalVisible} hidden`}
              </p>
            )}
          </div>
          <button
            className="refresh-btn"
            onClick={fetchAll}
            disabled={refreshing}
            title="Refresh"
            aria-label="Refresh"
          >
            <span className={refreshing ? 'spin' : ''}>↺</span>
          </button>
        </div>
        <EnergySelector value={energy} onChange={setEnergy} />
        {errors.length > 0 && (
          <div className="fetch-errors">
            {errors.map(e => <span key={e} className="fetch-error">{e}</span>)}
          </div>
        )}
      </header>

      <main className="app-main">
        {loading ? (
          <div className="loading">
            <span className="spin">↺</span> Loading your work items…
          </div>
        ) : (
          <>
            <div className="categories-grid">
              {grouped.map(cat => (
                <WorkCategory
                  key={cat.id}
                  category={cat}
                  worktrees={worktrees}
                  repos={repos}
                  onCreateWorktree={handleCreateWorktree}
                  onRemoveWorktree={handleRemoveWorktree}
                />
              ))}
            </div>
            {orphanWorktrees.length > 0 && (
              <section className="orphan-section">
                <h2 className="orphan-title">
                  Stale worktrees
                  <span className="orphan-count">{orphanWorktrees.length}</span>
                </h2>
                <p className="orphan-hint">
                  These worktrees exist on disk but no longer match an active PR or issue.
                </p>
                <ul className="orphan-list">
                  {orphanWorktrees.map(wt => (
                    <li key={wt.key} className="orphan-item">
                      <div className="orphan-info">
                        <span className="orphan-repo">{wt.repoName}</span>
                        <span className="orphan-branch">{wt.branch}</span>
                        <code className="orphan-path">{wt.path}</code>
                      </div>
                      <div className="orphan-actions">
                        <button
                          className="worktree-btn open"
                          onClick={() => handleOpenOrphan(wt)}
                        >
                          Open in Code
                        </button>
                        <button
                          className="worktree-btn remove"
                          onClick={() => handleRemoveOrphan(wt)}
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
