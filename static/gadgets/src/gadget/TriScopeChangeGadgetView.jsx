import React, { useState, useEffect } from 'react';
import { invoke, view } from '@forge/bridge';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

const AMBER = '#EAAB30';
const AMBER_HDR = '#FFC000';
const NEGATIVE = '#B4B2A9';

function fmtEventDate(ts) {
  if (!ts) return '';
  return new Date(ts).toLocaleString('en-AU', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const v = payload[0].value;
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4, padding: '6px 10px', fontSize: 12 }}>
      <div style={{ fontWeight: 700, color: 'var(--text)' }}>{label}</div>
      <div style={{ color: v >= 0 ? AMBER : NEGATIVE }}>{v >= 0 ? '+' : ''}{v} SP</div>
    </div>
  );
}

function ScopeChart({ data }) {
  const chartData = data.labels.map((label, i) => ({ label, delta: data.scopeDelta[i] }));
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-subtlest)' }} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 10, fill: 'var(--text-subtlest)' }} allowDecimals={false} />
        <Tooltip content={<CustomTooltip />} />
        <Bar dataKey="delta">
          {chartData.map((d, i) => (
            <Cell key={i} fill={d.delta >= 0 ? AMBER : NEGATIVE} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function EventsTable({ events }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ fontSize: 11, color: 'var(--text-subtlest)', fontStyle: 'italic', marginBottom: 8, lineHeight: 1.4 }}>
        Events may have occurred outside the bounds of the current sprint and won't be reflected in the chart above — check the date column.
      </div>
      <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 4 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              {['Issue ID', 'Date', 'SP'].map(h => (
                <th key={h} style={{
                  background: AMBER_HDR, color: '#1F2422', fontWeight: 700, textAlign: h === 'Issue ID' ? 'left' : 'center',
                  padding: '6px 10px', position: 'sticky', top: 0,
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {events.length === 0 && (
              <tr><td colSpan={3} style={{ padding: 10, textAlign: 'center', color: 'var(--text-subtlest)', fontStyle: 'italic' }}>No scope change events.</td></tr>
            )}
            {events.map((ev, i) => (
              <tr key={i} style={{ background: i % 2 === 1 ? 'var(--surface-sunken)' : 'transparent' }}>
                <td style={{ padding: '5px 10px', borderTop: '1px solid var(--border)' }}>{ev.key}</td>
                <td style={{ padding: '5px 10px', borderTop: '1px solid var(--border)', textAlign: 'center' }}>{fmtEventDate(ev.ts)}</td>
                <td style={{ padding: '5px 10px', borderTop: '1px solid var(--border)', textAlign: 'center', color: ev.sp >= 0 ? AMBER : 'var(--text)', fontWeight: 600 }}>
                  {ev.sp >= 0 ? '+' : ''}{ev.sp}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function TriScopeChangeGadgetView() {
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [data, setData]           = useState(null);
  const [config, setConfig]       = useState(null);
  const [fromCache, setFromCache] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function fetchData(cfg, forceRefresh = false) {
    if (forceRefresh) setRefreshing(true);
    const result = await invoke('getScopeChangeData', {
      projectKey:    cfg.projectKey,
      sprintMode:    cfg.sprintMode ?? 'active',
      sprintId:      cfg.sprintId ?? null,
      spFieldId:     cfg.spFieldId,
      statusMapping: cfg.statusMapping,
      forceRefresh,
    });
    if (result.error) throw new Error(result.error);
    setData(result.data);
    setFromCache(result.fromCache ?? false);
  }

  const hasConfig = (cfg) =>
    cfg && cfg.projectKey && cfg.spFieldId && cfg.statusMapping &&
    (cfg.sprintMode === 'active' || cfg.sprintId);

  useEffect(() => {
    view.theme.enable().catch(() => {});
    view.getContext().catch(() => ({}))
      .then(ctx => {
        const cfg = ctx?.extension?.gadgetConfiguration ?? {};
        setConfig(cfg);
        if (!hasConfig(cfg)) return null;
        return fetchData(cfg);
      })
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const handleRefresh = async () => {
    if (!config) return;
    setError(null);
    try {
      await fetchData(config, true);
    } catch (e) {
      setError(String(e));
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) return <div style={{ padding: 20, fontSize: 13, fontFamily: 'inherit' }}>Loading…</div>;

  if (!hasConfig(config)) {
    return <div style={{ padding: 16, color: 'var(--text-subtlest)', fontSize: 13, fontFamily: 'inherit' }}>
      Edit this gadget to configure a space and sprint.
    </div>;
  }

  if (error) {
    return <div style={{ padding: 16, color: 'var(--over-text)', fontSize: 13, fontFamily: 'inherit' }}>
      Error: {error}
      <button onClick={handleRefresh} style={{ marginLeft: 12, fontSize: 12, cursor: 'pointer' }}>Retry</button>
    </div>;
  }

  if (!data) return <div style={{ padding: 16, fontSize: 13, fontFamily: 'inherit' }}>No data.</div>;

  const displayMode = config.displayMode ?? 'chart';

  return (
    <div style={{ padding: '12px 14px 14px', fontFamily: 'inherit', color: 'var(--text)', fontSize: 13 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{data.sprintName}</div>
          <div style={{ fontSize: 11, color: 'var(--text-subtlest)' }}>
            {data.startDate} – {data.endDate}
            {fromCache && !refreshing && <span style={{ marginLeft: 8, opacity: 0.6 }}>· cached</span>}
          </div>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          title="Refresh data"
          style={{ fontSize: 11, color: 'var(--text-subtlest)', background: 'none', border: '1px solid var(--border)', borderRadius: 3, padding: '3px 8px', cursor: 'pointer', fontFamily: 'inherit' }}
        >
          {refreshing ? '⟳ Refreshing…' : '⟳ Refresh'}
        </button>
      </div>

      {displayMode === 'table'
        ? <EventsTable events={data.events} />
        : <ScopeChart data={data} />
      }
    </div>
  );
}
