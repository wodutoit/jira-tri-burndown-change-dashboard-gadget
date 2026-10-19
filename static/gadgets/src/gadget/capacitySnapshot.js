import { classifyReleaseStatus } from './gadgetUtils';
import { buildPortfolioRows, portfolioNotes } from './portfolioModel';

const TIER_TO_STATUS = {
  none: 'no_capacity',
  within: 'within_threshold',
  overThreshold: 'over_threshold',
  overCapacity: 'over_capacity',
};

// One row per release, driven by the currently visible rows but with every
// figure computed from ALL rows mapped to that release (so hiding a sprint never
// changes a release's totals). Shared by the on-screen Releases summary table and
// the Save-to-Confluence snapshot so the two can never disagree.
export function summarizeReleases({ rows, allRows = rows, releaseOptions, baseCapacitySp, thresholdPct }) {
  const visibleReleaseIds = new Set(rows.filter(r => r.releaseId).map(r => r.releaseId));
  const groups = new Map();
  for (const row of allRows) {
    if (!row.releaseId || !visibleReleaseIds.has(row.releaseId)) continue;
    if (!groups.has(row.releaseId)) groups.set(row.releaseId, []);
    groups.get(row.releaseId).push(row);
  }

  return [...groups.entries()].map(([releaseId, group]) => {
    const totalCapacity = group.reduce((a, r) => a + (r.capacitySp ?? baseCapacitySp ?? 0), 0);
    const totalCommitted = group.reduce((a, r) => a + (r.committedSp ?? 0), 0);
    const thresholdCapacity = totalCapacity * (thresholdPct / 100);
    // Only a >0 recorded velocity counts: a future/in-progress sprint reads 0
    // long before it means anything (see PROJECT-CONTEXT.md, Release Mapping).
    const withVelocity = group.filter(r => r.velocitySp != null && r.velocitySp > 0);
    const avgVelocity = withVelocity.length
      ? withVelocity.reduce((a, r) => a + r.velocitySp, 0) / withVelocity.length
      : 0;
    const { tier } = classifyReleaseStatus(totalCommitted, totalCapacity, thresholdPct);
    const version = (releaseOptions || []).find(v => v.id === releaseId) || null;
    return {
      releaseId, name: version ? version.name : '(deleted release)',
      sprintCount: group.length, totalCapacity, thresholdCapacity, totalCommitted, avgVelocity, tier,
    };
  });
}

// One release's Portfolio Planning breakdown, built with the same model the
// allocation bar/popup use (buildPortfolioRows) so the export matches the screen.
// A release's own allocation wins, otherwise the space default.
function portfolioForRelease(releaseId, portfolio, releaseOptions) {
  const own = portfolio.allocations?.[releaseId] ?? null;
  const allocation = own ?? portfolio.defaultAllocation ?? null;
  const model = buildPortfolioRows({
    options: portfolio.options,
    optionsLoaded: portfolio.optionsLoaded,
    allocation,
    isDefault: !own,
    actuals: portfolio.actuals?.[releaseId] ?? null,
    historical: !!(releaseOptions || []).find(v => v.id === releaseId)?.released,
    thresholds: portfolio.thresholds,
  });
  return {
    basis: model.basis,
    hasAllocation: model.hasSaved,
    isDefaultAllocation: model.isDefault,
    totalCommitted: model.totalSp,
    totalCapacity: model.totalCapacity,
    thresholdCapacity: model.thresholdCapacity,
    categories: model.rows
      .filter(r => !(r.removed && r.target === 0 && r.actualSp === 0))
      .map(r => ({
        id: r.id, name: r.name, targetPct: r.target, targetSp: r.targetSp,
        actualSp: r.actualSp, actualPct: r.actualPct, status: r.status,
      })),
    unassigned: { actualSp: model.unassigned.actualSp, actualPct: model.unassigned.actualPct, status: model.unassigned.status },
    notes: portfolioNotes(model),
  };
}

// What "Save to Confluence" sends: exactly what's on screen (visible rows +
// the release rollup). The server re-validates and re-renders everything.
// `portfolio` (Scrum + Portfolio Planning on only) is the usePortfolio state plus thresholds.
export function buildCapacitySnapshot({ periodType, hideClosed, visibleRows, allRows, releaseOptions, baseCapacitySp, releaseMappingEnabled, thresholdPct, portfolio = null }) {
  if (portfolio && portfolio.actualsLoading) throw new Error('Portfolio data is still loading — try again in a moment.');
  const nameOf = id => ((releaseOptions || []).find(v => v.id === id) || {}).name || (id ? '(deleted release)' : null);
  const releases = releaseMappingEnabled
    ? summarizeReleases({ rows: visibleRows, allRows, releaseOptions, baseCapacitySp, thresholdPct }).map(s => ({
      id: s.releaseId, name: s.name, periodCount: s.sprintCount,
      totalCapacity: s.totalCapacity, thresholdCapacity: s.thresholdCapacity, totalCommitted: s.totalCommitted,
      avgVelocity: s.avgVelocity, status: TIER_TO_STATUS[s.tier],
      ...(portfolio ? { portfolio: portfolioForRelease(s.releaseId, portfolio, releaseOptions) } : {}),
    }))
    : [];
  const periods = visibleRows.map(r => ({
    id: r.id, name: r.name, state: r.state ?? r.status ?? '',
    startDate: r.startDate ?? null, endDate: r.endDate ?? null,
    capacity: r.capacitySp ?? baseCapacitySp ?? 0, capacityIsOverride: r.capacitySp != null,
    committed: r.committedSp ?? null, committedCalculatedAt: r.committedAt ?? null,
    velocity: r.velocitySp ?? null, velocityCalculatedAt: r.velocityAt ?? null,
    releaseId: releaseMappingEnabled ? (r.releaseId ?? null) : null,
    releaseName: releaseMappingEnabled && r.releaseId ? nameOf(r.releaseId) : null,
  }));
  return { periodType, hideClosed, periods, releases };
}
