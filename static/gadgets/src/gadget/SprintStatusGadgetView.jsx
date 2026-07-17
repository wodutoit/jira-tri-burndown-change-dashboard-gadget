import React, { useState, useEffect } from 'react';
import { invoke, view } from '@forge/bridge';
import { statusStyle } from './gadgetUtils';

export default function SprintStatusGadgetView() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [projectKey, setProjectKey] = useState('');

  useEffect(() => {
    view.theme.enable().catch(() => {});
    view.getContext().catch(() => ({}))
      .then(ctx => {
        const key = ctx?.extension?.gadgetConfiguration?.projectKey ?? '';
        setProjectKey(key);
        if (!key) return null;
        return invoke('getActiveSprintStatusCounts', { projectKey: key });
      })
      .then(result => setData(result))
      .catch(err => setError(String(err)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="center-msg" data-app-shell="true" style={{ padding: 20, fontSize: 13 }}>Loading…</div>;
  }
  if (error) {
    return <div style={{ padding: 16, color: 'var(--over-text)', fontSize: 13 }}>Failed to load: {error}</div>;
  }
  if (!projectKey) {
    return <div style={{ padding: 16, color: 'var(--text-subtlest)', fontSize: 13 }}>Edit this gadget and pick a Jira space to get started.</div>;
  }
  if (data?.error) {
    return <div style={{ padding: 16, color: 'var(--over-text)', fontSize: 13 }}>{data.error}</div>;
  }
  if (!data?.sprintName) {
    return <div style={{ padding: 16, color: 'var(--text-subtlest)', fontSize: 13 }}>No active sprint on "{data?.boardName ?? projectKey}" right now.</div>;
  }

  return (
    <div style={{ padding: '14px 16px 16px', fontFamily: 'inherit', color: 'var(--text)', fontSize: 13 }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 700 }}>{data.sprintName}</div>
        <div style={{ fontSize: 11, color: 'var(--text-subtlest)' }}>{data.boardName}</div>
      </div>

      {data.statuses.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--text-subtlest)' }}>No stories in this sprint yet.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {data.statuses.map(s => {
            const c = statusStyle(s.category);
            const pct = data.totalCount ? Math.round(s.count / data.totalCount * 100) : 0;
            return (
              <div key={s.status} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{
                  minWidth: 90, fontSize: 11, fontWeight: 700, padding: '3px 8px', borderRadius: 3,
                  background: c.bg, color: c.text, textAlign: 'center',
                }}>
                  {s.status}
                </span>
                <div style={{ flex: 1, height: 8, borderRadius: 4, background: 'var(--surface-sunken)', overflow: 'hidden' }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: c.text, borderRadius: 4 }} />
                </div>
                <span style={{ fontSize: 12, color: 'var(--text-subtle)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                  {s.count} stories · {s.points} pts
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--text-subtle)' }}>
        <span>Total</span>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{data.totalCount} stories · {data.totalPoints} pts</span>
      </div>
    </div>
  );
}
