import React from 'react';
import { editStyles as S, Section, PHASE_OPTIONS } from './sprintConfigShared';

// One row of TRI Velocity's config: Space -> Story Points Field -> Status
// Mapping. Unlike the other gadgets there's no Sprint step here — velocity
// always trends across a space's most recent closed sprints, not one pinned
// sprint.
export default function VelocitySpaceRow({
  index, space, projects, fields, takenKeys,
  onProjectChange, onFieldChange, onMappingChange, onRemove, canRemove,
}) {
  const { projectKey, spFieldId, statusMapping, statuses, statusesLoading } = space;
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

      <Section title="Story Points Field" disabled={!projectKey}>
        <select value={spFieldId} onChange={e => onFieldChange(e.target.value)} style={S.select}>
          <option value="">Select a field…</option>
          {fields.map(f => <option key={f.id} value={f.id}>{f.name} ({f.id})</option>)}
        </select>
      </Section>

      <Section title="Status → Phase Mapping" disabled={!projectKey || statusesLoading}>
        {statusesLoading
          ? <div style={S.hint}>Loading statuses…</div>
          : (statuses ?? []).length === 0
          ? <div style={S.hint}>Select a space to load its statuses.</div>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {statuses.map(s => (
                <div key={s.name} style={S.statusRow}>
                  <span style={S.statusName} title={s.name}>{s.name}</span>
                  <select
                    value={statusMapping[s.name] ?? 'backlog'}
                    onChange={e => onMappingChange(s.name, e.target.value)}
                    style={S.phaseSelect}
                  >
                    {PHASE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )
        }
        <div style={S.hint}>
          Only <b>Done</b> matters here — a sprint's velocity is the SP of issues in a Done-mapped status by the
          sprint's close. <b>Excluded</b> removes SP from both committed and completed scope, same as the other
          TRI-* gadgets.
        </div>
      </Section>
    </div>
  );
}
