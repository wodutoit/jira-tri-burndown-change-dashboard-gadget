import React, { useState } from 'react';
import { editStyles as S } from './sprintConfigShared';

const STATUS_OPTIONS = [
  { value: 'future', label: 'Future' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
];

// Reused for both Add and Edit — `initial` carries the defaults computed by
// the caller (see computeNextIterationDefaults in CapacityKanbanTab.jsx for
// Add; the existing iteration's own values for Edit).
export default function KanbanIterationDialog({ mode, initial, saving, error, onSave, onCancel }) {
  const [name, setName] = useState(initial.name || '');
  const [description, setDescription] = useState(initial.description || '');
  const [capacitySp, setCapacitySp] = useState(initial.capacitySp ?? 0);
  const [startDate, setStartDate] = useState(initial.startDate || '');
  const [endDate, setEndDate] = useState(initial.endDate || '');
  const [status, setStatus] = useState(initial.status || 'future');
  const [labelFilter, setLabelFilter] = useState(initial.labelFilter || '');

  const canSave = name.trim().length > 0 && !!startDate && !!endDate;
  const title = mode === 'edit' ? `Edit iteration — ${initial.name}` : 'Add iteration';

  return (
    <div onClick={onCancel} style={S.dialogOverlay}>
      <div onClick={e => e.stopPropagation()} style={{ ...S.dialogBox, width: 480 }}>
        <div style={S.dialogTitle}>{title}</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 16 }}>
          <label style={S.fieldLabel}>Name</label>
          <input autoFocus value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Iteration 4" style={S.textInput} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 14 }}>
          <label style={S.fieldLabel}>Description <span style={{ fontWeight: 400, color: 'var(--text-subtlest)' }}>(optional)</span></label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2} style={{ ...S.textInput, resize: 'vertical' }} />
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 14 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={S.fieldLabel}>Capacity (SP)</label>
            <input type="number" min="0" value={capacitySp} onChange={e => setCapacitySp(e.target.value === '' ? '' : Number(e.target.value))} style={S.textInput} />
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={S.fieldLabel}>Status</label>
            <select value={status} onChange={e => setStatus(e.target.value)} style={S.textInput}>
              {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 14 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={S.fieldLabel}>Start date</label>
            <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={S.textInput} />
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={S.fieldLabel}>End date</label>
            <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={S.textInput} />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 14 }}>
          <label style={S.fieldLabel}>Label Filter <span style={{ fontWeight: 400, color: 'var(--text-subtlest)' }}>(optional)</span></label>
          <input value={labelFilter} onChange={e => setLabelFilter(e.target.value)} placeholder="e.g. release-4.2" style={S.textInput} />
          <div style={S.hint}>When set, only issues carrying this exact Jira label count toward this iteration's Velocity (and Committed too, if "Apply Label Filter to Committed" is turned on in Capacity settings).</div>
        </div>

        {error && <div style={{ ...S.error, marginTop: 12 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 }}>
          <button onClick={onCancel} disabled={saving} style={{ ...S.btn, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-subtle)' }}>Cancel</button>
          <button
            disabled={!canSave || saving}
            onClick={() => canSave && onSave({ name: name.trim(), description, capacitySp: Number(capacitySp) || 0, startDate, endDate, status, labelFilter })}
            style={{ ...S.btn, opacity: (!canSave || saving) ? 0.6 : 1 }}
          >
            {saving ? 'Saving…' : (mode === 'edit' ? 'Save changes' : 'Add iteration')}
          </button>
        </div>
      </div>
    </div>
  );
}
