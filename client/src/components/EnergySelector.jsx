const LEVELS = [
  { id: 'low',    icon: '🌱', label: 'Low',    desc: 'Quick wins only'        },
  { id: 'medium', icon: '⚡', label: 'Medium', desc: 'Normal work'            },
  { id: 'high',   icon: '🔥', label: 'High',   desc: 'I can tackle anything'  }
];

export default function EnergySelector({ value, onChange }) {
  return (
    <div className="energy-selector">
      {LEVELS.map(level => (
        <button
          key={level.id}
          className={`energy-btn energy-${level.id} ${value === level.id ? 'active' : ''}`}
          onClick={() => onChange(level.id)}
        >
          <span className="energy-icon">{level.icon}</span>
          <span className="energy-text">
            <span className="energy-label">{level.label}</span>
            <span className="energy-desc">{level.desc}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
