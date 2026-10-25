import React, { useState, useEffect } from 'react';
import { editStyles as S } from './sprintConfigShared';
import { statusStyle } from './gadgetUtils';
import { summarizeReleases } from './capacitySnapshot';
import { buildPortfolioRows } from './portfolioModel';
import PortfolioBar from './PortfolioBar';

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
// assignment never silently disappears from its own dropdown) — always
// editable, including closed sprints/completed iterations, since a release
// already assigned there may itself have since shipped and still needs to
// be changeable.
export function ReleaseSelectCell({ releaseId, releaseOptions, onChange }) {
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

// Rolls up mapped rows into one row per release. Which releases are listed is
// driven by the currently visible rows (hideClosed/hideCompleted +
// closedLimit/completedLimit already applied by the caller), but every figure
// shown for a release is computed from ALL rows mapped to it, visible or not,
// so hiding a sprint never changes a release's totals. Rendered above the
// Capacity table, only when Release Mapping is enabled.
//
// `portfolio` (optional, Scrum + Portfolio Planning only) adds an allocation bar
// and Portfolio button under each release's Status chip:
//   { thresholds, allocations, actuals, options, optionsLoaded, actualsLoading, error, onOpen(releaseId) }
export function ReleasesSummaryTable({ rows, allRows = rows, releaseOptions, baseCapacitySp, thresholdPct, portfolio = null, onRefresh = null, refreshing = false }) {
  const STATUS_LABELS = {
    none: { label: '—', bg: 'transparent', text: 'var(--text-subtlest)' },
    overCapacity: { label: 'Over Capacity', bg: 'var(--over-bg)', text: 'var(--over-text)' },
    overThreshold: { label: `Over Threshold (${thresholdPct}%)`, bg: 'var(--filling-bg)', text: 'var(--filling-text)' },
    within: { label: `Within Threshold (${thresholdPct}%)`, bg: 'var(--ok-bg)', text: 'var(--ok-text)' },
  };
  // Over Threshold is amber (still within capacity, buffer eaten into), Over
  // Capacity is red — matches the TRI Release Capacity gadget's convention.
  const summaries = summarizeReleases({ rows, allRows, releaseOptions, baseCapacitySp, thresholdPct })
    .map(s => ({ ...s, status: STATUS_LABELS[s.tier] }));

  return (
    <table style={S.table}>
      <thead>
        <tr>
          <th style={S.th}>Release</th>
          <th style={S.th}>Sprint count</th>
          <th style={S.th}>Total capacity</th>
          <th style={S.th}>Threshold capacity</th>
          <th style={S.th}>Total committed</th>
          <th style={S.th}>Avg velocity</th>
          <th style={S.th}>
            Status
            {onRefresh && (
              <button
                onClick={onRefresh}
                disabled={refreshing}
                title="Recount Committed SP (and tickets without estimates) from Jira for every sprint mapped to a release. Hand-typed Committed values are left as they are."
                aria-label="Refresh status"
                style={{ ...S.smallBtn, marginLeft: 8, padding: '0 6px', opacity: refreshing ? 0.6 : 1 }}
              >
                {refreshing ? 'Refreshing…' : '↻'}
              </button>
            )}
          </th>
        </tr>
      </thead>
      <tbody>
        {summaries.length === 0 ? (
          <tr><td style={S.td} colSpan={7}>No releases mapped yet.</td></tr>
        ) : summaries.map(s => (
          <tr key={s.releaseId} style={S.row}>
            <td style={S.td}>
              <div>{s.name}</div>
              {portfolio && (
                <button onClick={() => portfolio.onOpen(s.releaseId)} style={{ ...S.smallBtn, marginTop: 6 }}>
                  {portfolio.allocations[s.releaseId] || portfolio.defaultAllocation ? 'Portfolio' : 'Set portfolio'}
                </button>
              )}
            </td>
            <td style={S.td}>{s.sprintCount}</td>
            <td style={S.td}>{Math.round(s.totalCapacity * 10) / 10}</td>
            <td style={S.td}>{Math.round(s.thresholdCapacity * 10) / 10}</td>
            <td style={S.td}>{Math.round(s.totalCommitted * 10) / 10}</td>
            <td style={S.td}>{Math.round(s.avgVelocity * 10) / 10}</td>
            <td style={S.td}>
              <span style={{ ...S.chip, background: s.status.bg, color: s.status.text }}>{s.status.label}</span>
              {portfolio && (
                <PortfolioBar
                  model={buildPortfolioRows({
                    options: portfolio.options,
                    optionsLoaded: portfolio.optionsLoaded,
                    // A release's own allocation wins; otherwise the space default.
                    allocation: portfolio.allocations[s.releaseId] ?? portfolio.defaultAllocation ?? null,
                    isDefault: !portfolio.allocations[s.releaseId],
                    actuals: portfolio.actuals[s.releaseId] ?? null,
                    historical: !!findRelease(s.releaseId, releaseOptions)?.released,
                    thresholds: portfolio.thresholds,
                  })}
                  loading={portfolio.actualsLoading && !portfolio.actuals[s.releaseId]}
                  error={portfolio.error}
                />
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
