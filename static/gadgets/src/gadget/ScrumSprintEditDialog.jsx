import React, { useState } from 'react';
import { editStyles as S } from './sprintConfigShared';

// Deliberately excludes the sprint's Name — requirements limit editing to the
// Goal ("description" in the requirements' wording; Jira's actual field is
// `goal`) and dates. Name is shown read-only as the dialog title.
export default function ScrumSprintEditDialog({ sprint, saving, error, onSave, onCancel }) {
  const [goal, setGoal] = useState(sprint.goal || '');
  const [startDate, setStartDate] = useState((sprint.startDate || '').slice(0, 10));
  const [endDate, setEndDate] = useState((sprint.endDate || '').slice(0, 10));

  return (
    <div onClick={onCancel} style={S.dialogOverlay}>
      <div onClick={e => e.stopPropagation()} style={S.dialogBox}>
        <div style={S.dialogTitle}>Edit sprint — {sprint.name}</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 16 }}>
          <label style={S.fieldLabel}>Sprint Goal</label>
          <textarea
            value={goal} onChange={e => setGoal(e.target.value)}
            rows={3}
            style={{ ...S.textInput, resize: 'vertical' }}
          />
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

        {error && <div style={{ ...S.error, marginTop: 12 }}>{error}</div>}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 22 }}>
          <button onClick={onCancel} disabled={saving} style={{ ...S.btn, background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-subtle)' }}>Cancel</button>
          <button
            disabled={saving}
            onClick={() => onSave({ goal, startDate, endDate })}
            style={{ ...S.btn, opacity: saving ? 0.6 : 1 }}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}
