import { useState, useEffect } from 'react';
import { invoke, events } from '@forge/bridge';

export const DASHBOARD_RELEASE_FILTER_EVENT = 'tri-release-filter-changed';

// Release counterpart of useDashboardFilter: reads the dashboard-level Release
// selection (set by a TRI Release Filter gadget on this dashboard) from
// storage on mount, then follows live updates via the Custom UI events bridge.
// Returns { filter: null, filterLoading: false } when disabled or when no
// filter gadget has ever set a value — callers fall back to their own
// configured release. filter.releaseName === null means "Auto".
export function useDashboardReleaseFilter(enabled) {
  const [filter, setFilter] = useState(null);
  const [filterLoading, setFilterLoading] = useState(!!enabled);

  useEffect(() => {
    if (!enabled) {
      setFilter(null);
      setFilterLoading(false);
      return;
    }

    let live = true;
    setFilterLoading(true);

    invoke('getDashboardReleaseFilter')
      .then(res => { if (live) setFilter(res?.filter ?? null); })
      .catch(() => {})
      .finally(() => { if (live) setFilterLoading(false); });

    let subscription;
    events.on(DASHBOARD_RELEASE_FILTER_EVENT, payload => {
      if (live) setFilter(payload ?? null);
    }).then(sub => {
      subscription = sub;
      if (!live) subscription?.unsubscribe?.();
    });

    return () => {
      live = false;
      subscription?.unsubscribe?.();
    };
  }, [enabled]);

  return { filter, filterLoading };
}
