import React from 'react';
import { editStyles as S, Section, PHASE_OPTIONS } from './sprintConfigShared';

// Renders the Space -> Sprint -> SP Field -> Status Mapping sections shared by
// every TRI-* gadget's edit screen. State lives in useSprintSourceConfig();
// this component is purely presentational.
export default function SprintSourceFields({
  projects, fields, sprints, statuses,
  projectKey, sprintId, spFieldId, statusMapping,
  sprintsLoading, statusesLoading,
  onProjectChange, setSprintId, setSpFieldId, setStatusMapping,
}) {
  return (
    <>
      <Section title="1. Space">
        <select value={projectKey} onChange={e => onProjectChange(e.target.value)} style={S.select}>
          <option value="">Select a space…</option>
          {projects.map(p => <option key={p.key} value={p.key}>{p.name} ({p.key})</option>)}
        </select>
      </Section>

      <div style={S.divider} />

      <Section title="2. Sprint" disabled={!projectKey}>
        {sprintsLoading
          ? <div style={S.hint}>Loading sprints…</div>
          : (
            <select value={sprintId} onChange={e => setSprintId(e.target.value)} style={S.select}>
              <option value="active">Active Sprint (auto)</option>
              {sprints.filter(s => s.state === 'active').length > 0 && (
                <optgroup label="Pin to a specific sprint — Active">
                  {sprints.filter(s => s.state === 'active').map(s =>
                    <option key={s.id} value={String(s.id)}>{s.name}</option>
                  )}
                </optgroup>
              )}
              {sprints.filter(s => s.state === 'closed').length > 0 && (
                <optgroup label="Pin to a specific sprint — Closed">
                  {sprints.filter(s => s.state === 'closed').map(s =>
                    <option key={s.id} value={String(s.id)}>{s.name}</option>
                  )}
                </optgroup>
              )}
            </select>
          )
        }
        <div style={S.hint}>"Active Sprint (auto)" always tracks whatever sprint is currently active — no need to update this when a sprint closes. Pick a specific sprint instead to pin the widget to it (e.g. a closed sprint for a historical view).</div>
      </Section>

      <div style={S.divider} />

      <Section title="3. Story Points Field" disabled={!projectKey}>
        <select value={spFieldId} onChange={e => setSpFieldId(e.target.value)} style={S.select}>
          <option value="">Select a field…</option>
          {fields.map(f => <option key={f.id} value={f.id}>{f.name} ({f.id})</option>)}
        </select>
        <div style={S.hint}>Choose the numeric field your team uses for story point estimates.</div>
      </Section>

      <div style={S.divider} />

      <Section title="4. Status → Phase Mapping" disabled={!projectKey || statusesLoading}>
        {statusesLoading
          ? <div style={S.hint}>Loading statuses…</div>
          : statuses.length === 0
          ? <div style={S.hint}>Select a space to load its statuses.</div>
          : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {statuses.map(s => (
                <div key={s.name} style={S.statusRow}>
                  <span style={S.statusName} title={s.name}>{s.name}</span>
                  <select
                    value={statusMapping[s.name] ?? 'backlog'}
                    onChange={e => setStatusMapping(m => ({ ...m, [s.name]: e.target.value }))}
                    style={S.phaseSelect}
                  >
                    {PHASE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
              ))}
            </div>
          )
        }
        <div style={S.hint}>Assign each status to a burndown phase. <b>Excluded</b> statuses are removed from scope (like "Not Required").</div>
      </Section>
    </>
  );
}
