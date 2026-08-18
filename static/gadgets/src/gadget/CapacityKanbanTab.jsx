import React, { useState } from 'react';
import { invoke } from '@forge/bridge';
import { editStyles as S } from './sprintConfigShared';
import { useCapacityRows } from './useCapacityRows';
import { CapacityTableRow, HideClosedToggle, fmtDate, ReleaseSelectCell, ReleasesSummaryTable } from './CapacityTableShared';
import KanbanIterationDialog from './KanbanIterationDialog';
import { localTodayISO } from './gadgetUtils';

const STATUS_OPTIONS = [
  { value: 'future', label: 'Future' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
];

const COMPLETED_LIMIT_OPTIONS = [3, 5, 10, 15, 'all'];

// Adds `days` to a plain "YYYY-MM-DD" string without ever going through local-
// timezone Date parsing — `new Date(iso + 'T00:00')` + `.toISOString()` looks
// right but round-trips through UTC, which silently rolls the result back a
// day for any timezone ahead of UTC (the same class of bug documented in
// PROJECT-CONTEXT.md for "today" calculations). Date.UTC(...) builds the date
// from the given components directly, so there's no local offset to round-trip.
function addDaysToISODate(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// Start date defaults to the day after the latest existing iteration's end
// date (or today if there are none yet); end date defaults to start + the
// project's configured default iteration length.
function computeNextIterationDefaults(iterations, lengthWeeks, baseCapacitySp) {
  const dated = [...iterations].filter(it => it.endDate).sort((a, b) => (a.endDate < b.endDate ? -1 : 1));
  const latest = dated.length ? dated[dated.length - 1] : null;

  const startISO = latest ? addDaysToISODate(latest.endDate, 1) : localTodayISO();
  const weeks = lengthWeeks || 2;
  const endISO = addDaysToISODate(startISO, weeks * 7);

  return { name: '', description: '', capacitySp: baseCapacitySp, startDate: startISO, endDate: endISO, status: 'future', labelFilter: '' };
}

export default function CapacityKanbanTab({
  projectKey, spFieldId, graceWindowHours, baseCapacitySp, defaultIterationLengthWeeks,
  releaseMappingEnabled, releaseThresholdPct, releaseOptions,
}) {
  const {
    rows, setRows, loading, error, setError, reload,
    committedLoadingIds, velocityLoadingIds,
    handleCapacityChange, handleCommittedChange, handleGetCommitted,
    handleVelocityChange, handleGetVelocity, handleReleaseChange,
  } = useCapacityRows({
    projectKey, spFieldId, graceWindowHours, idField: 'iterationId',
    listResolver: 'getKanbanIterations', listKey: 'iterations',
    getCommittedResolver: 'getIterationCommittedSp', setCommittedResolver: 'setIterationCommittedSp',
    getVelocityResolver: 'getIterationVelocitySp', setVelocityResolver: 'setIterationVelocitySp',
    setCapacityResolver: 'setIterationCapacity', setReleaseResolver: 'setIterationReleaseId',
  });

  const [hideCompleted, setHideCompleted] = useState(true);
  const [completedLimit, setCompletedLimit] = useState(10);
  const [dialog, setDialog] = useState(null); // { mode: 'add'|'edit', initial, iterationId? }
  const [dialogSaving, setDialogSaving] = useState(false);
  const [dialogError, setDialogError] = useState(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState(null);
  const [statusErrorId, setStatusErrorId] = useState(null);

  // Kanban iterations are all fetched in one KVS blob (no server-side pagination
  // like Scrum's sprint fetch), so limiting "how many completed to show" is just
  // a client-side slice — most-recent-first, same convention as Scrum's closed
  // sprint sort — rather than a resolver parameter.
  const visibleRows = (() => {
    const notCompleted = rows.filter(it => it.status !== 'completed');
    if (hideCompleted) return notCompleted;
    const completed = rows
      .filter(it => it.status === 'completed')
      .sort((a, b) => Date.parse(b.endDate || b.startDate || 0) - Date.parse(a.endDate || a.startDate || 0));
    const limited = completedLimit === 'all' ? completed : completed.slice(0, completedLimit);
    return [...notCompleted, ...limited];
  })();

  const openAdd = () => {
    setDialogError(null);
    setDialog({ mode: 'add', initial: computeNextIterationDefaults(rows, defaultIterationLengthWeeks, baseCapacitySp) });
  };

  const openEdit = (iteration) => {
    setDialogError(null);
    setDialog({ mode: 'edit', initial: iteration, iterationId: iteration.id });
  };

  const handleSaveDialog = async (values) => {
    setDialogSaving(true);
    setDialogError(null);
    try {
      const iteration = dialog.mode === 'edit' ? { ...values, id: dialog.iterationId } : values;
      const res = await invoke('saveKanbanIteration', { projectKey, iteration });
      if (res.error) { setDialogError(res.error); return; }
      setRows(res.iterations);
      setDialog(null);
    } finally {
      setDialogSaving(false);
    }
  };

  const handleDelete = async (iterationId) => {
    const res = await invoke('deleteKanbanIteration', { projectKey, iterationId });
    if (res.error) setError(res.error);
    else setRows(res.iterations);
    setConfirmingDeleteId(null);
  };

  const handleStatusChange = async (iterationId, status) => {
    const prevRows = rows;
    setRows(prev => prev.map(it => it.id === iterationId ? { ...it, status } : it));
    setStatusErrorId(null);
    const res = await invoke('setKanbanIterationStatus', { projectKey, iterationId, status });
    if (res.error) {
      setRows(prevRows); // revert — blocked by the single-active-iteration rule
      setStatusErrorId(iterationId);
      setError(res.error);
    } else {
      setRows(res.iterations);
    }
  };

  if (loading) {
    return <div style={{ padding: 20, fontSize: 13, color: 'var(--text-subtle)' }}>Loading iterations…</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error && <div style={S.error}>{error}</div>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <button onClick={openAdd} style={S.btn}>+ Add Iteration</button>
        <HideClosedToggle checked={hideCompleted} onChange={setHideCompleted} label="Hide completed iterations" />
        {!hideCompleted && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-subtle)' }}>
            Show:
            <select value={completedLimit} onChange={e => setCompletedLimit(e.target.value === 'all' ? 'all' : Number(e.target.value))} style={{ ...S.select, width: 'auto' }}>
              {COMPLETED_LIMIT_OPTIONS.map(opt => (
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
            <th style={S.th}>Iteration</th>
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
            <tr><td style={S.td} colSpan={releaseMappingEnabled ? 7 : 6}>No iterations yet — click "+ Add Iteration" to create one.</td></tr>
          ) : visibleRows.map(it => (
            <CapacityTableRow
              key={it.id}
              name={it.name}
              dateRangeText={`${fmtDate(it.startDate)} – ${fmtDate(it.endDate)}`}
              baseCapacitySp={baseCapacitySp}
              capacitySp={it.capacitySp}
              committedSp={it.committedSp}
              velocitySp={it.velocitySp}
              velocityEditable={it.status === 'completed'}
              committedLoading={committedLoadingIds.has(it.id)}
              velocityLoading={velocityLoadingIds.has(it.id)}
              onCapacityChange={v => handleCapacityChange(it.id, v)}
              onCommittedChange={v => handleCommittedChange(it.id, v)}
              onGetCommitted={() => handleGetCommitted(it.id)}
              onVelocityChange={v => handleVelocityChange(it.id, v)}
              onGetVelocity={() => handleGetVelocity(it.id)}
              releaseSlot={releaseMappingEnabled ? (
                <ReleaseSelectCell
                  releaseId={it.releaseId}
                  releaseOptions={releaseOptions}
                  readOnly={it.status === 'completed'}
                  onChange={v => handleReleaseChange(it.id, v)}
                />
              ) : undefined}
              statusSlot={
                <div>
                  <select value={it.status} onChange={e => handleStatusChange(it.id, e.target.value)} style={{ ...S.select, width: 130 }}>
                    {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  {statusErrorId === it.id && <div style={{ fontSize: 10, color: 'var(--over-text)', marginTop: 2 }}>Blocked — see message above.</div>}
                </div>
              }
              actionsSlot={
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button onClick={() => openEdit(it)} style={S.smallBtn}>Edit</button>
                  {confirmingDeleteId === it.id ? (
                    <button onClick={() => handleDelete(it.id)} style={S.dangerBtn}>Confirm delete?</button>
                  ) : (
                    <button onClick={() => setConfirmingDeleteId(it.id)} style={S.dangerBtn}>Delete</button>
                  )}
                </div>
              }
            />
          ))}
        </tbody>
      </table>

      {dialog && (
        <KanbanIterationDialog
          mode={dialog.mode}
          initial={dialog.initial}
          saving={dialogSaving}
          error={dialogError}
          onSave={handleSaveDialog}
          onCancel={() => setDialog(null)}
        />
      )}
    </div>
  );
}
