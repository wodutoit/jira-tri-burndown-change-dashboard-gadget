import React, { useState, useEffect } from 'react';
import { invoke, view } from '@forge/bridge';
import { localTodayISO, classifyReleaseStatus } from './gadgetUtils';

const TRACK_H = 130;
const RELEASE_COUNT_OPTIONS = [1, 2, 3, 4, 5, 6];

// Shares tier boundaries with the Capacity page's Releases summary table
// (classifyReleaseStatus, gadgetUtils.js) but not its presentation — this
// gadget needs a genuine traffic-light green/amber/red plus a distinct
// "no capacity set" grey, matching the reference gadget's OK/FILLING/OVER/
// SET CAP states.
const TIER_FILL  = { within: 'var(--ok)', overThreshold: 'var(--filling)', overCapacity: 'var(--over)', none: 'var(--border)' };
const TIER_CHIP  = {
  within:        { bg: 'var(--ok-bg)',      text: 'var(--ok-text)' },
  overThreshold: { bg: 'var(--filling-bg)', text: 'var(--filling-text)' },
  overCapacity:  { bg: 'var(--over-bg)',    text: 'var(--over-text)' },
  none:          { bg: 'transparent',       text: 'var(--text-subtlest)' },
};
const TIER_LABEL = { within: 'OK', overThreshold: 'FILLING', overCapacity: 'OVER', none: 'SET CAP' };

function fmtDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return String(iso).slice(0, 10); }
}

function Legend() {
  const Swatch = ({ color, dashed, label }) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {dashed ? (
        <svg width="14" height="8"><line x1="0" y1="4" x2="14" y2="4" stroke={color} strokeWidth="2" strokeDasharray="4 2" /></svg>
      ) : (
        <span style={{ width: 8, height: 8, borderRadius: 2, background: color, display: 'inline-block' }} />
      )}
      {label}
    </span>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: 'var(--text-subtle)', flexWrap: 'wrap' }}>
      <Swatch color="var(--ok)" label="OK" />
      <Swatch color="var(--filling)" label="Filling" />
      <Swatch color="var(--over)" label="Over" />
      <Swatch color="var(--filling)" dashed label="Threshold" />
      <Swatch color="var(--text-subtlest)" label="Capacity" />
    </div>
  );
}

// One flat dashed Threshold line and one flat solid Capacity line spanning
// the whole row. `capPct`/`thresholdPct` are already expressed as a %-height
// of the track (0-100), computed by BarColumns from the same %-of-capacity
// scale every bar's own fill height uses — so "the cap line" and "a bar
// reaching capacity" are, by construction, the same height. That's what
// makes one flat line correct for BOTH chart modes: 100%-of-capacity is
// always the same relative height regardless of any bar's absolute capacity
// number, unlike the previous (wrong) approach, which scaled bars by absolute
// story points against a shared aggregate.
function OverlayLines({ capPct, thresholdPct, thresholdLabel }) {
  return (
    <div style={{ position: 'absolute', left: 4, right: 4, top: 20, height: TRACK_H, pointerEvents: 'none', zIndex: 5 }}>
      {thresholdPct != null && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: `${thresholdPct}%`, borderTop: '2px dashed var(--filling)' }}>
          {thresholdLabel != null && (
            <span style={{ position: 'absolute', right: -2, top: -8, background: 'var(--filling)', color: '#fff', fontSize: 9, fontWeight: 800, padding: '1px 4px', borderRadius: 3 }}>
              {thresholdLabel}%
            </span>
          )}
        </div>
      )}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: `${capPct}%`, borderTop: '2px solid var(--text-subtlest)', opacity: 0.5 }}>
        <span style={{ position: 'absolute', right: -2, top: -8, background: 'var(--text-subtlest)', color: 'var(--surface)', fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 3, letterSpacing: '.3px' }}>
          cap
        </span>
      </div>
    </div>
  );
}

// One TRACK_H bar column per item — identical logic for both chart modes,
// no special-casing. `topChip` (CURRENT/FUTURE) is only set in "By release"
// mode; the tier chip (OK/FILLING/OVER/SET CAP) always reflects that bar's
// own numbers.
//
// Bar height is each item's own committed-as-%-of-its-own-capacity (the
// exact number already shown in its label, e.g. "220/200 pts · 110%") on a
// shared 0-scaleMax% axis, NOT absolute story points on a shared SP scale.
// This is what makes "100% of capacity" — and so the cap line — land at the
// same relative height for every bar regardless of how different their
// absolute capacities are (a release with 50 pts of capacity and one with
// 200 both hit the cap line exactly when they reach their OWN 100%). The
// threshold line's %-of-capacity value is a blended aggregate across items
// (total threshold SP / total capacity) for "By space" mode, where each
// space can configure its own %; "By release" mode's items all share one
// project's single threshold %, so the same aggregate formula reduces to
// that exact value there — no special-casing needed for that mode either.
function BarColumns({ items }) {
  const pctOfCapacity = (item) => (item.totalCapacity ? (item.totalCommitted / item.totalCapacity) * 100 : 0);
  const scaleMax = Math.max(100, ...items.map(pctOfCapacity)) * 1.15;

  const withCapacity = items.filter(it => it.totalCapacity > 0);
  const aggCapacity = withCapacity.reduce((s, it) => s + it.totalCapacity, 0);
  const aggThresholdSp = withCapacity.reduce((s, it) => s + it.thresholdSp, 0);
  const thresholdPctValue = aggCapacity > 0 ? (aggThresholdSp / aggCapacity) * 100 : null;

  const capLinePct = (100 / scaleMax) * 100;
  const thresholdLinePct = thresholdPctValue != null ? (thresholdPctValue / scaleMax) * 100 : null;

  return (
    <div style={{ position: 'relative', display: 'flex', gap: 16, alignItems: 'flex-start', padding: '20px 4px 0' }}>
      <OverlayLines
        capPct={capLinePct} thresholdPct={thresholdLinePct}
        thresholdLabel={thresholdPctValue != null ? Math.round(thresholdPctValue) : null}
      />
      {items.map(item => {
        const { tier } = classifyReleaseStatus(item.totalCommitted, item.totalCapacity, item.thresholdPct);
        const ownPct = pctOfCapacity(item);
        const heightPct = item.totalCapacity ? Math.min(100, (ownPct / scaleMax) * 100) : 0;
        const pct = item.totalCapacity ? Math.round(ownPct) : null;

        return (
          <div key={item.key} style={{
            display: 'flex', flexDirection: 'column', alignItems: 'stretch', flex: '1 1 0', minWidth: 0,
            ...(item.isTotal ? { borderLeft: '1px dashed var(--border)', paddingLeft: 14, marginLeft: 6 } : {}),
          }}>
            <div style={{
              position: 'relative', height: TRACK_H, borderRadius: 3, overflow: 'hidden',
              border: '1px solid var(--border)', background: 'var(--surface-sunken)',
            }}>
              {item.totalCapacity > 0 ? (
                <div style={{
                  position: 'absolute', left: 0, right: 0, bottom: 0, height: `${heightPct}%`,
                  background: TIER_FILL[tier], borderRadius: '3px 3px 0 0',
                }} />
              ) : (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: 6 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-subtlest)' }}>no capacity set</span>
                </div>
              )}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, paddingTop: 6 }}>
              {item.topChip && (
                <span style={{ display: 'inline-block', padding: '1px 7px', borderRadius: 3, fontSize: 9, fontWeight: 800, letterSpacing: '.4px', background: item.topChip.bg, color: item.topChip.text }}>
                  {item.topChip.label}
                </span>
              )}
              <span style={{ display: 'inline-block', padding: '1px 7px', borderRadius: 3, fontSize: 9, fontWeight: 800, letterSpacing: '.4px', background: TIER_CHIP[tier].bg, color: TIER_CHIP[tier].text }}>
                {TIER_LABEL[tier]}
              </span>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
                {item.label}
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-subtle)', fontVariantNumeric: 'tabular-nums' }}>
                {item.totalCapacity ? `${item.totalCommitted} / ${item.totalCapacity} pts · ${pct}%` : `${item.totalCommitted} pts · no cap`}
              </span>
              {item.sublabel && <span style={{ fontSize: 10, color: 'var(--text-subtlest)' }}>{item.sublabel}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function buildBySpaceItems(results) {
  const ok = results.filter(r => !r.error);
  const items = ok.map(r => ({
    key: r.projectKey, label: r.name, sublabel: r.releaseName,
    totalCommitted: r.totalCommitted, totalCapacity: r.totalCapacity,
    thresholdSp: r.thresholdSp, thresholdPct: r.thresholdPct,
  }));
  if (items.length > 1) {
    const totalCapacity = ok.reduce((s, r) => s + r.totalCapacity, 0);
    const thresholdSp = ok.reduce((s, r) => s + r.thresholdSp, 0);
    items.push({
      key: '__total', label: 'Total', isTotal: true,
      totalCommitted: ok.reduce((s, r) => s + r.totalCommitted, 0),
      totalCapacity, thresholdSp,
      // Blended % across every space, for the Total bar's own OK/FILLING/
      // OVER chip — not any single space's individual threshold setting.
      thresholdPct: totalCapacity > 0 ? Math.round((thresholdSp / totalCapacity) * 100) : null,
    });
  }
  return items;
}

function buildByReleaseItems(results) {
  return results.map((r, i) => ({
    key: r.releaseId, label: r.releaseName, sublabel: fmtDate(r.releaseDate),
    totalCommitted: r.totalCommitted, totalCapacity: r.totalCapacity,
    thresholdSp: r.thresholdSp, thresholdPct: r.thresholdPct,
    topChip: i === 0
      ? { label: 'CURRENT', bg: 'var(--info-bg)', text: 'var(--info-text)' }
      : { label: 'FUTURE', bg: 'var(--lz-n-bg)', text: 'var(--lz-n-text)' },
  }));
}

export default function TriReleaseCapacityGadgetView() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [config, setConfig] = useState(null);
  const [releaseName, setReleaseName] = useState('');
  const [releaseCount, setReleaseCount] = useState(4);
  const [spaceName, setSpaceName] = useState('');
  const [results, setResults] = useState([]);
  const [releaseNames, setReleaseNames] = useState([]);
  const [fetching, setFetching] = useState(false);

  const mode = config?.mode === 'byRelease' ? 'byRelease' : 'bySpace';
  const hasConfig = !!config && (mode === 'byRelease' ? !!config.projectKey : Array.isArray(config.spaces) && config.spaces.length > 0);

  useEffect(() => {
    view.theme.enable().catch(() => {});
    view.getContext().catch(() => ({}))
      .then(ctx => {
        const cfg = ctx?.extension?.gadgetConfiguration ?? {};
        setConfig(cfg);
        setReleaseName(cfg.releaseName ?? '');
        setReleaseCount(Math.min(6, Math.max(1, cfg.releaseCount ?? 4)));
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!hasConfig) return;
    // `ignore` guards against a stale response overwriting a newer one — if
    // the viewer changes "Releases to show" (or the Release dropdown) again
    // before the previous request finishes, both calls are in flight and
    // whichever RESOLVES last wins, not whichever was SENT last. Without
    // this guard, a slower earlier response landing after a newer one
    // silently reverts the chart to the wrong count — indistinguishable
    // from "changing the selection does nothing" if you toggle it a couple
    // of times while testing.
    let ignore = false;
    setFetching(true);
    setError(null);
    const todayISO = localTodayISO();
    const call = mode === 'byRelease'
      ? invoke('getReleaseRoadmapRollup', { projectKey: config.projectKey, releaseName: releaseName || null, releaseCount, todayISO })
      : invoke('getReleaseCapacityRollup', { spaces: config.spaces, releaseName: releaseName || null, todayISO });

    call.then(res => {
      if (ignore) return;
      if (res.error) setError(res.error);
      setResults(res.results ?? []);
      setSpaceName(res.name ?? '');
      setReleaseNames(mode === 'byRelease' ? (res.releaseNames ?? []) : [...new Set((res.results ?? []).flatMap(r => r.releaseNames ?? []))].sort());
    })
      .catch(e => { if (!ignore) setError(String(e)); })
      .finally(() => { if (!ignore) setFetching(false); });

    return () => { ignore = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasConfig, mode, releaseName, releaseCount]);

  if (loading) {
    return <div style={{ padding: 24, fontSize: 13 }}>Loading…</div>;
  }
  if (!hasConfig) {
    return <div style={{ padding: 16, color: 'var(--text-subtlest)', fontSize: 13 }}>Edit this gadget to choose at least one space.</div>;
  }
  if (error) {
    return <div style={{ padding: 16, color: 'var(--over-text)', fontSize: 13 }}>Failed to load: {error}</div>;
  }
  if (fetching && results.length === 0) {
    return <div style={{ padding: 24, fontSize: 13 }}>Loading…</div>;
  }

  const items = mode === 'byRelease' ? buildByReleaseItems(results) : buildBySpaceItems(results);
  const erroredSpaces = results.filter(r => r.error);

  return (
    <div style={{ padding: '14px 16px 16px', fontFamily: 'inherit', color: 'var(--text)', fontSize: 13 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 10 }}>
        {mode === 'byRelease' ? (
          <div style={{ display: 'flex', gap: 20, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase', color: 'var(--text-subtlest)' }}>Space</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)', padding: '5px 0' }}>{spaceName || '—'}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase', color: 'var(--text-subtlest)' }}>Releases to show</span>
              <select
                value={releaseCount}
                onChange={e => setReleaseCount(parseInt(e.target.value, 10))}
                style={{ border: '1px solid var(--border)', borderRadius: 4, padding: '5px 8px', fontSize: 13, color: 'var(--text)', background: 'var(--surface)', fontFamily: 'inherit', width: 120 }}
              >
                {RELEASE_COUNT_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase', color: 'var(--text-subtlest)' }}>Release</span>
            <select
              value={releaseName}
              onChange={e => setReleaseName(e.target.value)}
              style={{ border: '1px solid var(--border)', borderRadius: 4, padding: '5px 8px', fontSize: 13, color: 'var(--text)', background: 'var(--surface)', fontFamily: 'inherit', width: 260 }}
            >
              <option value="">Auto — next release per space</option>
              {releaseNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        )}
        <Legend />
      </div>

      {items.length === 0 ? (
        <div style={{ padding: '20px 0', color: 'var(--text-subtlest)', fontSize: 12 }}>No release data to show.</div>
      ) : (
        <BarColumns items={items} />
      )}

      {erroredSpaces.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-subtlest)' }}>
          {erroredSpaces.map(r => <div key={r.projectKey ?? r.releaseId}>{r.name ?? r.projectKey}: {r.error}</div>)}
        </div>
      )}
    </div>
  );
}
