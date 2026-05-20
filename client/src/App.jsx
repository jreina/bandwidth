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

  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then(c => setSpotlightProject(c.spotlightProject || null))
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

    // Fetch worktree state for each unique repo that exists locally
    const repoNames = [...new Set(allItems.filter(i => i.repoName).map(i => i.repoName))];
    const wtMap = {};
    await Promise.all(repoNames.map(async repoName => {
      try {
        const res = await fetch(`/api/worktrees/${repoName}`);
        if (!res.ok) return;
        const wts = await res.json();
        for (const wt of wts) {
          if (wt.branch) wtMap[`${repoName}/${wt.branch}`] = wt;
        }
      } catch {}
    }));
    setWorktrees(wtMap);
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  async function handleCreateWorktree(item) {
    const res = await fetch('/api/worktrees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoName: item.repoName, branch: item.branch })
    });
    const data = await res.json();
    if (data.path) {
      setWorktrees(prev => ({
        ...prev,
        [`${item.repoName}/${item.branch}`]: { path: data.path, branch: item.branch }
      }));
    }
    return data;
  }

  async function handleRemoveWorktree(item) {
    await fetch('/api/worktrees', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoName: item.repoName, branch: item.branch })
    });
    setWorktrees(prev => {
      const next = { ...prev };
      delete next[`${item.repoName}/${item.branch}`];
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
          <div className="categories-grid">
            {grouped.map(cat => (
              <WorkCategory
                key={cat.id}
                category={cat}
                worktrees={worktrees}
                onCreateWorktree={handleCreateWorktree}
                onRemoveWorktree={handleRemoveWorktree}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
