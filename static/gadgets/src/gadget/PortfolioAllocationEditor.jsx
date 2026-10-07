import React from 'react';
import { editStyles as S } from './sprintConfigShared';
import { fmtPct, STATUS_WORD } from './portfolioModel';

const STATUS_DOT = { ok: 'var(--ok)', warn: 'var(--filling)', critical: 'var(--over)', none: 'var(--text-subtlest)' };

function StatusDot({ status }) {
  return (
    <span
      title={STATUS_WORD[status]}
      aria-label={STATUS_WORD[status]}
      style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: STATUS_DOT[status], flex: 'none' }}
    />
  );
}

// Initial text-input values for a model's rows (blank = 0%).
export function initialAllocationValues(rows) {
  return Object.fromEntries(rows.map(r => [r.id, r.target ? String(r.target) : '']));
}

// Parses the text inputs the same way the server validates them (0-100 each,
// total at most 100) so the editor can give feedback before a save is attempted.
export function parseAllocationValues(rows, values) {
  const parsed = rows.map(r => {
    const raw = values[r.id];
    const n = raw === '' || raw == null ? 0 : Number(raw);
    return { id: r.id, n, valid: Number.isFinite(n) && n >= 0 && n <= 100 };
  });
  const allValid = parsed.every(p => p.valid);
  const total = Math.round(parsed.reduce((a, p) => a + (p.valid ? p.n : 0), 0) * 10) / 10;
  return { parsed, allValid, total, over: total > 100 + 1e-6 };
}

// { alloc, names } ready to send: only non-zero targets, with a name snapshot
// of every row so a later "new option" can be told apart from "left at 0%".
export function allocationPayload(rows, parsed) {
  const alloc = {};
  const names = {};
  for (const r of rows) names[r.id] = r.name;
  for (const p of parsed) if (p.n > 0) alloc[p.id] = p.n;
  return { alloc, names };
}

// The category table + running total shared by the per-release popup and the
// space-default editor on the settings page. Controlled: the parent owns `values`.
// `showActual` adds the live actual-share column and the Unassigned row (only
// meaningful for a release, not for the space default).
export default function AllocationEditor({ model, values, onChange, parsedState, showActual = true }) {
  const { rows, unassigned } = model;
  const { parsed, allValid, total, over } = parsedState;
  const cols = showActual ? 3 : 2;

  return (
    <>
      <table style={{ ...S.table, marginTop: 14 }}>
        <thead>
          <tr>
            <th style={S.th}>Category</th>
            <th style={S.th}>Target %</th>
            {showActual && <th style={S.th}>Actual</th>}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td style={S.td} colSpan={cols}>No categories found for this space's portfolio field.</td></tr>
          ) : rows.map((r, i) => (
            <tr key={r.id} style={S.row}>
              <td style={S.td}>
                <span style={{ fontWeight: 600, textDecoration: r.removed ? 'line-through' : 'none' }}>{r.name}</span>
                {r.disabled && <span style={{ ...S.chip, marginLeft: 6, background: 'var(--surface-sunken)', color: 'var(--text-subtle)' }}>Disabled</span>}
                {r.isNew && <span style={{ ...S.chip, marginLeft: 6, background: 'var(--info-bg)', color: 'var(--info-text)' }}>New</span>}
                {r.removed && <span style={{ ...S.chip, marginLeft: 6, background: 'var(--surface-sunken)', color: 'var(--text-subtle)' }}>Removed</span>}
              </td>
              <td style={S.td}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="number" min="0" max="100" step="0.1"
                    value={values[r.id] ?? ''}
                    aria-label={`Target percent for ${r.name}`}
                    onChange={e => onChange(r.id, e.target.value)}
                    style={{ ...S.numInput, borderColor: parsed[i].valid ? 'var(--border)' : 'var(--over)' }}
                  />
                  {r.removed && (values[r.id] ?? '') !== '' && (
                    <button style={S.smallBtn} onClick={() => onChange(r.id, '')}>Clear</button>
                  )}
                </div>
              </td>
              {showActual && (
                <td style={S.td}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                    <StatusDot status={r.status} />
                    <span>{r.actualPct == null ? '—' : `${fmtPct(r.actualPct)} · ${r.actualSp} SP`}</span>
                  </div>
                </td>
              )}
            </tr>
          ))}
          {showActual && (
            <tr style={S.row}>
              <td style={S.td}>
                <span style={{ fontWeight: 600 }}>Unassigned</span>
                <div style={{ fontSize: 11, color: 'var(--text-subtlest)' }}>No category set on the ticket — target is always 0%</div>
              </td>
              <td style={S.td}><span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>0%</span></td>
              <td style={S.td}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                  <StatusDot status={unassigned.status} />
                  <span>{unassigned.actualPct == null ? '—' : `${fmtPct(unassigned.actualPct)} · ${unassigned.actualSp} SP`}</span>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, fontSize: 13, fontWeight: 700 }}>
        <span style={{ color: over ? 'var(--over-text)' : 'var(--text)' }}>Total allocated: {total}%</span>
        <span style={{ color: 'var(--text-subtle)', fontWeight: 600 }}>
          {over ? 'Over by ' + Math.round((total - 100) * 10) / 10 + '%' : `Unallocated: ${Math.round((100 - total) * 10) / 10}%`}
        </span>
      </div>
      {!allValid && <div style={{ ...S.error, marginTop: 8 }}>Each target must be a number between 0 and 100.</div>}
      {over && <div style={{ ...S.error, marginTop: 8 }}>Targets can't add up to more than 100%.</div>}
    </>
  );
}
