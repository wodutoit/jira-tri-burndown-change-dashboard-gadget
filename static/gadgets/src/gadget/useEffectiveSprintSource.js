import { useState, useEffect } from 'react';
import { invoke } from '@forge/bridge';
import { useDashboardFilter } from './useDashboardFilter';
import { DEFAULT_PHASE_MAP } from './sprintConfigShared';

// Resolves the Space/Sprint/Status-Mapping a gadget should actually render
// with:
// - If config.useDashboardFilter is off (the default), always use the
//   gadget's own saved config — behavior is unchanged from before this
//   feature existed.
// - If on, and a TRI Sprint Filter gadget has set a value on this dashboard,
//   override projectKey/sprintMode/sprintId with the filter's value.
// - Status Mapping is tied to a specific project's actual status names, so it
//   can't just follow the filter blindly: if the filter's Space matches what
//   this gadget's mapping was configured against, the saved mapping is kept.
//   If the filter points at a different Space, that mapping's keys won't
//   match anything real, so a default guess mapping is fetched instead (the
//   same heuristic used the first time you pick a Space in edit mode) and
//   `usingDefaultMapping` is set so the view can flag it.
// - If the toggle is on but no filter gadget exists on this dashboard yet,
//   falls back to the gadget's own configured Space/Sprint.
export function useEffectiveSprintSource(config) {
  const useFilter = !!config?.useDashboardFilter;
  const { filter, filterLoading } = useDashboardFilter(useFilter);

  const filterActive = useFilter && !!filter;
  const mappingMatchesSpace = !filterActive || filter.projectKey === config?.projectKey;

  const [fallbackMapping, setFallbackMapping] = useState(null);
  const [fallbackLoading, setFallbackLoading] = useState(false);

  useEffect(() => {
    if (!filterActive || mappingMatchesSpace) {
      setFallbackMapping(null);
      return;
    }
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
  }, [filterActive, mappingMatchesSpace, filter?.projectKey]);

  const ready = !filterLoading && (mappingMatchesSpace || !fallbackLoading);
  if (!ready) return { ready: false };

  return {
    ready: true,
    projectKey:          filterActive ? filter.projectKey : config?.projectKey,
    sprintMode:          filterActive ? filter.sprintMode : (config?.sprintMode ?? 'active'),
    sprintId:            filterActive ? filter.sprintId   : (config?.sprintId ?? null),
    statusMapping:       filterActive && !mappingMatchesSpace ? (fallbackMapping ?? {}) : config?.statusMapping,
    usingFilter:         filterActive,
    usingDefaultMapping: filterActive && !mappingMatchesSpace,
    filterSprintName:    filterActive ? filter.sprintName : null,
  };
}
