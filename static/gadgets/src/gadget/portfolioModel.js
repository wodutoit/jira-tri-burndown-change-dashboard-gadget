import { classifyPortfolioShare } from './gadgetUtils.js';

export const UNASSIGNED_ID = '__unassigned';

// Joins the three things the Capacity page knows about one release's portfolio
// — Jira's CURRENT options, the saved allocation, and the live actuals — into
// one list of rows shared by the allocation bar and the allocation popup.
//
//  options    [{ id, name, disabled }] from the field (Jira order); only trusted
//             when `optionsLoaded` (listing needs Create Issue permission, so it
//             can fail — then no option is flagged new/removed and names come
//             from the saved snapshot / actuals instead)
//  allocation { alloc, names, updatedAt } | null   (names = every option known at last save)
//  actuals    { totalSp, categories: {id: {name, sp}}, unassigned: {sp} } | null
//  historical true for an already-released version: its allocation is a snapshot,
//             so new/removed-option flags are suppressed
//  thresholds { warnPct, criticalPct, minTolerancePp }
//
// status per row: 'ok' | 'warn' | 'critical', or 'none' when there's nothing to
// compare against yet (no actuals, or a release with no tickets).
export function buildPortfolioRows({ options = [], optionsLoaded = false, allocation = null, actuals = null, historical = false, thresholds }) {
  const alloc = allocation?.alloc ?? {};
  const known = allocation?.names ?? {};
  const hasSaved = !!allocation;
  const totalSp = actuals?.totalSp ?? 0;
  const hasActuals = !!actuals && totalSp > 0;
  const optionById = new Map(options.map(o => [o.id, o]));

  const statusFor = (actualPct, target) => (hasActuals
    ? classifyPortfolioShare(actualPct, target, thresholds.warnPct, thresholds.criticalPct, thresholds.minTolerancePp)
    : 'none');
  const pctOf = (sp) => (hasActuals ? (sp / totalSp) * 100 : null);

  // Jira's order first, then anything allocated or carried by tickets that Jira
  // no longer lists (removed/disabled options still holding data).
  const ids = [...options.map(o => o.id)];
  for (const id of [...Object.keys(alloc), ...Object.keys(actuals?.categories ?? {})]) {
    if (!ids.includes(id)) ids.push(id);
  }

  const rows = ids.map(id => {
    const opt = optionById.get(id);
    const target = alloc[id] ?? 0;
    const actualSp = actuals?.categories?.[id]?.sp ?? 0;
    const actualPct = pctOf(actualSp);
    const inJira = !!opt;
    return {
      id,
      name: opt?.name ?? known[id] ?? actuals?.categories?.[id]?.name ?? id,
      disabled: !!opt?.disabled,
      target, actualSp, actualPct,
      status: statusFor(actualPct, target),
      // Not listed by Jira any more (but allocated, or still on tickets).
      removed: optionsLoaded && !inJira && !historical,
      // Listed by Jira but unknown to the last save of an existing allocation.
      isNew: optionsLoaded && inJira && hasSaved && !(id in known) && !historical,
    };
  });

  const unassignedSp = actuals?.unassigned?.sp ?? 0;
  const unassignedPct = pctOf(unassignedSp);
  const allocatedTotal = Math.round(Object.values(alloc).reduce((a, n) => a + n, 0) * 10) / 10;

  return {
    rows,
    unassigned: {
      id: UNASSIGNED_ID, name: 'Unassigned', target: 0,
      actualSp: unassignedSp, actualPct: unassignedPct,
      // Target is always 0, so any unassigned work is critical (red).
      status: unassignedSp > 0 ? statusFor(unassignedPct, 0) : 'none',
    },
    allocatedTotal,
    unallocatedPct: Math.max(0, Math.round((100 - allocatedTotal) * 10) / 10),
    hasSaved, hasActuals, totalSp,
    unestimatedCount: actuals?.unestimatedCount ?? 0,
    sprintCount: actuals?.sprintCount ?? 0,
    newCount: rows.filter(r => r.isNew).length,
    removedCount: rows.filter(r => r.removed && (r.target > 0 || r.actualSp > 0)).length,
  };
}

export const STATUS_WORD = { ok: 'Within threshold', warn: 'Outside warn threshold', critical: 'Outside critical threshold', none: 'No data yet' };

export function fmtPct(n) {
  return n == null ? '—' : `${Math.round(n * 10) / 10}%`;
}

// Multi-line text for a native tooltip on one allocation row.
export function rowTooltip(row, totalSp) {
  const lines = [row.name + (row.removed ? ' (no longer in Jira)' : '')];
  lines.push(`Target: ${fmtPct(row.target)}`);
  lines.push(row.actualPct == null
    ? 'Actual: no data yet'
    : `Actual: ${fmtPct(row.actualPct)} (${row.actualSp} of ${totalSp} SP)`);
  lines.push(`Status: ${STATUS_WORD[row.status]}`);
  return lines.join('\n');
}
