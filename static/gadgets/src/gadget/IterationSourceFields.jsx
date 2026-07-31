import React from 'react';
import { editStyles as S, Section, PHASE_OPTIONS } from './sprintConfigShared';

// Renders the Space -> Iteration -> SP Field -> Status Mapping sections
// shared by every TRI-Kanban-* gadget's edit screen — the Kanban sibling of
// SprintSourceFields.jsx. State lives in useIterationSourceConfig(); this
// component is purely presentational.
export default function IterationSourceFields({
  projects, fields, iterations, statuses,
  projectKey, iterationId, spFieldId, statusMapping,
  iterationsLoading, statusesLoading,
  onProjectChange, setIterationId, setSpFieldId, setStatusMapping,
}) {
  const byStatus = (status) => iterations.filter(it => it.status === status);

  return (
    <>
      <Section title="1. Space">
        <select value={projectKey} onChange={e => onProjectChange(e.target.value)} style={S.select}>
          <option value="">Select a space…</option>
          {projects.map(p => <option key={p.key} value={p.key}>{p.name} ({p.key})</option>)}
        </select>
        <div style={S.hint}>Only spaces with Capacity Planning enabled (Kanban) are listed — this gadget reads a space's configured iterations.</div>
      </Section>

      <div style={S.divider} />

      <Section title="2. Iteration" disabled={!projectKey}>
        {iterationsLoading
          ? <div style={S.hint}>Loading iterations…</div>
          : (
            <select value={iterationId} onChange={e => setIterationId(e.target.value)} style={S.select}>
              <option value="active">Active Iteration (auto)</option>
              {byStatus('active').length > 0 && (
                <optgroup label="Pin to a specific iteration — Active">
                  {byStatus('active').map(it => <option key={it.id} value={it.id}>{it.name}</option>)}
                </optgroup>
              )}
              {byStatus('future').length > 0 && (
                <optgroup label="Pin to a specific iteration — Future">
                  {byStatus('future').map(it => <option key={it.id} value={it.id}>{it.name}</option>)}
                </optgroup>
              )}
              {byStatus('completed').length > 0 && (
                <optgroup label="Pin to a specific iteration — Completed">
                  {byStatus('completed').map(it => <option key={it.id} value={it.id}>{it.name}</option>)}
                </optgroup>
              )}
            </select>
          )
        }
        <div style={S.hint}>"Active Iteration (auto)" always tracks whichever iteration is currently Active on the Capacity tab — no need to update this when one closes out. Pick a specific iteration instead to pin the widget to it (e.g. a completed one for a historical view).</div>
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
        <div style={S.hint}>Assign each status to a phase. <b>Excluded</b> statuses are removed from scope (like "Not Required") — same mapping concept as TRI Burndown/Rework/Cycle Time, kept independent of Capacity's own status-category-based Kanban math.</div>
      </Section>
    </>
  );
}
