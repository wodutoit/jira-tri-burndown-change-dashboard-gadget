import React, { useState, useEffect } from 'react';
import { invoke, view } from '@forge/bridge';
import { editStyles as S, Section } from './sprintConfigShared';
import { statusStyle, portfolioBands } from './gadgetUtils';

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
  // Portfolio Planning: candidate fields, the chosen field's options (preview
  // only — allocations are edited per release on the Capacity tab), a field
  // change awaiting inline confirmation, and the threshold inputs as typed
  // (strings, so a half-typed value doesn't get clamped mid-keystroke).
  const [portfolioFields, setPortfolioFields] = useState([]);
  const [portfolioOptions, setPortfolioOptions] = useState([]);
  const [optionsError, setOptionsError] = useState(null);
  const [pendingField, setPendingField] = useState(null);
  const [pf, setPf] = useState({ warn: '10', crit: '20', floor: '1' });
  const [pfError, setPfError] = useState(null);

  useEffect(() => {
    if (!settings) return;
    setPf({
      warn: String(settings.portfolioWarnPct),
      crit: String(settings.portfolioCriticalPct),
      floor: String(settings.portfolioMinTolerancePp),
    });
  }, [settings?.portfolioWarnPct, settings?.portfolioCriticalPct, settings?.portfolioMinTolerancePp]);

  const portfolioOn = !!settings?.portfolioPlanningEnabled;
  const portfolioFieldId = settings?.portfolioFieldId || '';

  useEffect(() => {
    if (!portfolioOn || !projectKey) return;
    let ignore = false;
    invoke('getPortfolioFieldCandidates').then(res => {
      if (!ignore) setPortfolioFields(res.fields ?? []);
    }).catch(() => {});
    return () => { ignore = true; };
  }, [portfolioOn, projectKey]);

  useEffect(() => {
    setPortfolioOptions([]);
    setOptionsError(null);
    if (!portfolioOn || !projectKey || !portfolioFieldId) return;
    let ignore = false;
    invoke('getPortfolioFieldOptions', { projectKey, fieldId: portfolioFieldId }).then(res => {
      if (ignore) return;
      setPortfolioOptions(res.options ?? []);
      setOptionsError(res.error ?? null);
    }).catch(e => { if (!ignore) setOptionsError(String(e)); });
    return () => { ignore = true; };
  }, [portfolioOn, projectKey, portfolioFieldId]);

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
      if (res.error) {
        setError(res.error);
        // The optimistic update above is now wrong (e.g. the server refused to
        // enable Portfolio Planning) — put back whatever is actually stored.
        const current = await invoke('getCapacitySettings', { projectKey });
        if (current.settings) setSettings(current.settings);
      } else { setSettings(res.settings); setSaved(true); setError(null); }
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

  const excludedDoneSet = new Set(settings.excludedDoneStatuses || []);
  const toggleExcludedDoneStatus = (name) => {
    const next = new Set(excludedDoneSet);
    if (next.has(name)) next.delete(name); else next.add(name);
    saveSettings({ excludedDoneStatuses: [...next] });
  };

  // Portfolio Planning gating: needs Release Mapping (allocations are per
  // release) and a Scrum space. An already-enabled space can always be turned
  // off, even if it has since stopped qualifying.
  const portfolioBlockedReason = !settings.releaseMappingEnabled
    ? 'Turn on Release Mapping first — portfolio allocations are set per release.'
    : boardType === 'kanban'
      ? 'Portfolio Planning is only available for Scrum spaces.'
      : boardType !== 'scrum'
        ? "This space's board type couldn't be detected, so Portfolio Planning can't be enabled yet."
        : null;

  const handleFieldChange = (next) => {
    if (next === portfolioFieldId) return;
    // First pick has nothing to lose; changing/clearing an existing choice
    // orphans that space's saved allocations, so ask first.
    if (portfolioFieldId) setPendingField(next);
    else saveSettings({ portfolioFieldId: next });
  };

  const commitThresholds = () => {
    const warn = Number(pf.warn);
    const crit = Number(pf.crit);
    const floor = Number(pf.floor);
    if (![warn, crit, floor].every(Number.isFinite) || pf.warn === '' || pf.crit === '' || pf.floor === '') {
      setPfError('Enter a number in every threshold field.');
    } else if (warn < 0 || warn > 100 || crit < 0 || crit > 100) {
      setPfError('Warn and critical must be between 0 and 100.');
    } else if (floor < 0 || floor > 20) {
      setPfError('Minimum tolerance must be between 0 and 20 percentage points.');
    } else if (warn >= crit) {
      setPfError('Warn must be lower than critical.');
    } else {
      setPfError(null);
      if (warn !== settings.portfolioWarnPct || crit !== settings.portfolioCriticalPct || floor !== settings.portfolioMinTolerancePp) {
        saveSettings({ portfolioWarnPct: warn, portfolioCriticalPct: crit, portfolioMinTolerancePp: floor });
      }
    }
  };

  const exampleBands = (() => {
    const w = Number(pf.warn), c = Number(pf.crit), f = Number(pf.floor);
    if (![w, c, f].every(Number.isFinite) || w >= c) return null;
    const fmt = n => Math.round(n * 10) / 10;
    return [20, 5].map(target => {
      const b = portfolioBands(target, w, c, f);
      return `${target}% target: green ${fmt(target - b.warnPp)}–${fmt(target + b.warnPp)}%, orange ${fmt(Math.max(0, target - b.criticalPp))}–${fmt(target + b.criticalPp)}%`;
    });
  })();

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

      <div style={S.divider} />

      <Section title="Excluded Done Statuses">
        {statuses.length === 0 ? (
          <div style={S.hint}>No statuses found for this project.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {statuses.filter(s => s.categoryKey === 'done').map(s => {
              const colors = statusStyle(s.categoryKey);
              return (
                <label key={s.name} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={excludedDoneSet.has(s.name)}
                    onChange={() => toggleExcludedDoneStatus(s.name)}
                  />
                  <span>{s.name}</span>
                  <span style={{ ...S.chip, background: colors.bg, color: colors.text }}>{s.categoryKey}</span>
                </label>
              );
            })}
          </div>
        )}
        <div style={S.hint}>
          Jira's own status category can't tell "genuinely completed" apart from "cancelled" or "not needed" — both
          often land in the Done category (e.g. a "Not Required" status). Check any Done-category status here that
          shouldn't count toward Velocity. Applies to both Scrum's and Kanban's Velocity calculation; has no effect
          on Committed.
        </div>
      </Section>

      <div style={S.divider} />

      <Section title="Release Mapping">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={settings.releaseMappingEnabled}
            onChange={e => saveSettings({ releaseMappingEnabled: e.target.checked })}
          />
          Enable Release Mapping
        </label>
        <div style={S.hint}>
          Release mapping will create a mapping between a sprint and a version. A sprint can only be assigned to a
          single release. This is used to determine if capacity available and the items assigned in those sprints
          are within threshold.
        </div>
        {settings.releaseMappingEnabled && (
          <div style={{ marginTop: 10 }}>
            <input
              type="number" min="0" max="100"
              value={settings.releaseThresholdPct}
              onChange={e => setSettings(s => ({ ...s, releaseThresholdPct: e.target.value }))}
              onBlur={e => saveSettings({ releaseThresholdPct: Math.min(100, Math.max(0, Number(e.target.value) || 70)) })}
              style={{ ...S.select, width: 100 }}
            /> % planned-work threshold
            <div style={S.hint}>
              The percentage of a release's capacity that should be planned features, leaving the remainder for
              unplanned work, defects, etc.
            </div>
          </div>
        )}
      </Section>

      <div style={S.divider} />

      <Section title="Portfolio Planning">
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: (portfolioBlockedReason && !portfolioOn) ? 'default' : 'pointer', opacity: (portfolioBlockedReason && !portfolioOn) ? 0.6 : 1 }}>
          <input
            type="checkbox"
            checked={portfolioOn}
            disabled={saving || (!!portfolioBlockedReason && !portfolioOn)}
            onChange={e => saveSettings({ portfolioPlanningEnabled: e.target.checked })}
          />
          Enable Portfolio Planning
        </label>
        {portfolioBlockedReason && !portfolioOn && <div style={S.hint}>{portfolioBlockedReason}</div>}
        <div style={S.hint}>
          Lets you split each release's work across the categories of a select-list field (e.g. Infrastructure,
          Features, Defects) with a target % per category, and compares the story points actually in the release's
          sprints against those targets. Required for this space to appear in the portfolio dashboard gadget.
          Turning it off hides the feature but keeps your allocations.
        </div>
        {portfolioOn && portfolioBlockedReason && (
          <div style={{ ...S.hint, color: 'var(--over-text)' }}>{portfolioBlockedReason} Portfolio data for this space won't be available until that's resolved.</div>
        )}

        {portfolioOn && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Portfolio category field</div>
              <select
                value={pendingField != null ? pendingField : portfolioFieldId}
                disabled={pendingField != null}
                onChange={e => handleFieldChange(e.target.value)}
                style={S.select}
              >
                <option value="">Select a field…</option>
                {portfolioFieldId && !portfolioFields.some(f => f.id === portfolioFieldId) && (
                  <option value={portfolioFieldId}>{portfolioFieldId}</option>
                )}
                {portfolioFields.map(f => <option key={f.id} value={f.id}>{f.name} ({f.id})</option>)}
              </select>
              {pendingField != null && (
                <div style={{ ...S.hint, color: 'var(--text)', marginTop: 6 }}>
                  Changing the field means this space's saved allocations stop applying (they're kept, and come back
                  if you switch back to the original field). Change it?
                  <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                    <button style={S.smallBtn} onClick={() => { const v = pendingField; setPendingField(null); saveSettings({ portfolioFieldId: v }); }}>Change field</button>
                    <button style={S.smallBtn} onClick={() => setPendingField(null)}>Cancel</button>
                  </div>
                </div>
              )}
              <div style={S.hint}>
                A single-select field (select list or radio buttons) whose options are your portfolio categories.
                One field per space; every ticket in the release's sprints is bucketed by its value.
              </div>
              {portfolioFieldId && optionsError && <div style={{ ...S.hint, color: 'var(--over-text)' }}>{optionsError}</div>}
              {portfolioFieldId && !optionsError && portfolioOptions.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {portfolioOptions.map(o => (
                    <span key={o.id} style={{ ...S.chip, background: 'var(--surface-sunken)', color: 'var(--text-subtle)', textDecoration: o.disabled ? 'line-through' : 'none' }}>{o.name}</span>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Allocation thresholds</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center', fontSize: 13 }}>
                <span>
                  Warn at ±{' '}
                  <input type="number" min="0" max="100" value={pf.warn}
                    onChange={e => setPf(p => ({ ...p, warn: e.target.value }))} onBlur={commitThresholds}
                    style={{ ...S.select, width: 70 }} /> %
                </span>
                <span>
                  Critical at ±{' '}
                  <input type="number" min="0" max="100" value={pf.crit}
                    onChange={e => setPf(p => ({ ...p, crit: e.target.value }))} onBlur={commitThresholds}
                    style={{ ...S.select, width: 70 }} /> %
                </span>
                <span>
                  Minimum tolerance{' '}
                  <input type="number" min="0" max="20" step="0.5" value={pf.floor}
                    onChange={e => setPf(p => ({ ...p, floor: e.target.value }))} onBlur={commitThresholds}
                    style={{ ...S.select, width: 70 }} /> pts
                </span>
              </div>
              {pfError && <div style={{ ...S.hint, color: 'var(--over-text)' }}>{pfError}</div>}
              <div style={S.hint}>
                Thresholds are relative to each category's own target: with a 20% target and Warn at ±10%, actual is
                green from 18% to 22%, orange up to the Critical band, and red beyond it. The minimum tolerance is a
                floor in percentage points so small targets don't get impossibly tight bands (0 turns it off). A
                category with a 0% target — including Unassigned tickets — is red as soon as any work lands in it.
              </div>
              {exampleBands && <div style={S.hint}>Example: {exampleBands.join(' · ')}</div>}
            </div>
          </div>
        )}
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
