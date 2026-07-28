import { useState, useEffect } from 'react';
import { invoke } from '@forge/bridge';
import { useDashboardFilter } from './useDashboardFilter';
import { DEFAULT_PHASE_MAP } from './sprintConfigShared';

// Single-space configs only: if config.useDashboardFilter is on, the filter's
// Space overrides the one configured space. The filter's Sprint is always
// ignored — this gadget trends across a space's closed sprints, there's no
// single sprint to pin it to. Multi-space configs never follow the filter,
// since there'd be no single space to point it at.
//
// Story Points Field has no per-space default to fall back to, so the
// overridden space keeps reusing whatever field was configured for the
// original space. Status Mapping is keyed by status names, so — same
// tradeoff as useEffectiveSprintSource — a best-guess mapping is fetched
// when the filter's space differs from the one configured here.
export function useVelocityEffectiveSpaces(config) {
  const spaces = config?.spaces ?? [];
  const configuredSpace = spaces.length === 1 ? spaces[0] : null;
  const useFilter = !!config?.useDashboardFilter && !!configuredSpace;
  const { filter, filterLoading } = useDashboardFilter(useFilter);

  const filterEngaged   = useFilter && !!filter;
  const spaceOverridden = filterEngaged && filter.projectKey !== configuredSpace?.projectKey;

  const [fallbackMapping, setFallbackMapping] = useState(null);
  const [fallbackLoading, setFallbackLoading] = useState(false);

  useEffect(() => {
    if (!spaceOverridden) { setFallbackMapping(null); return; }
    let live = true;
    setFallbackLoading(true);
    invoke('getProjectStatuses', { projectKey: filter.projectKey })
      .then(res => {
        if (!live) return;
        const mapping = {};
        for (const s of (res?.statuses ?? [])) mapping[s.name] = DEFAULT_PHASE_MAP[s.name] ?? 'backlog';
        setFallbackMapping(mapping);
      })
      .catch(() => {})
      .finally(() => { if (live) setFallbackLoading(false); });
    return () => { live = false; };
  }, [spaceOverridden, filter?.projectKey]);

  const ready = !filterLoading && (!spaceOverridden || !fallbackLoading);
  if (!ready) return { ready: false };

  if (!spaceOverridden) {
    return { ready: true, spaces, usingFilter: filterEngaged, usingDefaultMapping: false };
  }

  return {
    ready: true,
    spaces: [{
      projectKey: filter.projectKey,
      spFieldId: configuredSpace?.spFieldId,
      statusMapping: fallbackMapping ?? {},
    }],
    usingFilter: true,
    usingDefaultMapping: true,
  };
}
