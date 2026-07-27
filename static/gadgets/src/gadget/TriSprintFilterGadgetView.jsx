import React, { useState, useEffect } from 'react';
import { invoke, view, events } from '@forge/bridge';
import { DASHBOARD_FILTER_EVENT } from './useDashboardFilter';

export default function TriSprintFilterGadgetView() {
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);
  const [config, setConfig]         = useState(null);
  const [spaceName, setSpaceName]   = useState('');
  const [sprints, setSprints]       = useState([]);
  const [sprintChoice, setSprintChoice] = useState('active'); // 'active' or String(sprintId)
  const [saving, setSaving]         = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const hasConfig = (cfg) => !!cfg?.projectKey;

  async function loadSprints(projectKey) {
    const res = await invoke('getSprintsForProject', { projectKey });
    if (res.error) throw new Error(res.error);
    setSprints(res.sprints ?? []);
  }

  // Publishes a selection: persists it (durable fallback for gadgets that
  // load later or after a page refresh) and broadcasts it live so any TRI-*
  // gadget already open on this dashboard updates immediately.
  async function publish(cfg, choice) {
    const isFixed = choice !== 'active';
    const sprint = isFixed ? sprints.find(s => String(s.id) === choice) : null;
    const payload = {
      projectKey: cfg.projectKey,
      sprintMode: isFixed ? 'fixed' : 'active',
      sprintId: isFixed ? Number(choice) : null,
      sprintName: sprint?.name ?? '',
    };
    setSaving(true);
    try {
      const res = await invoke('setDashboardSprintFilter', payload);
      if (res.error) throw new Error(res.error);
      await events.emit(DASHBOARD_FILTER_EVENT, res.filter);
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

        const [spaceRes, sprintRes, filterRes] = await Promise.all([
          invoke('getSpaceName', { projectKey: cfg.projectKey }),
          invoke('getSprintsForProject', { projectKey: cfg.projectKey }),
          invoke('getDashboardSprintFilter'),
        ]);
        setSpaceName(spaceRes?.spaceName ?? cfg.projectKey);
        if (sprintRes.error) setError(sprintRes.error);
        setSprints(sprintRes.sprints ?? []);

        const existing = filterRes?.filter;
        if (existing && existing.projectKey === cfg.projectKey) {
          setSprintChoice(existing.sprintMode === 'fixed' ? String(existing.sprintId) : 'active');
        } else {
          // No filter set yet on this dashboard (or it belongs to a different
          // space) — seed it with this gadget's default so gadgets that opt
          // into the filter have something to follow right away.
          await publish(cfg, 'active');
        }
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleChange = async (choice) => {
    setSprintChoice(choice);
    await publish(config, choice);
  };

  const handleRefresh = async () => {
    if (!config) return;
    setRefreshing(true);
    setError(null);
    try {
      await loadSprints(config.projectKey);
    } catch (e) {
      setError(String(e));
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) return <div style={{ padding: 20, fontSize: 13, fontFamily: 'inherit' }}>Loading…</div>;

  if (!hasConfig(config)) {
    return <div style={{ padding: 16, color: 'var(--text-subtlest)', fontSize: 13, fontFamily: 'inherit' }}>
      Edit this gadget to choose a space.
    </div>;
  }

  const activeSprints = sprints.filter(s => s.state === 'active');
  const closedSprints = sprints.filter(s => s.state === 'closed');
  const selectStyle = { width: '100%', border: '1px solid var(--border)', borderRadius: 4, padding: '7px 10px', fontSize: 13, color: 'var(--text)', background: 'var(--surface)', fontFamily: 'inherit' };

  return (
    <div style={{ padding: '12px 14px 14px', fontFamily: 'inherit', color: 'var(--text)', fontSize: 13 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{spaceName}</div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          title="Refresh sprint list"
          style={{ fontSize: 11, color: 'var(--text-subtlest)', background: 'none', border: '1px solid var(--border)', borderRadius: 3, padding: '3px 8px', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          {refreshing ? '⟳ Refreshing…' : '⟳ Refresh'}
        </button>
      </div>

      {error && <div style={{ fontSize: 12, color: 'var(--over-text)', marginBottom: 8 }}>{error}</div>}

      <select value={sprintChoice} onChange={e => handleChange(e.target.value)} disabled={saving} style={selectStyle}>
        <option value="active">Active Sprint (auto)</option>
        {activeSprints.length > 0 && (
          <optgroup label="Pin to a specific sprint — Active">
            {activeSprints.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
          </optgroup>
        )}
        {closedSprints.length > 0 && (
          <optgroup label="Pin to a specific sprint — Closed">
            {closedSprints.map(s => <option key={s.id} value={String(s.id)}>{s.name}</option>)}
          </optgroup>
        )}
      </select>

      <div style={{ fontSize: 11, color: 'var(--text-subtlest)', marginTop: 8, lineHeight: 1.4 }}>
        Every TRI-* gadget on this dashboard with "Use dashboard sprint filter" enabled in its own edit
        screen follows this selection.
      </div>
    </div>
  );
}
