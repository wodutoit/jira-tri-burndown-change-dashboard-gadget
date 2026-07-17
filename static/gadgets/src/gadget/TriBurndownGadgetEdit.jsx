import React, { useState, useEffect, useCallback } from 'react';
import { invoke, view } from '@forge/bridge';

const DEFAULT_PHASE_MAP = {
  'To Do':          'backlog',
  'BA Reviewed':    'backlog',
  'Team Estimated': 'backlog',
  'Open':           'backlog',
  'In Progress':    'dev',
  'Blocked':        'dev',
  'Code Review':    'review',
  'Testing':        'test',
  'Test Design':    'test',
  'Done':           'done',
  'Closed':         'done',
  'Not Required':   'excluded',
};

const PHASE_OPTIONS = [
  { value: 'backlog',  label: 'Backlog (pre-dev)' },
  { value: 'dev',      label: 'Dev' },
  { value: 'review',   label: 'Review (Code Review)' },
  { value: 'test',     label: 'Test' },
  { value: 'done',     label: 'Done' },
  { value: 'excluded', label: 'Excluded (Not Required)' },
];

const S = {
  wrap: { padding: 16, display: 'flex', flexDirection: 'column', gap: 16, fontFamily: 'inherit', color: 'var(--text)', fontSize: 13 },
  section: { display: 'flex', flexDirection: 'column', gap: 8 },
  label: { fontWeight: 600, fontSize: 12, color: 'var(--text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em' },
  select: { width: '100%', border: '1px solid var(--border)', borderRadius: 4, padding: '7px 10px', fontSize: 13, color: 'var(--text)', background: 'var(--surface)', fontFamily: 'inherit' },
  hint: { fontSize: 11, color: 'var(--text-subtlest)', marginTop: 2 },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 12px' },
  statusRow: { display: 'flex', alignItems: 'center', gap: 8 },
  statusName: { flex: '0 0 140px', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  phaseSelect: { flex: 1, border: '1px solid var(--border)', borderRadius: 3, padding: '4px 6px', fontSize: 12, color: 'var(--text)', background: 'var(--surface)', fontFamily: 'inherit' },
  btn: { alignSelf: 'flex-start', background: 'var(--brand)', color: '#fff', border: 'none', borderRadius: 4, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' },
  divider: { borderTop: '1px solid var(--border)', margin: '4px 0' },
  error: { fontSize: 12, color: 'var(--over-text)', padding: '6px 10px', background: 'var(--surface-sunken)', borderRadius: 4 },
};

function Section({ title, children, disabled }) {
  return (
    <div style={{ ...S.section, opacity: disabled ? 0.4 : 1, pointerEvents: disabled ? 'none' : 'auto' }}>
      <div style={S.label}>{title}</div>
      {children}
    </div>
  );
}

export default function TriBurndownGadgetEdit() {
  const [projects, setProjects]           = useState([]);
  const [fields, setFields]               = useState([]);
  const [sprints, setSprints]             = useState([]);
  const [statuses, setStatuses]           = useState([]);

  const [projectKey, setProjectKey]       = useState('');
  const [sprintId, setSprintId]           = useState('');
  const [spFieldId, setSpFieldId]         = useState('');
  const [statusMapping, setStatusMapping] = useState({});

  const [loading, setLoading]             = useState(true);
  const [sprintsLoading, setSprintsLoading] = useState(false);
  const [statusesLoading, setStatusesLoading] = useState(false);
  const [saving, setSaving]               = useState(false);
  const [error, setError]                 = useState(null);

  // Fetch sprints + statuses for a space without touching current selections
  // (used both for a fresh space pick and for re-hydrating a saved config).
  const loadSpaceData = useCallback(async (key) => {
    setSprintsLoading(true);
    setStatusesLoading(true);
    const [sprintRes, statusRes] = await Promise.all([
      invoke('getSprintsForProject', { projectKey: key }),
      invoke('getProjectStatuses', { projectKey: key }),
    ]);
    setSprints(sprintRes.sprints ?? []);
    setStatuses(statusRes.statuses ?? []);
    setSprintsLoading(false);
    setStatusesLoading(false);
    return statusRes.statuses ?? [];
  }, []);

  // Load initial data: projects + numeric fields + existing config
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
      if (cfg.spFieldId) setSpFieldId(cfg.spFieldId);

      if (cfg.projectKey) {
        setProjectKey(cfg.projectKey);
        // Default new/unconfigured gadgets to the dynamic "active sprint" mode.
        setSprintId(cfg.sprintMode === 'fixed' ? String(cfg.sprintId) : 'active');
        const fetchedStatuses = await loadSpaceData(cfg.projectKey);
        if (cfg.statusMapping) {
          setStatusMapping(cfg.statusMapping);
        } else {
          const mapping = {};
          for (const s of fetchedStatuses) mapping[s.name] = DEFAULT_PHASE_MAP[s.name] ?? 'backlog';
          setStatusMapping(mapping);
        }
      }
    }).catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // User explicitly picked a different space — reset sprint/status choices to defaults.
  const onProjectChange = useCallback(async (key) => {
    setProjectKey(key);
    setSprintId('active');
    setStatusMapping({});
    setStatuses([]);
    setSprints([]);
    if (!key) return;

    const fetchedStatuses = await loadSpaceData(key);
    const mapping = {};
    for (const s of fetchedStatuses) mapping[s.name] = DEFAULT_PHASE_MAP[s.name] ?? 'backlog';
    setStatusMapping(mapping);
  }, [loadSpaceData]);

  const handleSave = async () => {
    setSaving(true);
    const isFixed = sprintId !== 'active';
    const sprint = isFixed ? sprints.find(s => String(s.id) === sprintId) : null;
    try {
      await view.submit({
        projectKey,
        sprintMode: isFixed ? 'fixed' : 'active',
        sprintId: isFixed ? Number(sprintId) : null,
        sprintName: sprint?.name ?? '',
        spFieldId,
        statusMapping,
      });
    } finally {
      setSaving(false);
    }
  };

  const canSave = projectKey && sprintId && spFieldId && Object.keys(statusMapping).length > 0;

  if (loading) return <div style={{ padding: 20, fontFamily: 'inherit' }}>Loading…</div>;

  return (
    <div style={S.wrap}>
      {error && <div style={S.error}>{error}</div>}

      <Section title="1. Space">
        <select value={projectKey} onChange={e => onProjectChange(e.target.value)} style={S.select}>
          <option value="">Select a space…</option>
          {projects.map(p => <option key={p.key} value={p.key}>{p.name} ({p.key})</option>)}
        </select>
      </Section>

      <div style={S.divider} />

      <Section title="2. Sprint" disabled={!projectKey}>
        {sprintsLoading
          ? <div style={S.hint}>Loading sprints…</div>
          : (
            <select value={sprintId} onChange={e => setSprintId(e.target.value)} style={S.select}>
              <option value="active">Active Sprint (auto)</option>
              {sprints.filter(s => s.state === 'active').length > 0 && (
                <optgroup label="Pin to a specific sprint — Active">
                  {sprints.filter(s => s.state === 'active').map(s =>
                    <option key={s.id} value={String(s.id)}>{s.name}</option>
                  )}
                </optgroup>
              )}
              {sprints.filter(s => s.state === 'closed').length > 0 && (
                <optgroup label="Pin to a specific sprint — Closed">
                  {sprints.filter(s => s.state === 'closed').map(s =>
                    <option key={s.id} value={String(s.id)}>{s.name}</option>
                  )}
                </optgroup>
              )}
            </select>
          )
        }
        <div style={S.hint}>"Active Sprint (auto)" always tracks whatever sprint is currently active — no need to update this when a sprint closes. Pick a specific sprint instead to pin the widget to it (e.g. a closed sprint for a historical view).</div>
      </Section>

      <div style={S.divider} />

      <Section title="3. Story Points Field" disabled={!projectKey}>
        <select value={spFieldId} onChange={e => setSpFieldId(e.target.value)} style={S.select}>
          <option value="">Select a field…</option>
          {fields.map(f => <option key={f.id} value={f.id}>{f.name} ({f.id})</option>)}
        </select>
        <div style={S.hint}>Choose the numeric field your team uses for story point estimates.</div>
      </Section>

      <div style={S.divider} />

      <Section title="4. Status → Phase Mapping" disabled={!projectKey || statusesLoading}>
        {statusesLoading
          ? <div style={S.hint}>Loading statuses…</div>
          : statuses.length === 0
          ? <div style={S.hint}>Select a space to load its statuses.</div>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {statuses.map(s => (
                <div key={s.name} style={S.statusRow}>
                  <span style={S.statusName} title={s.name}>{s.name}</span>
                  <select
                    value={statusMapping[s.name] ?? 'backlog'}
                    onChange={e => setStatusMapping(m => ({ ...m, [s.name]: e.target.value }))}
                    style={S.phaseSelect}
                  >
                    {PHASE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )
        }
        <div style={S.hint}>Assign each status to a burndown phase. <b>Excluded</b> statuses are removed from scope (like "Not Required").</div>
      </Section>

      <div style={S.divider} />

      <button onClick={handleSave} disabled={saving || !canSave} style={{
        ...S.btn,
        opacity: (!canSave || saving) ? 0.5 : 1,
        cursor: (!canSave || saving) ? 'default' : 'pointer',
      }}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
