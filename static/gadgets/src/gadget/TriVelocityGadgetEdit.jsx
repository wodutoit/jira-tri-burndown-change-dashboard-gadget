import React, { useState, useEffect } from 'react';
import { invoke, view } from '@forge/bridge';
import { editStyles as S, Section, DEFAULT_PHASE_MAP } from './sprintConfigShared';
import VelocitySpaceRow from './VelocitySpaceRow';

const SPRINT_OPTIONS = Array.from({ length: 10 }, (_, i) => i + 1);

function emptySpace() {
  return { projectKey: '', spFieldId: '', statusMapping: {}, statuses: [], statusesLoading: false };
}

export default function TriVelocityGadgetEdit() {
  const [projects, setProjects] = useState([]);
  const [fields, setFields] = useState([]);
  const [spaces, setSpaces] = useState([emptySpace()]);
  const [sprintCount, setSprintCount] = useState(5);
  const [showTotal, setShowTotal] = useState(false);
  const [onlyShowTotal, setOnlyShowTotal] = useState(false);
  const [useDashboardFilter, setUseDashboardFilter] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function fetchStatusesFor(projectKey) {
    const res = await invoke('getProjectStatuses', { projectKey });
    return res.statuses ?? [];
  }

  useEffect(() => {
    view.theme.enable().catch(() => {});
    Promise.all([
      invoke('getGadgetProjects'),
      invoke('getNumericFields'),
      view.getContext().catch(() => ({})),
    ]).then(async ([proj, numFields, ctx]) => {
      if (proj.error) setError(proj.error);
      setProjects(proj.projects ?? []);
      setFields(numFields.fields ?? []);

      const cfg = ctx?.extension?.gadgetConfiguration ?? {};
      setSprintCount(Math.min(10, Math.max(1, cfg.sprintCount ?? 5)));
      setShowTotal(!!cfg.showTotal);
      setOnlyShowTotal(!!cfg.onlyShowTotal);
      setUseDashboardFilter(!!cfg.useDashboardFilter);

      const savedSpaces = Array.isArray(cfg.spaces) && cfg.spaces.length > 0 ? cfg.spaces : [{ projectKey: '' }];
      const hydrated = await Promise.all(savedSpaces.map(async s => {
        if (!s.projectKey) return emptySpace();
        const statuses = await fetchStatusesFor(s.projectKey);
        return {
          projectKey: s.projectKey,
          spFieldId: s.spFieldId ?? '',
          statusMapping: s.statusMapping ?? {},
          statuses,
          statusesLoading: false,
        };
      }));
      setSpaces(hydrated);
    }).catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateSpace = (index, patch) => {
    setSpaces(cur => cur.map((s, i) => i === index ? { ...s, ...patch } : s));
  };

  const handleProjectChange = async (index, key) => {
    updateSpace(index, { projectKey: key, spFieldId: '', statusMapping: {}, statuses: [], statusesLoading: !!key });
    if (!key) return;
    const statuses = await fetchStatusesFor(key);
    const mapping = {};
    for (const s of statuses) mapping[s.name] = DEFAULT_PHASE_MAP[s.name] ?? 'backlog';
    updateSpace(index, { statuses, statusMapping: mapping, statusesLoading: false });
  };

  const handleFieldChange = (index, value) => updateSpace(index, { spFieldId: value });

  const handleMappingChange = (index, statusName, phase) =>
    setSpaces(cur => cur.map((s, i) =>
      i === index ? { ...s, statusMapping: { ...s.statusMapping, [statusName]: phase } } : s
    ));

  const addSpace = () => setSpaces(cur => [...cur, emptySpace()]);
  const removeSpace = (index) => setSpaces(cur => cur.filter((_, i) => i !== index));

  const takenKeys = new Set(spaces.map(s => s.projectKey).filter(Boolean));
  const canSave = spaces.length > 0 && spaces.every(s => s.projectKey && s.spFieldId && Object.keys(s.statusMapping).length > 0);

  const handleSave = async () => {
    setSaving(true);
    const isMulti = spaces.length > 1;
    try {
      await view.submit({
        spaces: spaces.map(({ projectKey, spFieldId, statusMapping }) => ({ projectKey, spFieldId, statusMapping })),
        sprintCount,
        showTotal: isMulti && (showTotal || onlyShowTotal),
        onlyShowTotal: isMulti && onlyShowTotal,
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {spaces.map((space, i) => (
            <VelocitySpaceRow
              key={i}
              index={i}
              space={space}
              projects={projects}
              fields={fields}
              takenKeys={takenKeys}
              onProjectChange={key => handleProjectChange(i, key)}
              onFieldChange={value => handleFieldChange(i, value)}
              onMappingChange={(name, phase) => handleMappingChange(i, name, phase)}
              onRemove={() => removeSpace(i)}
              canRemove={spaces.length > 1}
            />
          ))}
        </div>
        <button
          onClick={addSpace}
          style={{ alignSelf: 'flex-start', marginTop: 4, background: 'none', border: '1px dashed var(--border)', borderRadius: 4, padding: '6px 12px', fontSize: 12, color: 'var(--text-subtle)', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          + Add another space
        </button>
      </Section>

      <div style={S.divider} />

      <Section title="Closed sprints to show (default)">
        <select value={sprintCount} onChange={e => setSprintCount(parseInt(e.target.value, 10))} style={{ ...S.select, width: 120 }}>
          {SPRINT_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <div style={S.hint}>Viewers can change this on the gadget itself. A space with fewer closed sprints just shows what it has.</div>
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
            closed sprints rather than showing one sprint. If the filter points at a space this gadget wasn't
            configured for, it reuses the Story Points field above and falls back to a best-guess status mapping
            until you edit this gadget again.
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
