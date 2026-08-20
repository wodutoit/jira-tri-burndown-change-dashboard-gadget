import React, { useState } from 'react';
import { invoke, router } from '@forge/bridge';
import { editStyles as S } from './sprintConfigShared';
import { useCapacityRows } from './useCapacityRows';
import { CapacityTableRow, StatusChip, HideClosedToggle, fmtDate, ReleaseSelectCell, ReleasesSummaryTable } from './CapacityTableShared';
import ScrumSprintEditDialog from './ScrumSprintEditDialog';

const CLOSED_LIMIT_OPTIONS = [3, 5, 10, 15, 'all'];

export default function CapacityScrumTab({
  projectKey, boardId, spFieldId, graceWindowHours, baseCapacitySp,
  releaseMappingEnabled, releaseThresholdPct, releaseOptions,
}) {
  const [closedLimit, setClosedLimit] = useState(10);

  const {
    rows, loading, error, reload,
    committedLoadingIds, velocityLoadingIds,
    handleCapacityChange, handleCommittedChange, handleGetCommitted,
    handleVelocityChange, handleGetVelocity, handleReleaseChange,
  } = useCapacityRows({
    projectKey, spFieldId, graceWindowHours, idField: 'sprintId',
    listResolver: 'getScrumSprintsForCapacity', listKey: 'sprints', listParams: { closedLimit },
    getCommittedResolver: 'getSprintCommittedSp', setCommittedResolver: 'setSprintCommittedSp',
    getVelocityResolver: 'getSprintVelocitySp', setVelocityResolver: 'setSprintVelocitySp',
    setCapacityResolver: 'setSprintCapacityOverride', setReleaseResolver: 'setSprintReleaseId',
  });

  const [hideClosed, setHideClosed] = useState(true);
  const [editingSprint, setEditingSprint] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState(null);

  const visibleRows = rows.filter(s => s.state !== 'closed' || !hideClosed);

  const handleSaveEdit = async ({ goal, startDate, endDate }) => {
    setEditSaving(true);
    setEditError(null);
    try {
      const res = await invoke('updateSprintGoalAndDates', { sprintId: editingSprint.id, goal, startDate, endDate });
      if (res.error) { setEditError(res.error); return; }
      setEditingSprint(null);
      reload();
    } finally {
      setEditSaving(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 20, fontSize: 13, color: 'var(--text-subtle)' }}>Loading sprints…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error && <div style={S.error}>{error}</div>}

      <div style={S.notice}>
        Use the <strong>Backlog</strong> tab to add, remove, start, or complete sprints — this table can only edit an
        existing sprint's goal, dates, and capacity numbers.{' '}
        {boardId && (
          <button
            onClick={() => router.open(`/jira/software/projects/${projectKey}/boards/${boardId}/backlog`)}
            style={{ background: 'none', border: 'none', padding: 0, color: 'var(--brand)', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit', fontSize: 12 }}
          >
            Open Backlog →
          </button>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <HideClosedToggle checked={hideClosed} onChange={setHideClosed} label="Hide closed sprints" />
        {!hideClosed && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-subtle)' }}>
            Show:
            <select value={closedLimit} onChange={e => setClosedLimit(e.target.value === 'all' ? 'all' : Number(e.target.value))} style={{ ...S.select, width: 'auto' }}>
              {CLOSED_LIMIT_OPTIONS.map(opt => (
                <option key={opt} value={opt}>{opt === 'all' ? 'All' : opt}</option>
              ))}
            </select>
          </label>
        )}
      </div>

      {releaseMappingEnabled && (
        <ReleasesSummaryTable
          rows={visibleRows}
          releaseOptions={releaseOptions}
          baseCapacitySp={baseCapacitySp}
          thresholdPct={releaseThresholdPct}
        />
      )}

      <table style={S.table}>
        <thead>
          <tr>
            <th style={S.th}>Sprint</th>
            <th style={S.th}>Capacity</th>
            <th style={S.th}>Committed</th>
            <th style={S.th}>Velocity</th>
            <th style={S.th}>Status</th>
            {releaseMappingEnabled && <th style={S.th}>Release</th>}
            <th style={{ ...S.th, textAlign: 'right' }}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.length === 0 ? (
            <tr><td style={S.td} colSpan={releaseMappingEnabled ? 7 : 6}>No sprints to show.</td></tr>
          ) : visibleRows.map(sprint => (
            <CapacityTableRow
              key={sprint.id}
              name={sprint.name}
              dateRangeText={sprint.startDate && sprint.endDate ? `${fmtDate(sprint.startDate)} – ${fmtDate(sprint.endDate)}` : ''}
              baseCapacitySp={baseCapacitySp}
              capacitySp={sprint.capacitySp}
              committedSp={sprint.committedSp}
              velocitySp={sprint.velocitySp}
              velocityEditable={sprint.state === 'closed'}
              committedLoading={committedLoadingIds.has(sprint.id)}
              velocityLoading={velocityLoadingIds.has(sprint.id)}
              onCapacityChange={v => handleCapacityChange(sprint.id, v)}
              onCommittedChange={v => handleCommittedChange(sprint.id, v)}
              onGetCommitted={() => handleGetCommitted(sprint.id)}
              onVelocityChange={v => handleVelocityChange(sprint.id, v)}
              onGetVelocity={() => handleGetVelocity(sprint.id)}
              statusSlot={<StatusChip state={sprint.state} />}
              releaseSlot={releaseMappingEnabled ? (
                <ReleaseSelectCell
                  releaseId={sprint.releaseId}
                  releaseOptions={releaseOptions}
                  onChange={v => handleReleaseChange(sprint.id, v)}
                />
              ) : undefined}
              actionsSlot={
                <button onClick={() => { setEditingSprint(sprint); setEditError(null); }} style={S.smallBtn}>Edit</button>
              }
            />
          ))}
        </tbody>
      </table>

      {editingSprint && (
        <ScrumSprintEditDialog
          sprint={editingSprint}
          saving={editSaving}
          error={editError}
          onSave={handleSaveEdit}
          onCancel={() => setEditingSprint(null)}
        />
      )}
    </div>
  );
}
