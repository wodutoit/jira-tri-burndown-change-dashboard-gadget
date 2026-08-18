import React, { useState, useEffect } from 'react';
import { editStyles as S } from './sprintConfigShared';
import { statusStyle, classifyReleaseStatus } from './gadgetUtils';

// Future/Active/Completed(Closed) — reuses the same category color tokens
// gadgetUtils' statusStyle already maps for Jira's own new/indeterminate/done
// (Future ~ "new", Active ~ "indeterminate", Closed/Completed ~ "done") rather
// than inventing a parallel chip palette.
const STATE_TO_CATEGORY = { future: 'new', active: 'indeterminate', closed: 'done', completed: 'done' };
const STATE_LABEL = { future: 'Future', active: 'Active', closed: 'Completed', completed: 'Completed' };

export function StatusChip({ state }) {
  const colors = statusStyle(STATE_TO_CATEGORY[state] ?? 'new');
  return (
    <span style={{ ...S.chip, background: colors.bg, color: colors.text }}>
      {STATE_LABEL[state] ?? state}
    </span>
  );
}

export function fmtDate(iso) {
  if (!iso) return '';
  try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
  catch { return String(iso).slice(5, 10); }
}

// Editable number cell, save-on-blur. `value == null` shows `fallback` in a
// muted color until the user actually edits it (e.g. Capacity defaulting to
// Base Capacity until overridden per row).
export function InlineNumberField({ value, fallback, editable = true, onCommit }) {
  const [local, setLocal] = useState(value != null ? value : (fallback ?? ''));
  useEffect(() => { setLocal(value != null ? value : (fallback ?? '')); }, [value, fallback]);
  const isOverride = value != null;

  if (!editable) {
    return <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>{local === '' ? '—' : local}</span>;
  }

  return (
    <input
      type="number" min={0}
      value={local}
      onChange={e => setLocal(e.target.value === '' ? '' : Number(e.target.value))}
      onBlur={() => onCommit(local === '' ? null : Number(local))}
      style={{ ...S.numInput, borderColor: isOverride ? 'var(--brand)' : 'var(--border)', fontWeight: isOverride ? 800 : 500 }}
    />
  );
}

export function HideClosedToggle({ checked, onChange, label }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 12, color: 'var(--text-subtle)' }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

// One row shared by the Scrum and Kanban Capacity tables. `statusSlot` and
// `actionsSlot` are rendered nodes so each table can supply its own (a plain
// chip + Edit button for Scrum, an editable status <select> + Edit/Delete for
// Kanban) without this component needing to know which.
export function CapacityTableRow({
  name, dateRangeText, baseCapacitySp,
  capacitySp, committedSp, velocitySp,
  velocityEditable, committedLoading, velocityLoading,
  onCapacityChange, onCommittedChange, onGetCommitted, onVelocityChange, onGetVelocity,
  statusSlot, releaseSlot, actionsSlot,
}) {
  return (
    <tr style={S.row}>
      <td style={S.td}>
        <div style={{ fontWeight: 600, color: 'var(--text)' }}>{name}</div>
        <div style={{ fontSize: 11, color: 'var(--text-subtlest)' }}>{dateRangeText}</div>
      </td>
      <td style={S.td}>
        <InlineNumberField value={capacitySp} fallback={baseCapacitySp} onCommit={onCapacityChange} />
      </td>
      <td style={S.td}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <InlineNumberField value={committedSp} fallback={0} onCommit={onCommittedChange} />
          <button onClick={onGetCommitted} disabled={committedLoading} style={S.smallBtn}>
            {committedLoading ? 'Getting…' : 'Get SP Count'}
          </button>
        </div>
      </td>
      <td style={S.td}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <InlineNumberField value={velocitySp} fallback={0} editable={velocityEditable} onCommit={onVelocityChange} />
          <button onClick={onGetVelocity} disabled={velocityLoading} style={S.smallBtn}>
            {velocityLoading ? 'Getting…' : 'Get Velocity'}
          </button>
        </div>
      </td>
      <td style={S.td}>{statusSlot}</td>
      {releaseSlot !== undefined && <td style={S.td}>{releaseSlot}</td>}
      <td style={{ ...S.td, textAlign: 'right', whiteSpace: 'nowrap' }}>{actionsSlot}</td>
    </tr>
  );
}

// Resolves a stored releaseId to its Jira version, live — never cached —
// so a row always reflects the version's current name/released/archived
// state even if it changed after the id was saved. Falls back to a plain
// label if the version was deleted in Jira after being assigned here.
function findRelease(releaseId, releaseOptions) {
  return releaseOptions.find(v => v.id === releaseId) || null;
}

function releaseLabel(releaseId, releaseOptions) {
  if (!releaseId) return null;
  const v = findRelease(releaseId, releaseOptions);
  return v ? v.name : '(deleted release)';
}

function sortReleases(versions) {
  return [...versions].sort((a, b) => {
    if (a.releaseDate && b.releaseDate) return a.releaseDate < b.releaseDate ? -1 : 1;
    if (a.releaseDate) return -1;
    if (b.releaseDate) return 1;
    return a.name < b.name ? -1 : 1;
  });
}

// Editable <select> of unreleased/unarchived versions (plus whatever's
// currently assigned, even if it's since shipped/archived, so an existing
// assignment never silently disappears from its own dropdown) — read-only
// rows render the resolved name as plain text instead, same visual
// convention as InlineNumberField's non-editable branch.
export function ReleaseSelectCell({ releaseId, releaseOptions, readOnly, onChange }) {
  if (readOnly) {
    const label = releaseLabel(releaseId, releaseOptions);
    return <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>{label ?? '—'}</span>;
  }

  const current = releaseId ? findRelease(releaseId, releaseOptions) : null;
  const selectable = releaseOptions.filter(v => !v.released && !v.archived);
  const options = current && !selectable.some(v => v.id === current.id)
    ? [current, ...selectable]
    : selectable;

  return (
    <select
      value={releaseId || ''}
      onChange={e => onChange(e.target.value || null)}
      style={{ ...S.select, width: 160 }}
    >
      <option value="">— none —</option>
      {sortReleases(options).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
    </select>
  );
}

// Rolls up whatever rows are currently visible in the Capacity table
// (respects hideClosed/hideCompleted + closedLimit/completedLimit already
// applied by the caller) into one row per mapped release. Rendered above
// the Capacity table, only when Release Mapping is enabled.
export function ReleasesSummaryTable({ rows, releaseOptions, baseCapacitySp, thresholdPct }) {
  const groups = new Map();
  for (const row of rows) {
    if (!row.releaseId) continue;
    if (!groups.has(row.releaseId)) groups.set(row.releaseId, []);
    groups.get(row.releaseId).push(row);
  }

  const summaries = [...groups.entries()].map(([releaseId, group]) => {
    const totalCapacity = group.reduce((a, r) => a + (r.capacitySp ?? baseCapacitySp ?? 0), 0);
    const totalCommitted = group.reduce((a, r) => a + (r.committedSp ?? 0), 0);
    // A future/in-progress sprint's velocity reads as 0 (nothing's Done yet)
    // long before it means anything — averaging that 0 in would drag the
    // release average down purely because the release isn't finished, not
    // because the finished sprints underperformed. Only a >0 recorded
    // velocity counts as "has velocity" here.
    const withVelocity = group.filter(r => r.velocitySp != null && r.velocitySp > 0);
    const avgVelocity = withVelocity.length
      ? withVelocity.reduce((a, r) => a + r.velocitySp, 0) / withVelocity.length
      : 0;

    // Tier boundaries come from the shared classifier (also used by the TRI
    // Release Capacity gadget's chart) — only the presentation is local here:
    // both over-tiers render as the same red chip on this table (unchanged
    // from before this was extracted), while the threshold % is baked into
    // the label itself so it's visible without a separate column.
    const { tier } = classifyReleaseStatus(totalCommitted, totalCapacity, thresholdPct);
    const STATUS_LABELS = {
      none: { label: '—', bg: 'transparent', text: 'var(--text-subtlest)' },
      overCapacity: { label: 'Over Capacity', bg: 'var(--over-bg)', text: 'var(--over-text)' },
      overThreshold: { label: `Over Threshold (${thresholdPct}%)`, bg: 'var(--over-bg)', text: 'var(--over-text)' },
      within: { label: `Within Threshold (${thresholdPct}%)`, bg: 'var(--ok-bg)', text: 'var(--ok-text)' },
    };
    const status = STATUS_LABELS[tier];

    return {
      releaseId, name: releaseLabel(releaseId, releaseOptions) ?? releaseId,
      sprintCount: group.length, totalCapacity, totalCommitted, avgVelocity, status,
    };
  });

  return (
    <table style={S.table}>
      <thead>
        <tr>
          <th style={S.th}>Release</th>
          <th style={S.th}>Sprint count</th>
          <th style={S.th}>Total capacity</th>
          <th style={S.th}>Total committed</th>
          <th style={S.th}>Avg velocity</th>
          <th style={S.th}>Status</th>
        </tr>
      </thead>
      <tbody>
        {summaries.length === 0 ? (
          <tr><td style={S.td} colSpan={6}>No releases mapped yet.</td></tr>
        ) : summaries.map(s => (
          <tr key={s.releaseId} style={S.row}>
            <td style={S.td}>{s.name}</td>
            <td style={S.td}>{s.sprintCount}</td>
            <td style={S.td}>{Math.round(s.totalCapacity * 10) / 10}</td>
            <td style={S.td}>{Math.round(s.totalCommitted * 10) / 10}</td>
            <td style={S.td}>{Math.round(s.avgVelocity * 10) / 10}</td>
            <td style={S.td}>
              <span style={{ ...S.chip, background: s.status.bg, color: s.status.text }}>{s.status.label}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
