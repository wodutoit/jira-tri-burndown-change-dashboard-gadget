import React, { useState, useEffect } from 'react';
import { invoke, view } from '@forge/bridge';
import { editStyles as S, Section } from './sprintConfigShared';
import { localTodayISO } from './gadgetUtils';
import VelocitySpaceRow from './VelocitySpaceRow';

const RELEASE_COUNT_OPTIONS = [1, 2, 3, 4, 5, 6];
const PREVIOUS_RELEASE_OPTIONS = [0, 1, 2, 3, 5, 10, 'all'];
const SHOW_OPTIONS = [
  { value: 'both', label: 'Each space and the Total' },
  { value: 'spaces', label: 'Each space only' },
  { value: 'total', label: 'Total only' },
];

export default function TriPortfolioDistributionGadgetEdit() {
  const [projects, setProjects] = useState([]);
  const [mode, setMode] = useState('byRelease');
  const [spaces, setSpaces] = useState([{ projectKey: '' }]);
  const [show, setShow] = useState('both');
  const [projectKey, setProjectKey] = useState('');
  const [releaseName, setReleaseName] = useState('');
  const [releaseNameOptions, setReleaseNameOptions] = useState([]);
  const [releaseCount, setReleaseCount] = useState(4);
  const [previousReleaseCount, setPreviousReleaseCount] = useState(3);
  const [chartStyle, setChartStyle] = useState('donut');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    view.theme.enable().catch(() => {});
    Promise.all([
      // Scrum spaces with Portfolio Planning on and a category field chosen.
      invoke('getCapacityEnabledProjects', { boardTypeFilter: 'scrum', portfolioFilter: true }),
      view.getContext().catch(() => ({})),
    ]).then(([proj, ctx]) => {
      if (proj.error) setError(proj.error);
      setProjects(proj.projects ?? []);

      const cfg = ctx?.extension?.gadgetConfiguration ?? {};
      setMode(cfg.mode === 'bySpace' ? 'bySpace' : 'byRelease');
      setShow(['both', 'spaces', 'total'].includes(cfg.show) ? cfg.show : 'both');
      setReleaseName(cfg.releaseName ?? '');
      setProjectKey(cfg.projectKey ?? '');
      setReleaseCount(Math.min(6, Math.max(1, cfg.releaseCount ?? 4)));
      setPreviousReleaseCount(PREVIOUS_RELEASE_OPTIONS.includes(cfg.previousReleaseCount) ? cfg.previousReleaseCount : 3);
      setChartStyle(cfg.chartStyle === 'bullet' ? 'bullet' : 'donut');
      const saved = Array.isArray(cfg.spaces) && cfg.spaces.length > 0 ? cfg.spaces : [{ projectKey: '' }];
      setSpaces(saved.map(s => ({ projectKey: s.projectKey ?? '' })));
    }).catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  // Default-release dropdown: the union of release names for the space(s) this
  // mode uses, via the same resolver the View calls (names only matter here).
  useEffect(() => {
    const relevant = mode === 'bySpace'
      ? (projectKey ? [{ projectKey }] : [])
      : spaces.filter(s => s.projectKey);
    if (relevant.length === 0) { setReleaseNameOptions([]); return; }
    let ignore = false;
    const call = mode === 'bySpace'
      ? invoke('getPortfolioRoadmapDistribution', { projectKey, releaseName: null, releaseCount: 1, todayISO: localTodayISO(), previousReleaseCount })
      : invoke('getPortfolioReleaseDistribution', { spaces: relevant, releaseName: null, todayISO: localTodayISO(), previousReleaseCount });
    call.then(res => {
      if (ignore) return;
      const names = mode === 'bySpace'
        ? (res.releaseNames ?? [])
        : (res.results ?? []).flatMap(r => r.releaseNames ?? []);
      setReleaseNameOptions([...new Set(names)].sort());
    }).catch(() => { if (!ignore) setReleaseNameOptions([]); });
    return () => { ignore = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, projectKey, previousReleaseCount, JSON.stringify(spaces.map(s => s.projectKey))]);

  const updateSpace = (index, patch) => setSpaces(cur => cur.map((s, i) => i === index ? { ...s, ...patch } : s));
  const takenKeys = new Set(spaces.map(s => s.projectKey).filter(Boolean));
  const canSave = mode === 'bySpace'
    ? !!projectKey
    : spaces.length > 0 && spaces.every(s => s.projectKey);

  const handleSave = async () => {
    setSaving(true);
    try {
      await view.submit({
        mode, show, spaces: spaces.map(({ projectKey }) => ({ projectKey })),
        projectKey, releaseName: releaseName || null, releaseCount, previousReleaseCount, chartStyle,
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div style={{ padding: 20, fontSize: 13, fontFamily: 'inherit' }}>Loading…</div>;

  const noSpaces = projects.length === 0;
  const noSpacesHint = (
    <div style={S.hint}>
      No spaces are available. A space needs to be a Scrum space with Capacity Planning, Release Mapping and
      Portfolio Planning all turned on (Settings → Capacity Planning), and a portfolio category field selected.
    </div>
  );

  return (
    <div style={S.wrap}>
      {error && <div style={S.error}>{error}</div>}

      <Section title="View mode">
        <select value={mode} onChange={e => setMode(e.target.value)} style={S.select}>
          <option value="byRelease">By release — one release, a chart per space</option>
          <option value="bySpace">By space — one space, a chart per release</option>
        </select>
      </Section>

      <div style={S.divider} />

      {mode === 'byRelease' ? (
        <>
          <Section title="Spaces">
            {noSpaces && noSpacesHint}
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
          </Section>

          <div style={S.divider} />

          <Section title="Show">
            <select value={show} onChange={e => setShow(e.target.value)} style={S.select}>
              {SHOW_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <div style={S.hint}>
              The Total merges categories across spaces by name and weights each space's target by its capacity for
              the release. It only appears when more than one space has data.
            </div>
          </Section>
        </>
      ) : (
        <Section title="Space">
          {noSpaces && noSpacesHint}
          <select value={projectKey} onChange={e => setProjectKey(e.target.value)} style={S.select}>
            <option value="">Select a space…</option>
            {projects.map(p => <option key={p.key} value={p.key}>{p.name} ({p.key})</option>)}
          </select>
        </Section>
      )}

      <div style={S.divider} />

      <Section title={mode === 'bySpace' ? 'Current release' : 'Default release'}>
        <select value={releaseName} onChange={e => setReleaseName(e.target.value)} style={S.select}>
          <option value="">Auto — next release{mode === 'byRelease' ? ' per space' : ''}</option>
          {releaseNameOptions.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <div style={S.hint}>
          {mode === 'byRelease'
            ? 'Viewers can change this on the gadget itself — this is only the starting selection.'
            : 'The first of the releases shown. Auto picks the space\'s soonest-upcoming release.'}
        </div>
      </Section>

      {mode === 'bySpace' && (
        <>
          <div style={S.divider} />
          <Section title="Releases to show">
            <select value={releaseCount} onChange={e => setReleaseCount(parseInt(e.target.value, 10))} style={{ ...S.select, width: 120 }}>
              {RELEASE_COUNT_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <div style={S.hint}>
              Total number of charts, starting with the current release. Viewers can change this live on the gadget.
            </div>
          </Section>
        </>
      )}

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
          How many already-released releases to offer in the Release dropdown, most recent first. Unreleased
          releases are always listed.
        </div>
      </Section>

      <div style={S.divider} />

      <Section title="Chart style">
        <select value={chartStyle} onChange={e => setChartStyle(e.target.value)} style={S.select}>
          <option value="donut">Donut with target ring (outer ring actual, inner ring target)</option>
          <option value="bullet">Bullet bars (bar = actual, tick = target, shaded = tolerance)</option>
        </select>
        <div style={S.hint}>The starting style — viewers can switch on the gadget itself.</div>
      </Section>

      <button onClick={handleSave} disabled={saving || !canSave} style={{ ...S.btn, opacity: (saving || !canSave) ? 0.5 : 1 }}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
