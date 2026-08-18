import React, { useState, useEffect } from 'react';
import { invoke, view } from '@forge/bridge';
import { editStyles as S, Section } from './sprintConfigShared';
import { localTodayISO } from './gadgetUtils';
import VelocitySpaceRow from './VelocitySpaceRow';

const FUTURE_OPTIONS = [1, 2, 3, 4, 5, 6];

function emptySpace() {
  return { projectKey: '' };
}

export default function TriReleaseCapacityGadgetEdit() {
  const [projects, setProjects] = useState([]);
  const [mode, setMode] = useState('bySpace');
  const [spaces, setSpaces] = useState([emptySpace()]);
  const [projectKey, setProjectKey] = useState('');
  const [releaseName, setReleaseName] = useState('');
  const [releaseNameOptions, setReleaseNameOptions] = useState([]);
  const [futureCount, setFutureCount] = useState(4);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    view.theme.enable().catch(() => {});
    Promise.all([
      invoke('getCapacityEnabledProjects', { releaseMappingFilter: true }),
      view.getContext().catch(() => ({})),
    ]).then(([proj, ctx]) => {
      if (proj.error) setError(proj.error);
      setProjects(proj.projects ?? []);

      const cfg = ctx?.extension?.gadgetConfiguration ?? {};
      setMode(cfg.mode === 'byRelease' ? 'byRelease' : 'bySpace');
      setReleaseName(cfg.releaseName ?? '');
      setProjectKey(cfg.projectKey ?? '');
      setFutureCount(Math.min(6, Math.max(1, cfg.futureCount ?? 4)));

      const savedSpaces = Array.isArray(cfg.spaces) && cfg.spaces.length > 0 ? cfg.spaces : [{ projectKey: '' }];
      setSpaces(savedSpaces.map(s => ({ projectKey: s.projectKey ?? '' })));
    }).catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  // Populates the "Default Release"/"Current release" dropdown with the
  // union of release names for whatever space(s) are relevant to the active
  // mode — same rollup resolver the View itself uses, just to preview names.
  useEffect(() => {
    const relevantSpaces = mode === 'byRelease'
      ? (projectKey ? [{ projectKey }] : [])
      : spaces.filter(s => s.projectKey);
    if (relevantSpaces.length === 0) { setReleaseNameOptions([]); return; }
    invoke('getReleaseCapacityRollup', { spaces: relevantSpaces, releaseName: null, todayISO: localTodayISO() })
      .then(res => {
        const names = new Set();
        (res.results ?? []).forEach(r => (r.releaseNames ?? []).forEach(n => names.add(n)));
        setReleaseNameOptions([...names].sort());
      })
      .catch(() => setReleaseNameOptions([]));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, projectKey, JSON.stringify(spaces.map(s => s.projectKey))]);

  const updateSpace = (index, patch) => {
    setSpaces(cur => cur.map((s, i) => i === index ? { ...s, ...patch } : s));
  };

  const handleProjectChange = (index, key) => updateSpace(index, { projectKey: key });

  const addSpace = () => setSpaces(cur => [...cur, emptySpace()]);
  const removeSpace = (index) => setSpaces(cur => cur.filter((_, i) => i !== index));

  const takenKeys = new Set(spaces.map(s => s.projectKey).filter(Boolean));
  const canSave = mode === 'byRelease'
    ? !!projectKey
    : spaces.length > 0 && spaces.every(s => s.projectKey);

  const handleSave = async () => {
    setSaving(true);
    try {
      await view.submit({
        mode, spaces: spaces.map(({ projectKey }) => ({ projectKey })),
        projectKey, releaseName: releaseName || null, futureCount,
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

      <Section title="Chart mode">
        <select value={mode} onChange={e => setMode(e.target.value)} style={S.select}>
          <option value="bySpace">By space — one release, all spaces</option>
          <option value="byRelease">By release — one space's roadmap, multiple releases</option>
        </select>
      </Section>

      <div style={S.divider} />

      {mode === 'bySpace' ? (
        <Section title="Spaces">
          {projects.length === 0 && (
            <div style={S.hint}>
              No spaces have Release Mapping enabled yet. Turn it on in a project's Settings → Capacity Planning
              before adding it here.
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
      ) : (
        <Section title="Space">
          {projects.length === 0 && (
            <div style={S.hint}>
              No spaces have Release Mapping enabled yet. Turn it on in a project's Settings → Capacity Planning
              before adding it here.
            </div>
          )}
          <select value={projectKey} onChange={e => setProjectKey(e.target.value)} style={S.select}>
            <option value="">Select a space…</option>
            {projects.map(p => <option key={p.key} value={p.key}>{p.name} ({p.key})</option>)}
          </select>
        </Section>
      )}

      <div style={S.divider} />

      <Section title={mode === 'byRelease' ? 'Current release' : 'Default Release'}>
        <select value={releaseName} onChange={e => setReleaseName(e.target.value)} style={S.select}>
          <option value="">Auto — next release per space</option>
          {releaseNameOptions.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        {mode === 'byRelease' ? (
          <div style={S.hint}>
            Auto mode picks the soonest-upcoming release for this space. Unlike "By space" mode, this isn't
            changeable live on the gadget itself — the live control there instead lets viewers pick how many
            releases to show.
          </div>
        ) : (
          <div style={S.hint}>
            Viewers can change this on the gadget itself — this is only the starting selection. Auto mode picks
            the soonest-upcoming release independently per space, so different bars can show different release
            names; a specific release name is matched against each space's own releases.
          </div>
        )}
      </Section>

      {mode === 'byRelease' && (
        <>
          <div style={S.divider} />
          <Section title="Future releases to show">
            <select value={futureCount} onChange={e => setFutureCount(parseInt(e.target.value, 10))} style={{ ...S.select, width: 120 }}>
              {FUTURE_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
            <div style={S.hint}>
              Shown alongside the current release, in addition to it. Viewers can change this count live on the
              gadget itself — this is only the starting default.
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
