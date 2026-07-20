import React, { useState, useEffect } from 'react';
import { invoke, view } from '@forge/bridge';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { localTodayISO } from './gadgetUtils';

const COLORS = {
  ideal:     '#6B7280',
  devRem:    '#006CA7',
  reviewRem: '#ED7D31',
  remaining: '#6FB544',
};

const SERIES = [
  { key: 'ideal',     label: 'Ideal',             color: COLORS.ideal,     dash: '6 3' },
  { key: 'devRem',    label: 'Dev Remaining',      color: COLORS.devRem,    dash: null  },
  { key: 'reviewRem', label: 'Review Remaining',   color: COLORS.reviewRem, dash: null  },
  { key: 'remaining', label: 'Remaining (Done)',   color: COLORS.remaining, dash: null  },
];

function buildChartData(data) {
  return data.labels.map((label, i) => ({
    label,
    ideal:     data.ideal[i],
    devRem:    data.devRem[i],
    reviewRem: data.reviewRem[i],
    remaining: data.remaining[i],
  }));
}

function StatChip({ label, value, color }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <span style={{ fontSize: 10, color: 'var(--text-subtlest)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      <span style={{ fontSize: 18, fontWeight: 700, color: color ?? 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 4, padding: '8px 12px', fontSize: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 4, color: 'var(--text)' }}>{label}</div>
      {payload.map(p => (
        p.value !== null && p.value !== undefined && (
          <div key={p.dataKey} style={{ color: p.color, display: 'flex', justifyContent: 'space-between', gap: 16 }}>
            <span>{p.name}</span>
            <span style={{ fontWeight: 600 }}>{p.value} SP</span>
          </div>
        )
      ))}
    </div>
  );
}

export default function TriBurndownGadgetView() {
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [data, setData]         = useState(null);
  const [config, setConfig]     = useState(null);
  const [fromCache, setFromCache] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function fetchData(cfg, forceRefresh = false) {
    if (forceRefresh) setRefreshing(true);
    const result = await invoke('getBurndownData', {
      projectKey:       cfg.projectKey,
      sprintMode:       cfg.sprintMode ?? 'active',
      sprintId:         cfg.sprintId ?? null,
      spFieldId:        cfg.spFieldId,
      statusMapping:    cfg.statusMapping,
      graceWindowHours: cfg.graceWindowHours,
      todayISO:         localTodayISO(),
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

  const chartData = buildChartData(data);
  const lastDev  = data.devRem.filter(v => v !== null).at(-1) ?? 0;
  const lastRev  = data.reviewRem.filter(v => v !== null).at(-1) ?? 0;
  const lastRem  = data.remaining.filter(v => v !== null).at(-1) ?? 0;
  const isActive = data.sprintState === 'active';

  return (
    <div style={{ padding: '12px 14px 14px', fontFamily: 'inherit', color: 'var(--text)', fontSize: 13 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700 }}>{data.spaceName ? `${data.spaceName}: ${data.sprintName}` : data.sprintName}</div>
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

      {/* Stat chips */}
      <div style={{ display: 'flex', gap: 20, justifyContent: 'space-around', padding: '8px 0 12px', borderBottom: '1px solid var(--border)', marginBottom: 10 }}>
        <StatChip label="Committed" value={`${data.committedScope} SP`} />
        <StatChip label="Dev Remaining" value={`${lastDev} SP`} color={COLORS.devRem} />
        <StatChip label="Review Remaining" value={`${lastRev} SP`} color={COLORS.reviewRem} />
        <StatChip label="Remaining" value={`${lastRem} SP`} color={isActive ? COLORS.remaining : '#CD442C'} />
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'var(--text-subtlest)' }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 10, fill: 'var(--text-subtlest)' }} allowDecimals={false} />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
          {SERIES.map(s => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={s.key === 'ideal' ? 1.5 : 2}
              strokeDasharray={s.dash}
              dot={s.key === 'ideal' ? false : { r: 3 }}
              activeDot={s.key === 'ideal' ? false : { r: 5 }}
              connectNulls={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
