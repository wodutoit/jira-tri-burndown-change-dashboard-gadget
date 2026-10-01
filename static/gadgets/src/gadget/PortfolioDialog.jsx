import React, { useState } from 'react';
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

// Per-release allocation editor. The parent remounts it (via `key`) whenever the
// stored allocation changes underneath it, so the inputs always start from — and
// `loadedUpdatedAt` always matches — the version actually on screen.
export default function PortfolioDialog({ releaseName, model, loadedUpdatedAt, saving, error, optionsError, onSave, onCancel }) {
  const { rows, unassigned, hasActuals, totalSp, unestimatedCount, sprintCount, newCount, removedCount } = model;
  const [values, setValues] = useState(() => Object.fromEntries(rows.map(r => [r.id, r.target ? String(r.target) : ''])));

  const parsed = rows.map(r => {
    const raw = values[r.id];
    const n = raw === '' || raw == null ? 0 : Number(raw);
    return { id: r.id, n, valid: Number.isFinite(n) && n >= 0 && n <= 100 };
  });
  const allValid = parsed.every(p => p.valid);
  const total = Math.round(parsed.reduce((a, p) => a + (p.valid ? p.n : 0), 0) * 10) / 10;
  const over = total > 100 + 1e-6;
  const canSave = allValid && !over && !saving;

  const handleSave = () => {
    const alloc = {};
    const names = {};
    for (const r of rows) names[r.id] = r.name;
    for (const p of parsed) if (p.n > 0) alloc[p.id] = p.n;
    onSave({ alloc, names, expectedUpdatedAt: loadedUpdatedAt });
  };

  return (
    <div onClick={onCancel} style={S.dialogOverlay}>
      <div onClick={e => e.stopPropagation()} style={{ ...S.dialogBox, width: 600, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={S.dialogTitle}>Portfolio allocation — {releaseName}</div>
        <div style={{ ...S.hint, marginTop: 4 }}>
          Set the share of this release's work you want in each category. Targets can add up to 100% or less.
        </div>

        {newCount > 0 && (
          <div style={{ ...S.notice, marginTop: 12 }}>
            {newCount} option{newCount === 1 ? ' was' : 's were'} added in Jira since this release was last saved. {newCount === 1 ? 'It is' : 'They are'} at 0% until you allocate {newCount === 1 ? 'it' : 'them'}, so any work tagged with {newCount === 1 ? 'it' : 'them'} shows as out of range.
          </div>
        )}
        {removedCount > 0 && (
          <div style={{ ...S.notice, marginTop: 12 }}>
            {removedCount} categor{removedCount === 1 ? 'y is' : 'ies are'} no longer an option in Jira but still {removedCount === 1 ? 'has' : 'have'} an allocation or tickets. Clear the allocation once it's no longer needed.
          </div>
        )}
        {optionsError && (
          <div style={{ ...S.notice, marginTop: 12 }}>
            Couldn't list the field's current options ({optionsError}). Showing categories already saved or found on tickets.
          </div>
        )}

        <table style={{ ...S.table, marginTop: 14 }}>
          <thead>
            <tr>
              <th style={S.th}>Category</th>
              <th style={S.th}>Target %</th>
              <th style={S.th}>Actual</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td style={S.td} colSpan={3}>No categories found for this space's portfolio field.</td></tr>
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
                      value={values[r.id]}
                      aria-label={`Target percent for ${r.name}`}
                      onChange={e => setValues(v => ({ ...v, [r.id]: e.target.value }))}
                      style={{ ...S.numInput, borderColor: parsed[i].valid ? 'var(--border)' : 'var(--over)' }}
                    />
                    {r.removed && values[r.id] !== '' && (
                      <button style={S.smallBtn} onClick={() => setValues(v => ({ ...v, [r.id]: '' }))}>Clear</button>
                    )}
                  </div>
                </td>
                <td style={S.td}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                    <StatusDot status={r.status} />
                    <span>{r.actualPct == null ? '—' : `${fmtPct(r.actualPct)} · ${r.actualSp} SP`}</span>
                  </div>
                </td>
              </tr>
            ))}
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

        <div style={{ ...S.hint, marginTop: 12 }}>
          {hasActuals
            ? <>Actual = current story points of every ticket in the {sprintCount} sprint{sprintCount === 1 ? '' : 's'} mapped to this release ({totalSp} SP in total).</>
            : <>Actual shares appear once tickets are in this release's sprints.</>}
          {' '}Tickets with no estimate count as 1 SP{unestimatedCount > 0 ? ` (${unestimatedCount} right now)` : ''}; sub-tasks without their own estimate count 0; an Epic with child issues is skipped because its children are counted.
        </div>

        {error && <div style={{ ...S.error, marginTop: 12 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 20 }}>
          <button onClick={onCancel} disabled={saving} style={{ ...S.btn, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-subtle)' }}>Cancel</button>
          <button onClick={handleSave} disabled={!canSave} style={{ ...S.btn, opacity: canSave ? 1 : 0.5 }}>
            {saving ? 'Saving…' : 'Save allocation'}
          </button>
        </div>
      </div>
    </div>
  );
}
