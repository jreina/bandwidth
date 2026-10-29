import WorkItem from './WorkItem.jsx';

export default function WorkCategory({ category, worktrees, repos, onCreateWorktree, onRemoveWorktree }) {
  return (
    <div className="work-category" style={{ '--cat-color': category.color }}>
      <div className="category-header">
        <span className="category-title">{category.label}</span>
        <span className="category-count">{category.items.length}</span>
      </div>
      <div className="category-items">
        {category.items.length === 0 ? (
          <div className="empty-state">Nothing here</div>
        ) : (
          category.items.map(item => (
            <WorkItem
              key={item.id}
              item={item}
              worktree={item.branch ? worktrees[`${item.repoName}/${item.branch}`] ?? null : null}
              repos={repos}
              onCreateWorktree={onCreateWorktree}
              onRemoveWorktree={onRemoveWorktree}
            />
          ))
        )}
      </div>
    </div>
  );
}
