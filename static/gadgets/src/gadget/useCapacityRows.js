import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@forge/bridge';

// Shared loading/inline-edit-save logic for the Capacity table, parameterized
// by resolver names and the payload id field ('sprintId' for Scrum,
// 'iterationId' for Kanban) so CapacityScrumTab and CapacityKanbanTab reuse
// one implementation instead of duplicating it — same "one hook, composed by
// multiple screens" convention as useSprintSourceConfig.js.
export function useCapacityRows({
  projectKey, spFieldId, graceWindowHours, idField,
  listResolver, listKey, listParams = {},
  getCommittedResolver, setCommittedResolver,
  getVelocityResolver, setVelocityResolver,
  setCapacityResolver, setReleaseResolver,
}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [committedLoadingIds, setCommittedLoadingIds] = useState(new Set());
  const [velocityLoadingIds, setVelocityLoadingIds] = useState(new Set());

  const listParamsKey = JSON.stringify(listParams);

  const load = useCallback(() => {
    if (!projectKey) return;
    setLoading(true);
    invoke(listResolver, { projectKey, ...listParams }).then(res => {
      if (res.error) setError(res.error);
      setRows(res[listKey] || []);
    }).catch(e => setError(String(e.message || e))).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectKey, listResolver, listKey, listParamsKey]);

  useEffect(() => { load(); }, [load]);

  const patchRow = (id, patch) => setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));

  const handleCapacityChange = async (id, capacitySp) => {
    patchRow(id, { capacitySp });
    await invoke(setCapacityResolver, { projectKey, [idField]: id, capacitySp });
  };

  const handleReleaseChange = async (id, releaseId) => {
    patchRow(id, { releaseId });
    await invoke(setReleaseResolver, { projectKey, [idField]: id, releaseId });
  };

  const handleCommittedChange = async (id, committedSp) => {
    patchRow(id, { committedSp });
    await invoke(setCommittedResolver, { projectKey, [idField]: id, committedSp });
  };

  const handleGetCommitted = async (id) => {
    setCommittedLoadingIds(prev => new Set([...prev, id]));
    try {
      const res = await invoke(getCommittedResolver, { projectKey, [idField]: id, spFieldId, graceWindowHours });
      if (res.error) { setError(res.error); return res; }
      patchRow(id, { committedSp: res.committedSp, committedAt: new Date().toISOString() });
      return res;
    } finally {
      setCommittedLoadingIds(prev => { const n = new Set(prev); n.delete(id); return n; });
    }
  };

  const handleVelocityChange = async (id, velocitySp) => {
    patchRow(id, { velocitySp });
    return invoke(setVelocityResolver, { projectKey, [idField]: id, velocitySp });
  };

  const handleGetVelocity = async (id) => {
    setVelocityLoadingIds(prev => new Set([...prev, id]));
    try {
      const res = await invoke(getVelocityResolver, { projectKey, [idField]: id, spFieldId });
      if (res.error) { setError(res.error); return res; }
      patchRow(id, { velocitySp: res.velocitySp, velocityAt: new Date().toISOString() });
      return res;
    } finally {
      setVelocityLoadingIds(prev => { const n = new Set(prev); n.delete(id); return n; });
    }
  };

  return {
    rows, setRows, loading, error, setError, reload: load,
    committedLoadingIds, velocityLoadingIds,
    handleCapacityChange, handleCommittedChange, handleGetCommitted,
    handleVelocityChange, handleGetVelocity, handleReleaseChange,
  };
}
