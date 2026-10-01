import React from 'react';
import { editStyles as S } from './sprintConfigShared';
import { fmtPct, rowTooltip, STATUS_WORD } from './portfolioModel';

const STATUS_FILL = {
  ok: 'var(--ok)', warn: 'var(--filling)', critical: 'var(--over)', none: 'var(--text-subtlest)',
};
// Colour alone can't carry the status (colour-blind users), so red segments are
// also hatched; the tooltip and aria-label always spell the status out too.
const HATCH = 'repeating-linear-gradient(45deg, rgba(255,255,255,.4) 0 3px, transparent 3px 6px)';

// The allocation bar shown under a release's Status chip: one segment per
// category sized by its allocation %, coloured by how far that category's
// actual share is from target. Unallocated space stays an empty track, and
// unassigned work is a separate red pill since it has no allocation to size it.
// (The button that opens the allocation popup lives in the Release column.)
export default function PortfolioBar({ model, loading, error }) {
  const { rows, unassigned, hasSaved, totalSp, unallocatedPct, unestimatedCount } = model;
  const segments = rows.filter(r => r.target > 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6, minWidth: 170 }}>
      {hasSaved ? (
        <div
          title={unallocatedPct > 0 ? `Unallocated: ${unallocatedPct}%` : undefined}
          style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: 'var(--surface-sunken)', border: '1px solid var(--border)' }}
        >
          {segments.map(r => (
            <div
              key={r.id}
              title={rowTooltip(r, totalSp)}
              aria-label={`${r.name}: target ${fmtPct(r.target)}, ${STATUS_WORD[r.status]}`}
              style={{
                width: `${r.target}%`, background: STATUS_FILL[r.status],
                backgroundImage: r.status === 'critical' ? HATCH : 'none',
                borderRight: '1px solid var(--surface)',
                outline: r.removed ? '1px dashed var(--text)' : 'none', outlineOffset: -2,
              }}
            />
          ))}
        </div>
      ) : (
        <span style={{ fontSize: 11, color: 'var(--text-subtlest)' }}>No portfolio allocation yet</span>
      )}

      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
        {loading && <span style={{ fontSize: 10, color: 'var(--text-subtlest)' }}>Loading…</span>}
        {!loading && error && <span title={error} style={{ fontSize: 10, color: 'var(--over-text)' }}>Actuals unavailable</span>}
        {!loading && !error && unassigned.actualSp > 0 && (
          <span
            title={`Unassigned: ${fmtPct(unassigned.actualPct)} (${unassigned.actualSp} of ${totalSp} SP) of this release's work has no portfolio category. Its target is always 0%, so it is always flagged.\nStatus: ${STATUS_WORD[unassigned.status]}`}
            style={{ ...S.chip, background: 'var(--over-bg)', color: 'var(--over-text)' }}
          >
            Unassigned {fmtPct(unassigned.actualPct)}
          </span>
        )}
      </div>

      {!loading && !error && unestimatedCount > 0 && (
        <span style={{ fontSize: 10, color: 'var(--text-subtlest)' }}>
          {unestimatedCount} unestimated ticket{unestimatedCount === 1 ? '' : 's'} counted as 1 SP
        </span>
      )}
    </div>
  );
}
