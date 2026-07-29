import React, { useState, useEffect } from 'react';
import { invoke, view } from '@forge/bridge';
import { useVelocityEffectiveSpaces } from './useVelocityEffectiveSpaces';

const TRACK_H = 70;
const BAR_W = 15;
const BAR_GAP = 2;
// Value labels float above each bar via a negative transform, which can escape the
// track's own box when a bar is near its tallest. Reserving this much margin above
// the track keeps that label inside the row's layout box instead of overlapping
// whatever sits above it, or getting clipped by an ancestor's overflow:auto scroll.
const LABEL_HEADROOM = 16;
const SPRINT_OPTIONS = Array.from({ length: 10 }, (_, i) => i + 1);

// "dd/MMM", e.g. "17/Jul" — the format requested for the per-bar date range.
function fmtDDMMM(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    const dd = String(d.getDate()).padStart(2, '0');
    const mmm = d.toLocaleDateString(undefined, { month: 'short' });
    return `${dd}/${mmm}`;
  } catch { return iso; }
}

// Real sprints/iterations show their name plus a "dd/MMM - dd/MMM" range;
// the synthetic Total-chart rank labels (buildTotals, no name/dates) just
// show their rank label alone.
function periodLabel(s) {
  if (s.label) return { name: s.label, range: null };
  const range = (s.startDate && s.endDate) ? `${fmtDDMMM(s.startDate)} - ${fmtDDMMM(s.endDate)}` : '';
  return { name: s.name ?? '', range };
}

// Width of one bar group's slot — shared with SpaceRow so it can size the
// leading placeholder slots (see barGroupWidth below) to exactly match.
function barGroupWidth(showCapacity) {
  const count = showCapacity ? 3 : 2;
  return count * BAR_W + (count - 1) * BAR_GAP + 6;
}

function BarGroup({ name, range, capacity, committed, actual, maxScale, showCapacity }) {
  const bars = [
    ...(showCapacity ? [['var(--brand)', capacity]] : []),
    ['var(--filling)', committed],
    ['var(--ok)', actual],
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: barGroupWidth(showCapacity) }}>
      <div style={{ display: 'flex', gap: BAR_GAP, alignItems: 'flex-end', height: TRACK_H, marginTop: LABEL_HEADROOM }}>
        {bars.map(([color, val], i) => {
          const h = maxScale ? Math.min(100, val / maxScale * 100) : 0;
          return (
            <div key={i} style={{ position: 'relative', width: BAR_W, height: TRACK_H }}>
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: `${h}%`, background: color, borderRadius: '2px 2px 0 0' }} />
              <span style={{ position: 'absolute', left: '50%', bottom: `${h}%`, transform: 'translate(-50%, -100%)', fontSize: 9, fontWeight: 700, color: 'var(--text)', whiteSpace: 'nowrap' }}>
                {val}
              </span>
            </div>
          );
        })}
      </div>
      <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-subtlest)', whiteSpace: 'nowrap' }}>{name}</span>
      {range && <span style={{ fontSize: 8, color: 'var(--text-subtlest)', whiteSpace: 'nowrap' }}>{range}</span>}
    </div>
  );
}

function SpaceRow({ name, sprints, sprintCount, showCapacityBar }) {
  const shown = sprints.slice(Math.max(0, sprints.length - sprintCount));

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
      <div style={{ width: 110, flexShrink: 0, fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>{name}</div>
      {shown.length === 0 ? (
        <div style={{ flex: 1, fontSize: 12, color: 'var(--text-subtlest)' }}>No closed sprints/completed iterations found.</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, flex: 1, overflowX: 'auto', paddingBottom: 2, justifyContent: 'space-evenly' }}>
            {/* Leading empty slots, sized to match a real bar group, so every row always has
                `sprintCount` total slots — that's what makes the real bars both fill the row's
                full width (space-evenly has something to distribute) and land in the same
                slots across rows (a space with fewer periods than sprintCount just has more
                empty slots up front, so its latest period still lines up with every other
                row's latest period). */}
            {Array.from({ length: Math.max(0, sprintCount - shown.length) }, (_, i) => (
              <div key={`pad-${i}`} style={{ width: barGroupWidth(showCapacityBar), flexShrink: 0 }} />
            ))}
            {(() => {
              const values = shown.flatMap(s => showCapacityBar ? [s.capacity, s.committed, s.velocity] : [s.committed, s.velocity]);
              const maxScale = Math.max(1, ...values) * 1.15;
              return shown.map(s => {
                const { name: periodName, range } = periodLabel(s);
                return (
                  <BarGroup
                    key={s.id}
                    name={periodName}
                    range={range}
                    capacity={s.capacity}
                    committed={s.committed}
                    actual={s.velocity}
                    maxScale={maxScale}
                    showCapacity={showCapacityBar}
                  />
                );
              });
            })()}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-subtle)', whiteSpace: 'nowrap', textAlign: 'right', flexShrink: 0 }}>
            {showCapacityBar && <div>Avg Capacity: {Math.round(shown.reduce((s, x) => s + x.capacity, 0) / shown.length)}</div>}
            <div>Avg Commitment: {Math.round(shown.reduce((s, x) => s + x.committed, 0) / shown.length)}</div>
            <div>Avg Velocity: {Math.round(shown.reduce((s, x) => s + x.velocity, 0) / shown.length)}</div>
          </div>
        </>
      )}
    </div>
  );
}

function Legend({ showCapacityBar }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: 'var(--text-subtle)' }}>
      {showCapacityBar && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--brand)', display: 'inline-block' }} />
          Capacity
        </span>
      )}
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
    let capacity = 0, committed = 0, velocity = 0, any = false;
    for (const space of spacesData) {
      const idx = space.sprints.length - rank;
      if (idx >= 0) {
        capacity  += space.sprints[idx].capacity;
        committed += space.sprints[idx].committed;
        velocity  += space.sprints[idx].velocity;
        any = true;
      }
    }
    if (any) ranked.push({ id: `rank-${rank}`, capacity, committed, velocity });
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
  const showCapacityBar = config?.showCapacityBar !== false;

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
            Periods shown{source.usingFilter && <span style={{ fontWeight: 400, textTransform: 'none' }}> · via TRI Sprint Filter</span>}
          </span>
          <select
            value={sprintCount}
            onChange={e => setSprintCount(parseInt(e.target.value, 10))}
            style={{ border: '1px solid var(--border)', borderRadius: 4, padding: '5px 8px', fontSize: 13, color: 'var(--text)', background: 'var(--surface)', fontFamily: 'inherit' }}
          >
            {SPRINT_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <Legend showCapacityBar={showCapacityBar} />
      </div>

      {showPerSpace && spacesData.map(space => (
        space.error
          ? <div key={space.projectKey} style={{ padding: '10px 0', fontSize: 12, color: 'var(--over-text)' }}>{space.name}: {space.error}</div>
          : <SpaceRow key={space.projectKey} name={space.name} sprints={space.sprints} sprintCount={sprintCount} showCapacityBar={showCapacityBar} />
      ))}

      {showTotal && <SpaceRow name="Total" sprints={totals} sprintCount={sprintCount} showCapacityBar={showCapacityBar} />}

      {showTotal && (
        <div style={{ fontSize: 10, color: 'var(--text-subtlest)', marginTop: 8 }}>
          * Total aligns sprints by recency across spaces (most recent, 2nd-most-recent, …), not by calendar date.
        </div>
      )}
    </div>
  );
}
