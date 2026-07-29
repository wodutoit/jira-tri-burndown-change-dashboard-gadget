import React, { useState, useEffect } from 'react';
import { editStyles as S } from './sprintConfigShared';
import { statusStyle } from './gadgetUtils';

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
  statusSlot, actionsSlot,
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
      <td style={{ ...S.td, textAlign: 'right', whiteSpace: 'nowrap' }}>{actionsSlot}</td>
    </tr>
  );
}
