import React, { useState, useEffect } from 'react';
import { invoke, view } from '@forge/bridge';
import { useVelocityEffectiveSpaces } from './useVelocityEffectiveSpaces';

const TRACK_H = 70;
const BAR_W = 15;
// Value labels float above each bar via a negative transform, which can escape the
// track's own box when a bar is near its tallest. Reserving this much margin above
// the track keeps that label inside the row's layout box instead of overlapping
// whatever sits above it, or getting clipped by an ancestor's overflow:auto scroll.
const LABEL_HEADROOM = 16;
const SPRINT_OPTIONS = Array.from({ length: 10 }, (_, i) => i + 1);

function fmtShort(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
  catch { return iso; }
}

function BarGroup({ label, committed, actual, maxScale }) {
  const cH = maxScale ? Math.min(100, committed / maxScale * 100) : 0;
  const aH = maxScale ? Math.min(100, actual / maxScale * 100) : 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: BAR_W * 2 + 6 }}>
      <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: TRACK_H, marginTop: LABEL_HEADROOM }}>
        {[['var(--filling)', committed, cH], ['var(--ok)', actual, aH]].map(([color, val, h], i) => (
          <div key={i} style={{ position: 'relative', width: BAR_W, height: TRACK_H }}>
            <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${h}%`, background: color, borderRadius: '2px 2px 0 0' }} />
            <span style={{ position: 'absolute', left: '50%', bottom: `${h}%`, transform: 'translate(-50%, -100%)', fontSize: 9, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' }}>
              {val}
            </span>
          </div>
        ))}
      </div>
      <span style={{ fontSize: 9, color: 'var(--text-subtlest)', whiteSpace: 'nowrap' }}>{label}</span>
    </div>
  );
}

function SpaceRow({ name, sprints, sprintCount }) {
  const shown = sprints.slice(Math.max(0, sprints.length - sprintCount));

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ width: 110, flexShrink: 0, fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>{name}</div>
      {shown.length === 0 ? (
        <div style={{ flex: 1, fontSize: 12, color: 'var(--text-subtlest)' }}>No closed sprints found.</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, flex: 1, overflowX: 'auto', paddingBottom: 2 }}>
            {(() => {
              const maxScale = Math.max(1, ...shown.flatMap(s => [s.committed, s.velocity])) * 1.15;
              return shown.map(s => (
                <BarGroup key={s.id} label={s.label ?? fmtShort(s.endDate)} committed={s.committed} actual={s.velocity} maxScale={maxScale} />
              ));
            })()}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-subtle)', whiteSpace: 'nowrap', textAlign: 'right', flexShrink: 0 }}>
            <div>Avg Commitment: {Math.round(shown.reduce((s, x) => s + x.committed, 0) / shown.length)}</div>
            <div>Avg Velocity: {Math.round(shown.reduce((s, x) => s + x.velocity, 0) / shown.length)}</div>
          </div>
        </>
      )}
    </div>
  );
}

function Legend() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: 'var(--text-subtle)' }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--filling)', display: 'inline-block' }} />
        Committed
      </span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--ok)', display: 'inline-block' }} />
        Completed
      </span>
    </div>
  );
}

// Different spaces close sprints on their own boards' cadence, so there's no
// shared calendar date to join on. Aligns by recency rank instead — "most
// recent", "2nd-most-recent", etc. — the only join key that makes sense
// across independently-scheduled boards.
function buildTotals(spacesData) {
  const maxLen = Math.max(0, ...spacesData.map(s => s.sprints.length));
  const ranked = [];
  for (let rank = 1; rank <= maxLen; rank++) {
    let committed = 0, velocity = 0, any = false;
    for (const space of spacesData) {
      const idx = space.sprints.length - rank;
      if (idx >= 0) {
        committed += space.sprints[idx].committed;
        velocity  += space.sprints[idx].velocity;
        any = true;
      }
    }
    if (any) ranked.push({ id: `rank-${rank}`, committed, velocity });
  }
  ranked.reverse(); // oldest -> newest, left-to-right like every other chart here
  return ranked.map((t, i) => ({ ...t, label: i === ranked.length - 1 ? 'Latest' : `T-${ranked.length - 1 - i}` }));
}

export default function TriVelocityGadgetView() {
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [config, setConfig]       = useState(null);
  const [spacesData, setSpacesData] = useState([]);
  const [sprintCount, setSprintCount] = useState(5);
  const [fetching, setFetching]   = useState(false);

  const source = useVelocityEffectiveSpaces(config);
  const hasConfig = !!config && Array.isArray(config.spaces) && config.spaces.length > 0;

  useEffect(() => {
    view.theme.enable().catch(() => {});
    view.getContext().catch(() => ({}))
      .then(ctx => {
        const cfg = ctx?.extension?.gadgetConfiguration ?? {};
        setConfig(cfg);
        setSprintCount(Math.min(10, Math.max(1, cfg.sprintCount ?? 5)));
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!hasConfig || !source.ready || !source.spaces?.length) return;
    setFetching(true);
    setError(null);
    invoke('getVelocityData', { spaces: source.spaces })
      .then(res => {
        if (res.error) setError(res.error);
        setSpacesData(res.spaces ?? []);
      })
      .catch(e => setError(String(e)))
      .finally(() => setFetching(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasConfig, source.ready, JSON.stringify(source.spaces)]);

  if (loading || (hasConfig && !source.ready)) {
    return <div style={{ padding: 24, fontSize: 13 }}>Loading…</div>;
  }
  if (!hasConfig) {
    return <div style={{ padding: 16, color: 'var(--text-subtlest)', fontSize: 13 }}>Edit this gadget to choose at least one space.</div>;
  }
  if (error) {
    return <div style={{ padding: 16, color: 'var(--over-text)', fontSize: 13 }}>Failed to load: {error}</div>;
  }
  if (fetching && spacesData.length === 0) {
    return <div style={{ padding: 24, fontSize: 13 }}>Loading…</div>;
  }

  const isMulti      = spacesData.length > 1;
  const showPerSpace = !(isMulti && config.onlyShowTotal);
  const showTotal    = isMulti && !!config.showTotal;
  const totals       = showTotal ? buildTotals(spacesData) : [];

  return (
    <div style={{ padding: '14px 16px 16px', fontFamily: 'inherit', color: 'var(--text)', fontSize: 13 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase', color: 'var(--text-subtlest)' }}>
            Closed sprints{source.usingFilter && <span style={{ fontWeight: 400, textTransform: 'none' }}> · via TRI Sprint Filter</span>}
          </span>
          <select
            value={sprintCount}
            onChange={e => setSprintCount(parseInt(e.target.value, 10))}
            style={{ border: '1px solid var(--border)', borderRadius: 4, padding: '5px 8px', fontSize: 13, color: 'var(--text)', background: 'var(--surface)', fontFamily: 'inherit' }}
          >
            {SPRINT_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <Legend />
      </div>

      {source.usingDefaultMapping && (
        <div style={{ fontSize: 11, color: 'var(--text-subtlest)', marginBottom: 8 }}>
          Using a best-guess status mapping for the filter's space — edit this gadget to refine it.
        </div>
      )}

      {showPerSpace && spacesData.map(space => (
        space.error
          ? <div key={space.projectKey} style={{ padding: '10px 0', fontSize: 12, color: 'var(--over-text)' }}>{space.name}: {space.error}</div>
          : <SpaceRow key={space.projectKey} name={space.name} sprints={space.sprints} sprintCount={sprintCount} />
      ))}

      {showTotal && <SpaceRow name="Total" sprints={totals} sprintCount={sprintCount} />}

      {showTotal && (
        <div style={{ fontSize: 10, color: 'var(--text-subtlest)', marginTop: 8 }}>
          * Total aligns sprints by recency across spaces (most recent, 2nd-most-recent, …), not by calendar date.
        </div>
      )}
    </div>
  );
}
