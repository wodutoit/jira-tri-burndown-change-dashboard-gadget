import { useState, useEffect } from 'react';
import { invoke, events } from '@forge/bridge';

export const DASHBOARD_FILTER_EVENT = 'tri-sprint-filter-changed';

// Reads the current dashboard-level Space/Sprint filter (set by a TRI Sprint
// Filter gadget elsewhere on this dashboard) and keeps it live-updated via
// the Custom UI events bridge while the dashboard stays open. The events
// bridge is purely in-page and not persisted — storage is the durable
// fallback for gadgets that mount before/after the filter gadget, or after a
// page reload, so they still pick up the current selection on first load.
// Returns { filter: null, filterLoading: false } when disabled, or when no
// filter gadget has ever set a value on this dashboard — callers should fall
// back to their own configured Space/Sprint in that case.
export function useDashboardFilter(enabled) {
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

    invoke('getDashboardSprintFilter')
      .then(res => { if (live) setFilter(res?.filter ?? null); })
      .catch(() => {})
      .finally(() => { if (live) setFilterLoading(false); });

    let subscription;
    events.on(DASHBOARD_FILTER_EVENT, payload => {
      if (live) setFilter(payload ?? null);
    }).then(sub => { subscription = sub; });

    return () => {
      live = false;
      subscription?.unsubscribe?.();
    };
  }, [enabled]);

  return { filter, filterLoading };
}
