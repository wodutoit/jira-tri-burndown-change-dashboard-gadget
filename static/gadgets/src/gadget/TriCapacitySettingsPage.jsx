import React, { useState, useEffect } from 'react';
import { invoke, view } from '@forge/bridge';
import { editStyles as S, Section } from './sprintConfigShared';
import { statusStyle } from './gadgetUtils';

// jira:projectSettingsPage — toggles the "tri-capacity-planning" project
// entity property that jira:projectPage's displayConditions.entityPropertyEqualTo
// reads to decide whether to show the Capacity tab for this project at all,
// plus the Capacity settings that tab's table reads (Base Capacity, default
// Sprint/Iteration length, Story Points field, Commitment Grace Window, and —
// Kanban projects only — "Allow multiple active iterations" and the
// Committed-status whitelist). Capacity deliberately has no 7-value Status
// Mapping step here like the other gadgets — Scrum still just uses Jira's
// built-in status category; Kanban's Committed calculation is the one place
// that needs a customizable status list (see the Committed Statuses section).
export default function TriCapacitySettingsPage() {
  const [projectKey, setProjectKey] = useState(null);
  const [enabled, setEnabled] = useState(false);
  const [detectedType, setDetectedType] = useState(null); // 'scrum' | 'kanban' | null (unknown/no board) — auto-detected, ignoring any override
  const [fields, setFields] = useState([]);
  const [statuses, setStatuses] = useState([]);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    view.theme.enable().catch(() => {});
    view.getContext().then(async ctx => {
      const key = ctx?.extension?.project?.key;
      setProjectKey(key ?? null);
      if (!key) { setError('No project context.'); return; }

      const [enabledRes, boardRes, fieldsRes, statusesRes, settingsRes] = await Promise.all([
        invoke('getCapacityPlanningEnabled', { projectKey: key }),
        invoke('getCapacityBoardInfo', { projectKey: key }),
        invoke('getNumericFields'),
        invoke('getProjectStatuses', { projectKey: key }),
        invoke('getCapacitySettings', { projectKey: key }),
      ]);
      if (enabledRes.error) setError(enabledRes.error);
      setEnabled(!!enabledRes.enabled);
      if (!boardRes.error) setDetectedType(boardRes.detectedType);
      setFields(fieldsRes.fields ?? []);
      setStatuses(statusesRes.statuses ?? []);
      setSettings(settingsRes.settings);
    }).catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  const handleToggle = async (e) => {
    const next = e.target.checked;
    setEnabled(next);
    setSaving(true);
    setSaved(false);
    try {
      const res = await invoke('setCapacityPlanningEnabled', { projectKey, enabled: next });
      if (res.error) setError(res.error);
      else setSaved(true);
    } finally {
      setSaving(false);
    }
  };

  const saveSettings = async (patch) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    setSaving(true);
    setSaved(false);
    try {
      const res = await invoke('setCapacitySettings', { projectKey, settings: next });
      if (res.error) setError(res.error);
      else { setSettings(res.settings); setSaved(true); }
    } finally {
      setSaving(false);
    }
  };

  if (loading || !settings) {
    return <div style={{ padding: 20, fontSize: 13, fontFamily: 'inherit' }}>Loading…</div>;
  }

  // Effective type the Capacity tab will actually use: the override when one's
  // set, otherwise whatever getCapacityBoardInfo auto-detected.
  const override = settings.boardTypeOverride || 'auto';
  const boardType = override === 'auto' ? detectedType : override;

  // Mirrors the backend's defaultCommittedStatusNames() — until a project
  // customizes the list, "committed" is every In Progress-category status
  // (not Done — a ticket sitting in a terminal Done status has nothing to do
  // with a brand-new iteration just because it's never been moved since), so
  // the checkboxes start pre-checked to match what's actually being
  // calculated right now.
  const defaultCommitted = statuses.filter(s => s.categoryKey === 'indeterminate').map(s => s.name);
  const isCustomized = settings.kanbanCommittedStatuses.length > 0;
  const committedSet = new Set(isCustomized ? settings.kanbanCommittedStatuses : defaultCommitted);

  const toggleCommittedStatus = (name) => {
    const next = new Set(committedSet);
    if (next.has(name)) next.delete(name); else next.add(name);
    saveSettings({ kanbanCommittedStatuses: [...next] });
  };

  return (
    <div style={S.wrap}>
      {error && <div style={S.error}>{error}</div>}

      <Section title="Capacity Planning">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
          <input type="checkbox" checked={enabled} disabled={saving || !projectKey} onChange={handleToggle} />
          Enable Capacity Planning for this space
        </label>
        <div style={S.hint}>
          When enabled, a "Capacity" tab appears alongside this project's other tabs (Summary, Board, Reports, …).
          Jira only evaluates this when the project loads, so reload the project after changing this setting to see
          the tab appear or disappear.
        </div>
      </Section>

      <div style={S.divider} />

      <Section title="Board Type">
        <select
          value={override}
          onChange={e => saveSettings({ boardTypeOverride: e.target.value })}
          style={S.select}
        >
          <option value="auto">Auto-detect{detectedType ? ` (currently: ${detectedType === 'kanban' ? 'Kanban' : 'Scrum'})` : ''}</option>
          <option value="scrum">Force Scrum</option>
          <option value="kanban">Force Kanban</option>
        </select>
        <div style={S.hint}>
          Auto-detect can misread a team-managed project's board, since Jira reports the same generic type for both
          Scrum and Kanban team-managed boards. If the Capacity tab shows the wrong table (sprints instead of
          iterations, or vice versa), force the correct one here.
        </div>
      </Section>

      <div style={S.divider} />

      <Section title="Base Capacity">
        <input
          type="number" min="0"
          value={settings.baseCapacitySp}
          onChange={e => setSettings(s => ({ ...s, baseCapacitySp: e.target.value }))}
          onBlur={e => saveSettings({ baseCapacitySp: Number(e.target.value) || 0 })}
          style={{ ...S.select, width: 100 }}
        /> story points per sprint/iteration
        <div style={S.hint}>The default capacity shown for every sprint/iteration in the Capacity table. Each row can still be overridden individually.</div>
      </Section>

      <div style={S.divider} />

      <Section title="Default Sprint/Iteration Length">
        <input
          type="number" min="1"
          value={settings.defaultIterationLengthWeeks}
          onChange={e => setSettings(s => ({ ...s, defaultIterationLengthWeeks: e.target.value }))}
          onBlur={e => saveSettings({ defaultIterationLengthWeeks: Number(e.target.value) || 2 })}
          style={{ ...S.select, width: 100 }}
        /> weeks
        <div style={S.hint}>Used to default a new Kanban iteration's end date, and has no effect for Scrum (sprint length is whatever Jira's own sprint dates say).</div>
      </Section>

      <div style={S.divider} />

      <Section title="Story Points Field">
        <select
          value={settings.spFieldId}
          onChange={e => saveSettings({ spFieldId: e.target.value })}
          style={S.select}
        >
          <option value="">Select a field…</option>
          {fields.map(f => <option key={f.id} value={f.id}>{f.name} ({f.id})</option>)}
        </select>
        <div style={S.hint}>The numeric field the Capacity table reads for Committed/Velocity calculations.</div>
      </Section>

      <div style={S.divider} />

      <Section title="Commitment Grace Window">
        <input
          type="number" min="1"
          value={settings.graceWindowHours}
          onChange={e => setSettings(s => ({ ...s, graceWindowHours: e.target.value }))}
          onBlur={e => saveSettings({ graceWindowHours: Number(e.target.value) || 12 })}
          style={{ ...S.select, width: 100 }}
        /> hours
        <div style={S.hint}>
          Same meaning as the other TRI-* gadgets' Grace Window: work already in progress within this many hours of
          a sprint/iteration's start still counts as "committed" rather than mid-sprint scope creep.
        </div>
      </Section>

      {boardType === 'kanban' && (
        <>
          <div style={S.divider} />
          <Section title="Committed Statuses">
            {statuses.length === 0 ? (
              <div style={S.hint}>No statuses found for this project.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {statuses.map(s => {
                  const colors = statusStyle(s.categoryKey);
                  return (
                    <label key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                      <input type="checkbox" checked={committedSet.has(s.name)} onChange={() => toggleCommittedStatus(s.name)} />
                      <span>{s.name}</span>
                      <span style={{ ...S.chip, background: colors.bg, color: colors.text }}>{s.categoryKey}</span>
                    </label>
                  );
                })}
              </div>
            )}
            {isCustomized && (
              <button
                onClick={() => saveSettings({ kanbanCommittedStatuses: [] })}
                style={{ alignSelf: 'flex-start', marginTop: 6, background: 'none', border: 'none', padding: 0, color: 'var(--brand)', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12 }}
              >
                Reset to default (based on status category)
              </button>
            )}
            <div style={S.hint}>
              Which statuses count as "committed" for Kanban's Committed calculation — a ticket in one of these
              statuses at an iteration's start (+ grace window) counts toward Committed, regardless of what Jira's
              own status category says. Until you check/uncheck anything here, this defaults to every In Progress
              status (not Done — a ticket already sitting in a terminal Done status has nothing to do with a new
              iteration just because it's never been touched since). Check a To Do–category status too (e.g. a
              custom "Team Estimated" status) if your team treats it as already-committed work, or a Done-category
              one if your workflow genuinely needs it. Has no effect on Scrum or on Velocity's Done detection.
            </div>
          </Section>

          <div style={S.divider} />
          <Section title="Apply Label Filter to Committed">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!!settings.kanbanCommittedUsesLabelFilter}
                onChange={e => saveSettings({ kanbanCommittedUsesLabelFilter: e.target.checked })}
              />
              Scope Committed to an iteration's Label Filter too
            </label>
            <div style={S.hint}>
              Off by default — Committed always sums every issue matching the Committed Statuses above, regardless
              of an iteration's Label Filter. Turn this on if an iteration's Label Filter should also narrow which
              issues count toward Committed (not just Velocity, which always respects it).
            </div>
          </Section>

          <div style={S.divider} />
          <Section title="Allow multiple active iterations">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!!settings.kanbanAllowMultipleActive}
                onChange={e => saveSettings({ kanbanAllowMultipleActive: e.target.checked })}
              />
              Allow more than one iteration to be Active at once
            </label>
            <div style={S.hint}>
              Off by default — trying to activate a second iteration while one is already Active is blocked with an
              error until you change the other iteration's status first.
            </div>
          </Section>
        </>
      )}

      {saved && !saving && <div style={S.hint}>Saved.</div>}
    </div>
  );
}
