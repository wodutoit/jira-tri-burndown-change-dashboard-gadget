import React from 'react';
import { editStyles as S } from './sprintConfigShared';

// One row of TRI Velocity's config: just a Space picker. Story Points Field,
// Status Mapping, and Commitment Grace Window all disappeared from here —
// this gadget now reads a space's own Capacity settings/data instead of
// computing anything itself, so `projects` is already filtered to spaces
// with Capacity Planning enabled (see TriVelocityGadgetEdit.jsx).
export default function VelocitySpaceRow({ index, space, projects, takenKeys, onProjectChange, onRemove, canRemove }) {
  const { projectKey } = space;
  const availableProjects = projects.filter(p => p.key === projectKey || !takenKeys.has(p.key));

  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={S.label}>Space {index + 1}</div>
        {canRemove && (
          <button
            onClick={onRemove}
            style={{ background: 'none', border: 'none', color: 'var(--over-text)', cursor: 'pointer', fontSize: 12, padding: 0, fontFamily: 'inherit' }}
          >
            Remove
          </button>
        )}
      </div>

      <select value={projectKey} onChange={e => onProjectChange(e.target.value)} style={S.select}>
        <option value="">Select a space…</option>
        {availableProjects.map(p => <option key={p.key} value={p.key}>{p.name} ({p.key})</option>)}
      </select>
    </div>
  );
}
