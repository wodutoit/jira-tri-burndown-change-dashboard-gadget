import React, { useState, useEffect } from 'react';
import { invoke, view } from '@forge/bridge';
import { editStyles as S, Section } from './sprintConfigShared';

// Deliberately minimal — unlike the other TRI-* gadgets, this one doesn't
// need Sprint/SP-Field/Status-Mapping/Grace-Window here. Its only job is to
// pick which Space's sprints show up in the live selector on the dashboard;
// the sprint itself is chosen in view mode, not here (see
// TriSprintFilterGadgetView.jsx).
export default function TriSprintFilterGadgetEdit() {
  const [projects, setProjects]   = useState([]);
  const [projectKey, setProjectKey] = useState('');
  const [loading, setLoading]     = useState(true);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState(null);

  useEffect(() => {
    view.theme.enable().catch(() => {});
    Promise.all([invoke('getGadgetProjects'), view.getContext().catch(() => ({}))])
      .then(([proj, ctx]) => {
        if (proj.error) setError(proj.error);
        setProjects(proj.projects ?? []);
        const cfg = ctx?.extension?.gadgetConfiguration ?? {};
        if (cfg.projectKey) setProjectKey(cfg.projectKey);
      })
      .catch(e => setError(String(e)))
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

  if (loading) return <div style={{ padding: 20, fontFamily: 'inherit' }}>Loading…</div>;

  return (
    <div style={S.wrap}>
      {error && <div style={S.error}>{error}</div>}

      <Section title="1. Space">
        <select value={projectKey} onChange={e => setProjectKey(e.target.value)} style={S.select}>
          <option value="">Select a space…</option>
          {projects.map(p => <option key={p.key} value={p.key}>{p.name} ({p.key})</option>)}
        </select>
        <div style={S.hint}>
          Pick the space whose sprints this filter offers on the dashboard. Any TRI-* gadget on this
          dashboard with "Use dashboard sprint filter" turned on in its own edit screen will follow the
          space and sprint selected here.
        </div>
      </Section>

      <div style={S.divider} />

      <button onClick={handleSave} disabled={saving || !projectKey} style={{
        ...S.btn,
        opacity: (!projectKey || saving) ? 0.5 : 1,
        cursor: (!projectKey || saving) ? 'default' : 'pointer',
      }}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
