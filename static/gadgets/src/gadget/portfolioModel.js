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
export function buildPortfolioRows({ options = [], optionsLoaded = false, allocation = null, isDefault = false, actuals = null, historical = false, thresholds }) {
  const alloc = allocation?.alloc ?? {};
  const known = allocation?.names ?? {};
  const hasSaved = !!allocation;
  const totalSp = actuals?.totalSp ?? 0;
  const hasActuals = !!actuals && totalSp > 0;
  const optionById = new Map(options.map(o => [o.id, o]));

  // Committed basis: a category's target is its % of the release's Total
  // Capacity (e.g. 20% of 360 = 72 SP) and is judged on committed SP against
  // that — so Capacity directly drives the colours. Percent labels still show
  // each category's share of Total Committed. The live ('current') basis and a
  // release with no capacity keep the old share-of-total comparison.
  const totalCapacity = actuals?.totalCapacity ?? 0;
  const capacityBased = actuals?.basis === 'committed' && totalCapacity > 0;
  const targetSpOf = (target) => (capacityBased ? Math.round((target / 100) * totalCapacity * 10) / 10 : null);

  const classify = (actualPct, target) => classifyPortfolioShare(actualPct, target, thresholds.warnPct, thresholds.criticalPct, thresholds.minTolerancePp);
  const judgedPct = (actualSp, actualPct) => (capacityBased ? (actualSp / totalCapacity) * 100 : actualPct);
  // With no allocation at all there's no target to measure a category against,
  // so it isn't judged (rather than every category reading as "off target").
  // Unassigned is the exception: its target is always 0, allocation or not.
  const statusFor = (actualSp, actualPct, target) => (hasActuals && hasSaved ? classify(judgedPct(actualSp, actualPct), target) : 'none');
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
      target, targetSp: targetSpOf(target), actualSp, actualPct,
      status: statusFor(actualSp, actualPct, target),
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
      status: unassignedSp > 0 && hasActuals ? classify(judgedPct(unassignedSp, unassignedPct), 0) : 'none',
    },
    allocatedTotal,
    unallocatedPct: Math.max(0, Math.round((100 - allocatedTotal) * 10) / 10),
    hasSaved, hasActuals, totalSp, totalCapacity, capacityBased,
    basis: actuals?.basis ?? 'current',
    // Sprints with committed SP but no saved category split (shown as Unassigned).
    sprintsMissingSplit: actuals?.sprintsMissingSplit ?? 0,
    // Sprints whose Committed SP was never counted (still add capacity to the target).
    sprintsNotCounted: actuals?.sprintsNotCounted ?? 0,
    // True when the allocation shown is the space default rather than this release's own.
    isDefault: hasSaved && isDefault,
    unestimatedCount: actuals?.unestimatedCount ?? 0,
    sprintCount: actuals?.sprintCount ?? 0,
    newCount: rows.filter(r => r.isNew).length,
    removedCount: rows.filter(r => r.removed && (r.target > 0 || r.actualSp > 0)).length,
  };
}

export const STATUS_WORD = { ok: 'Within threshold', warn: 'Outside warn threshold', critical: 'Outside critical threshold', none: 'No data yet' };

// Footnote under a chart/bar: how many tickets carry no estimate (they count 0 SP,
// matching Capacity's Total Committed), and — on the committed basis — how many
// sprints have no saved category breakdown yet.
// The no-estimate warning on its own, so the UI can show it prominently (they
// count 0 SP, so the numbers understate the real work until they're estimated).
export function noEstimateNote(model) {
  const n = model.unestimatedCount;
  return n > 0 ? `${n} ticket${n === 1 ? ' has' : 's have'} no estimate` : null;
}

export function portfolioNotes(model) {
  const notes = [];
  const noEstimate = noEstimateNote(model);
  if (noEstimate) notes.push(noEstimate);
  if (model.basis === 'committed' && model.sprintsNotCounted > 0) {
    const n = model.sprintsNotCounted;
    notes.push(`${n} sprint${n === 1 ? ' has' : 's have'} no Committed SP yet — its capacity is in the target, so categories may look under target`);
  }
  if (model.basis === 'committed' && model.sprintsMissingSplit > 0) {
    const n = model.sprintsMissingSplit;
    notes.push(`${n} sprint${n === 1 ? ' has' : 's have'} no category breakdown (shown as Unassigned) — click Get SP Count on ${n === 1 ? 'it' : 'them'} in Capacity`);
  }
  return notes;
}

export function fmtPct(n) {
  return n == null ? '—' : `${Math.round(n * 10) / 10}%`;
}

// Multi-line text for a native tooltip on one allocation row.
export function rowTooltip(row, totalSp) {
  const lines = [row.name + (row.removed ? ' (no longer in Jira)' : '')];
  lines.push(`Target: ${fmtPct(row.target)}${row.targetSp != null ? ` · ${row.targetSp} SP of capacity` : ''}`);
  lines.push(row.actualPct == null
    ? 'Actual: no data yet'
    : `Actual: ${fmtPct(row.actualPct)} (${row.actualSp} of ${totalSp} SP)`);
  lines.push(`Status: ${STATUS_WORD[row.status]}`);
  return lines.join('\n');
}
