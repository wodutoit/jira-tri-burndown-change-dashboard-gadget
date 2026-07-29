import { useDashboardFilter } from './useDashboardFilter';

// Single-space configs only: if config.useDashboardFilter is on, the filter's
// Space overrides the one configured space. The filter's Sprint is always
// ignored — this gadget trends across a space's closed sprints/completed
// iterations, there's no single sprint to pin it to. Multi-space configs
// never follow the filter, since there'd be no single space to point it at.
//
// Unlike the other gadgets, there's no per-gadget Story Points field or
// Status Mapping to fall back to anymore — TRI Velocity reads whichever
// space's own Capacity data (see getVelocityData in src/index.js), so
// overriding to a different space just means reading that space's Capacity
// numbers instead, with no config drift to reconcile.
export function useVelocityEffectiveSpaces(config) {
  const spaces = config?.spaces ?? [];
  const configuredSpace = spaces.length === 1 ? spaces[0] : null;
  const useFilter = !!config?.useDashboardFilter && !!configuredSpace;
  const { filter, filterLoading } = useDashboardFilter(useFilter);

  if (filterLoading) return { ready: false };

  const filterEngaged = useFilter && !!filter;
  if (!filterEngaged) {
    return { ready: true, spaces, usingFilter: false };
  }

  return { ready: true, spaces: [{ projectKey: filter.projectKey }], usingFilter: true };
}
