import React, { useState, useEffect } from 'react';
import { invoke, view } from '@forge/bridge';

const HDR_FILL   = '#1F4E79';
const ZEBRA_FILL = 'var(--surface-sunken)';
const WARN_FILL  = '#FFF2CC33'; // pale yellow, actual > estimate
const OVER_FILL  = '#FFCCCC33'; // pale red, actual > 1.3x estimate

const COLUMNS = [
  { key: 'spEstimate',      label: 'SP Estimate' },
  { key: 'totalCycleTimeSp', label: 'Total Cycle Time SP' },
  { key: 'inProgress',      label: 'In Progress' },
  { key: 'blocked',         label: 'Blocked' },
  { key: 'codeReview',      label: 'Code Review' },
  { key: 'test',            label: 'Test' },
];

function fmtBucket(b) {
  if (!b || !b.hours) return '';
  return `${b.hours.toFixed(1)} (${b.sp})`;
}

function CycleTimeTable({ rows }) {
  return (
    <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 4 }}>
      <div style={{ maxHeight: 320, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 560 }}>
          <thead>
            <tr>
              <th style={{ background: HDR_FILL, color: '#fff', fontWeight: 700, textAlign: 'left', padding: '6px 10px', position: 'sticky', top: 0 }}>Issue ID</th>
              {COLUMNS.map(c => (
                <th key={c.key} style={{ background: HDR_FILL, color: '#fff', fontWeight: 700, textAlign: 'center', padding: '6px 10px', position: 'sticky', top: 0, whiteSpace: 'nowrap' }}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={COLUMNS.length + 1} style={{ padding: 10, textAlign: 'center', color: 'var(--text-subtlest)', fontStyle: 'italic' }}>No data.</td></tr>
            )}
            {rows.map((row, i) => {
              const zebra = i % 2 === 1;
              const spEst = row.spEstimate;
              const actSp = row.totalCycleTimeSp;
              let totalFill = zebra ? ZEBRA_FILL : 'transparent';
              if (actSp && spEst) {
                if (actSp > spEst * 1.3) totalFill = OVER_FILL;
                else if (actSp > spEst) totalFill = WARN_FILL;
              }
              const rowFill = zebra ? ZEBRA_FILL : 'transparent';
              return (
                <tr key={row.key}>
                  <td style={{ padding: '5px 10px', borderTop: '1px solid var(--border)', background: rowFill }}>{row.key}</td>
                  <td style={{ padding: '5px 10px', borderTop: '1px solid var(--border)', textAlign: 'center', background: rowFill }}>{spEst ?? ''}</td>
                  <td style={{ padding: '5px 10px', borderTop: '1px solid var(--border)', textAlign: 'center', background: totalFill, fontWeight: 600 }}>{actSp ?? ''}</td>
                  <td style={{ padding: '5px 10px', borderTop: '1px solid var(--border)', textAlign: 'center', background: rowFill, whiteSpace: 'nowrap' }}>{fmtBucket(row.inProgress)}</td>
                  <td style={{ padding: '5px 10px', borderTop: '1px solid var(--border)', textAlign: 'center', background: rowFill, whiteSpace: 'nowrap' }}>{fmtBucket(row.blocked)}</td>
                  <td style={{ padding: '5px 10px', borderTop: '1px solid var(--border)', textAlign: 'center', background: rowFill, whiteSpace: 'nowrap' }}>{fmtBucket(row.codeReview)}</td>
                  <td style={{ padding: '5px 10px', borderTop: '1px solid var(--border)', textAlign: 'center', background: rowFill, whiteSpace: 'nowrap' }}>{fmtBucket(row.test)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function TriCycleTimeGadgetView() {
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState(null);
  const [data, setData]           = useState(null);
  const [config, setConfig]       = useState(null);
  const [fromCache, setFromCache] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function fetchData(cfg, forceRefresh = false) {
    if (forceRefresh) setRefreshing(true);
    const result = await invoke('getCycleTimeData', {
      projectKey:     cfg.projectKey,
      sprintMode:     cfg.sprintMode ?? 'active',
      sprintId:       cfg.sprintId ?? null,
      spFieldId:      cfg.spFieldId,
      statusMapping:  cfg.statusMapping,
      hoursPerSp:     cfg.hoursPerSp,
      workStartHour:  cfg.workStartHour,
      workEndHour:    cfg.workEndHour,
      utcOffsetHours: cfg.utcOffsetHours,
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

  return (
    <div style={{ padding: '12px 14px 14px', fontFamily: 'inherit', color: 'var(--text)', fontSize: 13 }}>
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

      <CycleTimeTable rows={data.rows} />
    </div>
  );
}
