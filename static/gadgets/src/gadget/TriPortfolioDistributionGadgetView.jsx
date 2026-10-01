import React, { useState, useEffect } from 'react';
import { invoke, view } from '@forge/bridge';
import { localTodayISO } from './gadgetUtils';
import PortfolioChart, { buildColorMap } from './PortfolioChart';

const RELEASE_COUNT_OPTIONS = [1, 2, 3, 4, 5, 6];
const LABEL = { fontSize: 10, fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase', color: 'var(--text-subtlest)' };
const SELECT = { border: '1px solid var(--border)', borderRadius: 4, padding: '5px 8px', fontSize: 13, color: 'var(--text)', background: 'var(--surface)', fontFamily: 'inherit' };

function fmtDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' }); }
  catch { return String(iso).slice(0, 10); }
}

export default function TriPortfolioDistributionGadgetView() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [config, setConfig] = useState(null);
  const [releaseName, setReleaseName] = useState('');
  const [releaseCount, setReleaseCount] = useState(4);
  const [chartStyle, setChartStyle] = useState('donut');
  const [data, setData] = useState(null);
  const [fetching, setFetching] = useState(false);

  const mode = config?.mode === 'bySpace' ? 'bySpace' : 'byRelease';
  const hasConfig = !!config && (mode === 'bySpace' ? !!config.projectKey : Array.isArray(config.spaces) && config.spaces.length > 0);

  useEffect(() => {
    view.theme.enable().catch(() => {});
    view.getContext().catch(() => ({}))
      .then(ctx => {
        const cfg = ctx?.extension?.gadgetConfiguration ?? {};
        setConfig(cfg);
        setReleaseName(cfg.releaseName ?? '');
        setReleaseCount(Math.min(6, Math.max(1, cfg.releaseCount ?? 4)));
        setChartStyle(cfg.chartStyle === 'bullet' ? 'bullet' : 'donut');
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!hasConfig) return;
    // Ignore a slow earlier response that lands after a newer selection's.
    let ignore = false;
    setFetching(true);
    setError(null);
    const todayISO = localTodayISO();
    const previousReleaseCount = config.previousReleaseCount ?? 3;
    const call = mode === 'bySpace'
      ? invoke('getPortfolioRoadmapDistribution', { projectKey: config.projectKey, releaseName: releaseName || null, releaseCount, todayISO, previousReleaseCount })
      : invoke('getPortfolioReleaseDistribution', { spaces: config.spaces, releaseName: releaseName || null, todayISO, previousReleaseCount });
    call.then(res => { if (!ignore) { if (res.error) setError(res.error); setData(res); } })
      .catch(e => { if (!ignore) setError(String(e)); })
      .finally(() => { if (!ignore) setFetching(false); });
    return () => { ignore = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasConfig, mode, releaseName, releaseCount]);

  if (loading) return <div style={{ padding: 24, fontSize: 13 }}>Loading…</div>;
  if (!hasConfig) return <div style={{ padding: 16, color: 'var(--text-subtlest)', fontSize: 13 }}>Edit this gadget to choose at least one space.</div>;
  if (error && !data?.results?.length) return <div style={{ padding: 16, color: 'var(--over-text)', fontSize: 13 }}>Failed to load: {error}</div>;
  if (fetching && !data) return <div style={{ padding: 24, fontSize: 13 }}>Loading…</div>;

  const results = data?.results ?? [];
  const okResults = results.filter(r => !r.error);
  const erroredSpaces = results.filter(r => r.error);
  const releaseNames = mode === 'bySpace'
    ? (data?.releaseNames ?? [])
    : [...new Set(results.flatMap(r => r.releaseNames ?? []))].sort();

  const show = config.show === 'spaces' || config.show === 'total' ? config.show : 'both';
  const total = mode === 'byRelease' && data?.total && okResults.length > 1 && show !== 'spaces' ? data.total : null;
  const showSpaces = mode === 'bySpace' || show !== 'total' || okResults.length <= 1;
  const colorFor = buildColorMap([...okResults, ...(total ? [total] : [])]);

  const totalNotes = [];
  if (total?.spacesWithoutAllocation?.length) totalNotes.push(`Target excludes ${total.spacesWithoutAllocation.join(', ')} (no allocation set).`);
  if (total?.hasAllocation) totalNotes.push('Target is weighted by each space’s capacity for the release.');
  const totalReleaseNames = [...new Set(okResults.map(r => r.releaseName))];

  return (
    <div style={{ padding: '14px 16px 16px', fontFamily: 'inherit', color: 'var(--text)', fontSize: 13 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 20, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          {mode === 'bySpace' ? (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={LABEL}>Space</span>
                <span style={{ fontSize: 13, fontWeight: 700, padding: '5px 0' }}>{data?.name || '—'}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={LABEL}>Releases to show</span>
                <select value={releaseCount} onChange={e => setReleaseCount(parseInt(e.target.value, 10))} style={{ ...SELECT, width: 120 }}>
                  {RELEASE_COUNT_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={LABEL}>Release</span>
              <select value={releaseName} onChange={e => setReleaseName(e.target.value)} style={{ ...SELECT, width: 260 }}>
                <option value="">Auto — next release per space</option>
                {releaseNames.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={LABEL}>Chart</span>
            <select value={chartStyle} onChange={e => setChartStyle(e.target.value)} style={{ ...SELECT, width: 150 }}>
              <option value="donut">Donut + target ring</option>
              <option value="bullet">Bullet bars</option>
            </select>
          </div>
        </div>
        {fetching && <span style={{ fontSize: 11, color: 'var(--text-subtlest)' }}>Updating…</span>}
      </div>

      {okResults.length === 0 && erroredSpaces.length === 0 ? (
        <div style={{ padding: '20px 0', color: 'var(--text-subtlest)', fontSize: 12 }}>No release data to show.</div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>
          {showSpaces && okResults.map(r => (
            <PortfolioChart
              key={mode === 'bySpace' ? r.releaseId : r.projectKey}
              title={mode === 'bySpace' ? r.releaseName : r.name}
              subtitle={mode === 'bySpace' ? fmtDate(r.releaseDate) : r.releaseName}
              badge={mode === 'bySpace' && r.released ? { label: 'RELEASED', bg: 'var(--lz-n-bg)', text: 'var(--lz-n-text)' } : null}
              data={r} chartStyle={chartStyle} colorFor={colorFor}
            />
          ))}
          {total && (
            <PortfolioChart
              key="__total" title="Total"
              subtitle={totalReleaseNames.length === 1 ? `${totalReleaseNames[0]} · ${okResults.length} spaces` : `${okResults.length} spaces`}
              data={total} chartStyle={chartStyle} colorFor={colorFor} notes={totalNotes}
            />
          )}
        </div>
      )}

      {erroredSpaces.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-subtlest)' }}>
          {erroredSpaces.map(r => <div key={r.projectKey}>{r.name ?? r.projectKey}: {r.error}</div>)}
        </div>
      )}
    </div>
  );
}
