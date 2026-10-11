import React, { useState, useEffect } from 'react';
import { invoke, view } from '@forge/bridge';
import { editStyles as S, Section } from './sprintConfigShared';
import { localTodayISO } from './gadgetUtils';
import VelocitySpaceRow from './VelocitySpaceRow';

const PREVIOUS_RELEASE_OPTIONS = [0, 1, 2, 3, 5, 10, 'all'];

// Config mirrors TRI Release Capacity / TRI Portfolio Distribution (spaces,
// default release, previous releases to list) so the filter's dropdown offers
// the same list those gadgets do. The release itself is picked in view mode.
export default function TriReleaseFilterGadgetEdit() {
  const [projects, setProjects] = useState([]);
  const [spaces, setSpaces] = useState([{ projectKey: '' }]);
  const [releaseName, setReleaseName] = useState('');
  const [releaseNameOptions, setReleaseNameOptions] = useState([]);
  const [previousReleaseCount, setPreviousReleaseCount] = useState(3);
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
      setReleaseName(cfg.releaseName ?? '');
      setPreviousReleaseCount(PREVIOUS_RELEASE_OPTIONS.includes(cfg.previousReleaseCount) ? cfg.previousReleaseCount : 3);
      const saved = Array.isArray(cfg.spaces) && cfg.spaces.length > 0 ? cfg.spaces : [{ projectKey: '' }];
      setSpaces(saved.map(s => ({ projectKey: s.projectKey ?? '' })));
    }).catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const relevant = spaces.filter(s => s.projectKey);
    if (relevant.length === 0) { setReleaseNameOptions([]); return; }
    let ignore = false;
    invoke('getReleaseCapacityRollup', { spaces: relevant, releaseName: null, todayISO: localTodayISO(), previousReleaseCount })
      .then(res => {
        if (ignore) return;
        const names = new Set();
        (res.results ?? []).forEach(r => (r.releaseNames ?? []).forEach(n => names.add(n)));
        setReleaseNameOptions([...names].sort());
      })
      .catch(() => { if (!ignore) setReleaseNameOptions([]); });
    return () => { ignore = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previousReleaseCount, JSON.stringify(spaces.map(s => s.projectKey))]);

  const updateSpace = (index, patch) => setSpaces(cur => cur.map((s, i) => i === index ? { ...s, ...patch } : s));
  const takenKeys = new Set(spaces.map(s => s.projectKey).filter(Boolean));
  const canSave = spaces.length > 0 && spaces.every(s => s.projectKey);
  const noSpaces = projects.length === 0;

  const handleSave = async () => {
    setSaving(true);
    try {
      await view.submit({
        spaces: spaces.map(({ projectKey }) => ({ projectKey })),
        releaseName: releaseName || null,
        previousReleaseCount,
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ padding: 20, fontSize: 13, fontFamily: 'inherit' }}>Loading…</div>;

  return (
    <div style={S.wrap}>
      {error && <div style={S.error}>{error}</div>}

      <Section title="Spaces">
        {noSpaces && (
          <div style={S.hint}>
            No spaces have Release Mapping enabled yet. Turn it on in a project's Settings → Capacity Planning
            before adding it here.
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {spaces.map((space, i) => (
            <VelocitySpaceRow
              key={i} index={i} space={space} projects={projects} takenKeys={takenKeys}
              onProjectChange={key => updateSpace(i, { projectKey: key })}
              onRemove={() => setSpaces(cur => cur.filter((_, j) => j !== i))}
              canRemove={spaces.length > 1}
            />
          ))}
        </div>
        <button
          onClick={() => setSpaces(cur => [...cur, { projectKey: '' }])}
          disabled={noSpaces}
          style={{ alignSelf: 'flex-start', marginTop: 4, background: 'none', border: '1px dashed var(--border)', borderRadius: 4, padding: '6px 12px', fontSize: 12, color: 'var(--text-subtle)', cursor: noSpaces ? 'default' : 'pointer', fontFamily: 'inherit', opacity: noSpaces ? 0.5 : 1 }}
        >
          + Add another space
        </button>
        <div style={S.hint}>
          The release list offered on the dashboard is the union of these spaces' releases. Any TRI Release
          Capacity ("By space") or TRI Portfolio Distribution ("By release") gadget on this dashboard with "Use
          dashboard release filter" turned on follows the release selected here.
        </div>
      </Section>

      <div style={S.divider} />

      <Section title="Default release">
        <select value={releaseName} onChange={e => setReleaseName(e.target.value)} style={S.select}>
          <option value="">Auto — next release per space</option>
          {releaseNameOptions.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <div style={S.hint}>
          The starting selection, used until someone picks a release on the gadget. Auto picks the
          soonest-upcoming release independently per space.
        </div>
      </Section>

      <div style={S.divider} />

      <Section title="Previous releases to list">
        <select
          value={previousReleaseCount}
          onChange={e => setPreviousReleaseCount(e.target.value === 'all' ? 'all' : parseInt(e.target.value, 10))}
          style={{ ...S.select, width: 120 }}
        >
          {PREVIOUS_RELEASE_OPTIONS.map(n => <option key={n} value={n}>{n === 'all' ? 'All' : n}</option>)}
        </select>
        <div style={S.hint}>
          How many already-released releases to offer in the Release dropdown, most recent first. All
          unreleased releases are always listed. Match this to the gadgets' own setting so the lists agree.
        </div>
      </Section>

      <button onClick={handleSave} disabled={saving || !canSave} style={{ ...S.btn, opacity: (saving || !canSave) ? 0.5 : 1 }}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
