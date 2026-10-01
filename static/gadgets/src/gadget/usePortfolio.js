import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@forge/bridge';

// Loads everything the Capacity page needs for Portfolio Planning on one Scrum
// space: saved allocations (all releases, one call), the field's current options,
// and live actuals for just the releases currently shown. Does nothing unless
// `enabled`, so spaces without the feature pay no cost.
export function usePortfolio({ projectKey, enabled, releaseIds }) {
  const [allocations, setAllocations] = useState({});
  const [options, setOptions] = useState([]);
  const [optionsLoaded, setOptionsLoaded] = useState(false);
  const [optionsError, setOptionsError] = useState(null);
  const [actuals, setActuals] = useState({});
  const [actualsLoading, setActualsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [fieldId, setFieldId] = useState(null);

  // Stable dependency for the release list (a new array each render would refetch).
  const releaseKey = [...new Set(releaseIds)].filter(Boolean).sort().join(',');

  const loadAllocations = useCallback(async () => {
    const res = await invoke('getPortfolioAllocations', { projectKey });
    if (res.error) { setError(res.error); return; }
    setAllocations(res.releases ?? {});
    setFieldId(res.fieldId ?? null);
  }, [projectKey]);

  useEffect(() => {
    if (!enabled || !projectKey) return;
    loadAllocations().catch(e => setError(String(e)));
  }, [enabled, projectKey, loadAllocations]);

  useEffect(() => {
    if (!enabled || !projectKey || !fieldId) return;
    let ignore = false;
    invoke('getPortfolioFieldOptions', { projectKey, fieldId }).then(res => {
      if (ignore) return;
      setOptions(res.options ?? []);
      setOptionsLoaded(!res.error);
      setOptionsError(res.error ?? null);
    }).catch(e => { if (!ignore) { setOptionsLoaded(false); setOptionsError(String(e)); } });
    return () => { ignore = true; };
  }, [enabled, projectKey, fieldId]);

  const loadActuals = useCallback(async (forceRefresh = false) => {
    if (!releaseKey) { setActuals({}); return; }
    setActualsLoading(true);
    try {
      const res = await invoke('getPortfolioActuals', { projectKey, releaseIds: releaseKey.split(','), forceRefresh });
      if (res.error) { setError(res.error); return; }
      setActuals(res.releases ?? {});
    } finally {
      setActualsLoading(false);
    }
  }, [projectKey, releaseKey]);

  useEffect(() => {
    if (!enabled || !projectKey) return;
    // A stale response must not overwrite a newer one (release list can change
    // while a slow actuals call is still in flight).
    let ignore = false;
    setActualsLoading(true);
    invoke('getPortfolioActuals', { projectKey, releaseIds: releaseKey ? releaseKey.split(',') : [] })
      .then(res => {
        if (ignore) return;
        if (res.error) setError(res.error); else setActuals(res.releases ?? {});
      })
      .catch(e => { if (!ignore) setError(String(e)); })
      .finally(() => { if (!ignore) setActualsLoading(false); });
    return () => { ignore = true; };
  }, [enabled, projectKey, releaseKey]);

  // Saves one release. `expectedUpdatedAt` is what the editor loaded; a conflict
  // reloads the stored allocations so the dialog reopens on the other person's
  // version instead of silently overwriting it.
  const save = useCallback(async (releaseId, alloc, names, expectedUpdatedAt) => {
    const res = await invoke('setPortfolioAllocation', { projectKey, releaseId, alloc, names, expectedUpdatedAt: expectedUpdatedAt ?? null });
    if (res.conflict) await loadAllocations();
    else if (res.ok) {
      setAllocations(cur => {
        const next = { ...cur };
        if (res.allocation) next[releaseId] = res.allocation; else delete next[releaseId];
        return next;
      });
    }
    return res;
  }, [projectKey, loadAllocations]);

  return {
    allocations, options, optionsLoaded, optionsError,
    actuals, actualsLoading, error,
    save, refreshActuals: () => loadActuals(true),
  };
}
