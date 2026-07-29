import React, { useState, useEffect } from 'react';
import { invoke, view } from '@forge/bridge';
import { editStyles as S } from './sprintConfigShared';
import CapacityScrumTab from './CapacityScrumTab';
import CapacityKanbanTab from './CapacityKanbanTab';

// jira:projectPage — the actual "Capacity" tab, gated by manifest.yml's
// displayConditions.entityPropertyEqualTo so Jira only shows this tab for
// projects with the setting turned on (see TriCapacitySettingsPage.jsx).
// Branches on the project's board type (Scrum sprints vs Kanban iterations —
// see PROJECT-CONTEXT.md) once loaded.
export default function TriCapacityPage() {
  const [project, setProject] = useState(null);
  const [boardType, setBoardType] = useState(null);
  const [boardId, setBoardId] = useState(null);
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    view.theme.enable().catch(() => {});
    view.getContext().then(async ctx => {
      const proj = ctx?.extension?.project ?? null;
      setProject(proj);
      if (!proj?.key) { setError('No project context.'); return; }

      const [boardRes, settingsRes] = await Promise.all([
        invoke('getCapacityBoardInfo', { projectKey: proj.key }),
        invoke('getCapacitySettings', { projectKey: proj.key }),
      ]);
      if (boardRes.error) { setError(boardRes.error); return; }
      setBoardType(boardRes.boardType);
      setBoardId(boardRes.boardId);
      setSettings(settingsRes.settings);
    }).catch(e => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div style={{ padding: 20, fontSize: 13, fontFamily: 'inherit', color: 'var(--text-subtle)' }}>Loading…</div>;
  }

  return (
    <div style={{ ...S.wrap, maxWidth: 1100 }}>
      <h2 style={{ margin: 0, fontSize: 16, color: 'var(--text)' }}>Capacity</h2>

      {error && <div style={S.error}>{error}</div>}

      {!error && !settings?.spFieldId && (
        <div style={S.notice}>
          No Story Points field configured yet — set one on this project's <strong>Capacity Planning</strong> settings
          page before using Committed/Velocity here.
        </div>
      )}

      {!error && project && settings && (
        boardType === 'kanban' ? (
          <CapacityKanbanTab
            projectKey={project.key}
            spFieldId={settings.spFieldId}
            graceWindowHours={settings.graceWindowHours}
            baseCapacitySp={settings.baseCapacitySp}
            defaultIterationLengthWeeks={settings.defaultIterationLengthWeeks}
          />
        ) : (
          <CapacityScrumTab
            projectKey={project.key}
            boardId={boardId}
            spFieldId={settings.spFieldId}
            graceWindowHours={settings.graceWindowHours}
            baseCapacitySp={settings.baseCapacitySp}
          />
        )
      )}
    </div>
  );
}
