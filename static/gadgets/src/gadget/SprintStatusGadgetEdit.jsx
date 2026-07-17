import React, { useState, useEffect } from 'react';
import { invoke, view } from '@forge/bridge';

const SELECT_STYLE = {
  width: '100%', border: '1px solid var(--border)', borderRadius: 4,
  padding: '7px 10px', fontSize: 14, color: 'var(--text)', background: 'var(--surface)',
  fontFamily: 'inherit',
};

export default function SprintStatusGadgetEdit() {
  const [projects, setProjects] = useState([]);
  const [projectKey, setProjectKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    view.theme.enable().catch(() => {});
    Promise.all([invoke('getGadgetProjects'), view.getContext().catch(() => ({}))])
      .then(([data, ctx]) => {
        if (data.error) { setError(data.error); return; }
        setProjects(data.projects ?? []);
        setProjectKey(ctx?.extension?.gadgetConfiguration?.projectKey ?? '');
      })
      .catch(err => setError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await view.submit({ projectKey });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="center-msg" data-app-shell="true">Loading…</div>;
  }

  return (
    <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14, fontFamily: 'inherit', color: 'var(--text)' }}>
      {error && <div style={{ fontSize: 12, color: 'var(--over-text)' }}>{error}</div>}

      <div className="field-group" style={{ marginBottom: 0 }}>
        <label className="field-label">Jira space</label>
        <select value={projectKey} onChange={e => setProjectKey(e.target.value)} style={SELECT_STYLE}>
          <option value="">Select a project…</option>
          {projects.map(p => <option key={p.key} value={p.key}>{p.name} ({p.key})</option>)}
        </select>
        <div className="field-hint">
          Uses that project's first Scrum board and its currently active sprint.
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={saving || !projectKey}
        style={{
          alignSelf: 'flex-start', background: 'var(--brand)', color: '#fff', border: 'none',
          borderRadius: 4, padding: '7px 16px', fontSize: 14, fontWeight: 600,
          cursor: saving ? 'default' : 'pointer', fontFamily: 'inherit',
        }}
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
