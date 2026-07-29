import React, { useState, useEffect } from 'react';
import { invoke, view } from '@forge/bridge';
import { editStyles as S, Section } from './sprintConfigShared';
import VelocitySpaceRow from './VelocitySpaceRow';

const SPRINT_OPTIONS = Array.from({ length: 10 }, (_, i) => i + 1);

function emptySpace() {
  return { projectKey: '' };
}

export default function TriVelocityGadgetEdit() {
  const [projects, setProjects] = useState([]);
  const [spaces, setSpaces] = useState([emptySpace()]);
  const [sprintCount, setSprintCount] = useState(5);
  const [showTotal, setShowTotal] = useState(false);
  const [onlyShowTotal, setOnlyShowTotal] = useState(false);
  const [showCapacityBar, setShowCapacityBar] = useState(true);
  const [useDashboardFilter, setUseDashboardFilter] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    view.theme.enable().catch(() => {});
    Promise.all([
      invoke('getCapacityEnabledProjects'),
      view.getContext().catch(() => ({})),
    ]).then(([proj, ctx]) => {
      if (proj.error) setError(proj.error);
      setProjects(proj.projects ?? []);

      const cfg = ctx?.extension?.gadgetConfiguration ?? {};
      setSprintCount(Math.min(10, Math.max(1, cfg.sprintCount ?? 5)));
      setShowTotal(!!cfg.showTotal);
      setOnlyShowTotal(!!cfg.onlyShowTotal);
      setShowCapacityBar(cfg.showCapacityBar !== false);
      setUseDashboardFilter(!!cfg.useDashboardFilter);

      const savedSpaces = Array.isArray(cfg.spaces) && cfg.spaces.length > 0 ? cfg.spaces : [{ projectKey: '' }];
      setSpaces(savedSpaces.map(s => ({ projectKey: s.projectKey ?? '' })));
    }).catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const updateSpace = (index, patch) => {
    setSpaces(cur => cur.map((s, i) => i === index ? { ...s, ...patch } : s));
  };

  const handleProjectChange = (index, key) => updateSpace(index, { projectKey: key });

  const addSpace = () => setSpaces(cur => [...cur, emptySpace()]);
  const removeSpace = (index) => setSpaces(cur => cur.filter((_, i) => i !== index));

  const takenKeys = new Set(spaces.map(s => s.projectKey).filter(Boolean));
  const canSave = spaces.length > 0 && spaces.every(s => s.projectKey);

  const handleSave = async () => {
    setSaving(true);
    const isMulti = spaces.length > 1;
    try {
      await view.submit({
        spaces: spaces.map(({ projectKey }) => ({ projectKey })),
        sprintCount,
        showTotal: isMulti && (showTotal || onlyShowTotal),
        onlyShowTotal: isMulti && onlyShowTotal,
        showCapacityBar,
        useDashboardFilter: !isMulti && useDashboardFilter,
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 20, fontSize: 13, fontFamily: 'inherit' }}>Loading…</div>;
  }

  return (
    <div style={S.wrap}>
      {error && <div style={S.error}>{error}</div>}

      <Section title="Spaces">
        {projects.length === 0 && (
          <div style={S.hint}>
            No spaces have Capacity Planning enabled yet. Turn it on in a project's Settings → Capacity Planning
            before adding it here — TRI Velocity now reads that space's Capacity data instead of computing its own.
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {spaces.map((space, i) => (
            <VelocitySpaceRow
              key={i}
              index={i}
              space={space}
              projects={projects}
              takenKeys={takenKeys}
              onProjectChange={key => handleProjectChange(i, key)}
              onRemove={() => removeSpace(i)}
              canRemove={spaces.length > 1}
            />
          ))}
        </div>
        <button
          onClick={addSpace}
          disabled={projects.length === 0}
          style={{ alignSelf: 'flex-start', marginTop: 4, background: 'none', border: '1px dashed var(--border)', borderRadius: 4, padding: '6px 12px', fontSize: 12, color: 'var(--text-subtle)', cursor: projects.length === 0 ? 'default' : 'pointer', fontFamily: 'inherit', opacity: projects.length === 0 ? 0.5 : 1 }}
        >
          + Add another space
        </button>
      </Section>

      <div style={S.divider} />

      <Section title="Sprints/iterations to show (default)">
        <select value={sprintCount} onChange={e => setSprintCount(parseInt(e.target.value, 10))} style={{ ...S.select, width: 120 }}>
          {SPRINT_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <div style={S.hint}>Viewers can change this on the gadget itself. A space with fewer closed sprints/completed iterations just shows what it has.</div>
      </Section>

      <div style={S.divider} />

      <Section title="Capacity bar">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={showCapacityBar} onChange={e => setShowCapacityBar(e.target.checked)} />
          Show each space's Capacity as a bar alongside Committed and Velocity
        </label>
        <div style={S.hint}>Capacity comes from that sprint/iteration's row on the space's Capacity tab (or its Base Capacity setting, if that row was never overridden).</div>
      </Section>

      {spaces.length === 1 && (
        <>
          <div style={S.divider} />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={useDashboardFilter} onChange={e => setUseDashboardFilter(e.target.checked)} />
            Use dashboard sprint filter
          </label>
          <div style={S.hint}>
            When enabled, a "TRI Sprint Filter" gadget on this dashboard (if present) overrides which space is
            charted here — the filter's Sprint selection is ignored, since this gadget always trends across
            closed sprints/completed iterations rather than showing one sprint.
          </div>
        </>
      )}

      {spaces.length > 1 && (
        <>
          <div style={S.divider} />
          <Section title="Total chart">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={onlyShowTotal ? true : showTotal}
                disabled={onlyShowTotal}
                onChange={e => setShowTotal(e.target.checked)}
              />
              Show a Total chart summing all spaces
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', marginTop: 6 }}>
              <input type="checkbox" checked={onlyShowTotal} onChange={e => setOnlyShowTotal(e.target.checked)} />
              Only show the Total (hide individual space charts)
            </label>
            <div style={S.hint}>
              The Total aligns sprints by recency across spaces (most recent, 2nd-most-recent, …), not by
              calendar date — spaces on different boards rarely close sprints on the same day.
            </div>
          </Section>
        </>
      )}

      <button onClick={handleSave} disabled={saving || !canSave} style={{ ...S.btn, opacity: (saving || !canSave) ? 0.5 : 1 }}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
