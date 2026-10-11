import React, { useState, useEffect } from 'react';
import { invoke, view, events } from '@forge/bridge';
import { localTodayISO } from './gadgetUtils';
import { DASHBOARD_RELEASE_FILTER_EVENT } from './useDashboardReleaseFilter';

export default function TriReleaseFilterGadgetView() {
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [config, setConfig]         = useState(null);
  const [releaseNames, setReleaseNames] = useState([]);
  const [choice, setChoice]         = useState(''); // '' = Auto, else a release name
  const [saving, setSaving]         = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const hasConfig = (cfg) => Array.isArray(cfg?.spaces) && cfg.spaces.some(s => s.projectKey);

  async function loadReleaseNames(cfg) {
    const res = await invoke('getReleaseCapacityRollup', {
      spaces: cfg.spaces.filter(s => s.projectKey),
      releaseName: null,
      todayISO: localTodayISO(),
      previousReleaseCount: cfg.previousReleaseCount ?? 3,
    });
    if (res.error) throw new Error(res.error);
    const names = new Set();
    (res.results ?? []).forEach(r => (r.releaseNames ?? []).forEach(n => names.add(n)));
    setReleaseNames([...names].sort());
  }

  // Persists the selection (durable fallback for gadgets that load later or
  // after a refresh) and broadcasts it so open TRI-* gadgets update live.
  async function publish(name) {
    setSaving(true);
    try {
      const res = await invoke('setDashboardReleaseFilter', { releaseName: name || null });
      if (res.error) throw new Error(res.error);
      await events.emit(DASHBOARD_RELEASE_FILTER_EVENT, res.filter);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    view.theme.enable().catch(() => {});
    view.getContext().catch(() => ({}))
      .then(async ctx => {
        const cfg = ctx?.extension?.gadgetConfiguration ?? {};
        setConfig(cfg);
        if (!hasConfig(cfg)) return;

        const filterRes = await invoke('getDashboardReleaseFilter');
        await loadReleaseNames(cfg).catch(e => setError(String(e)));

        const existing = filterRes?.filter;
        if (existing) {
          setChoice(existing.releaseName ?? '');
        } else {
          // Nothing set yet on this dashboard — seed with the configured
          // default so opted-in gadgets have something to follow right away.
          setChoice(cfg.releaseName ?? '');
          await publish(cfg.releaseName ?? null);
        }
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = async (name) => {
    setChoice(name);
    await publish(name);
  };

  const handleRefresh = async () => {
    if (!config) return;
    setRefreshing(true);
    setError(null);
    try {
      await loadReleaseNames(config);
    } catch (e) {
      setError(String(e));
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) return <div style={{ padding: 20, fontSize: 13, fontFamily: 'inherit' }}>Loading…</div>;

  if (!hasConfig(config)) {
    return <div style={{ padding: 16, color: 'var(--text-subtlest)', fontSize: 13, fontFamily: 'inherit' }}>
      Edit this gadget to choose at least one space.
    </div>;
  }

  // Keep a stored selection visible even if it has dropped out of the list
  // (e.g. renamed, or aged out of "previous releases to list").
  const options = choice && !releaseNames.includes(choice) ? [choice, ...releaseNames] : releaseNames;
  const selectStyle = {
    flex: 1, minWidth: 0, border: '1px solid var(--border)', borderRadius: 3, padding: '3px 6px',
    fontSize: 12, color: 'var(--text)', background: 'var(--surface)', fontFamily: 'inherit',
  };
  const iconBtnStyle = {
    fontSize: 12, lineHeight: 1, color: 'var(--text-subtlest)', background: 'none',
    border: '1px solid var(--border)', borderRadius: 3, padding: '3px 6px', cursor: 'pointer', fontFamily: 'inherit',
  };

  return (
    <div style={{ padding: '6px 10px', fontFamily: 'inherit', color: 'var(--text)', fontSize: 13 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap' }}>Release</span>

        <select value={choice} onChange={e => handleChange(e.target.value)} disabled={saving} style={selectStyle}>
          <option value="">Auto — next release per space</option>
          {options.map(n => <option key={n} value={n}>{n}</option>)}
        </select>

        <span
          title='Every TRI Release Capacity ("By space") and TRI Portfolio Distribution ("By release") gadget on this dashboard with "Use dashboard release filter" enabled in its own edit screen follows this selection.'
          style={{ fontSize: 12, color: 'var(--text-subtlest)', cursor: 'help' }}
        >
          ⓘ
        </span>

        <button onClick={handleRefresh} disabled={refreshing} title="Refresh release list" style={iconBtnStyle}>
          {refreshing ? '…' : '⟳'}
        </button>
      </div>

      {error && <div style={{ fontSize: 11, color: 'var(--over-text)', marginTop: 4 }}>{error}</div>}
    </div>
  );
}
