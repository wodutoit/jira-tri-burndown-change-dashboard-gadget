// Maps a Jira status category key ("new" | "indeterminate" | "done") to the
// design tokens defined in styles.css, so every gadget colors status the same
// way without repeating the mapping in each component.
const STATUS_CATEGORY_STYLE = {
  new: { bg: 'var(--lz-n-bg)', text: 'var(--lz-n-text)' },
  indeterminate: { bg: 'var(--info-bg)', text: 'var(--info-text)' },
  done: { bg: 'var(--ok-bg)', text: 'var(--ok-text)' },
};

export function statusStyle(categoryKey) {
  return STATUS_CATEGORY_STYLE[categoryKey] ?? STATUS_CATEGORY_STYLE.new;
}

// Forge resolvers run server-side in UTC, so new Date() there can lag a full
// calendar day behind for sites east of UTC (e.g. still "yesterday" in UTC
// during the morning in Sydney). The browser knows the viewer's real local
// date, so compute it here and send it to the resolver instead of trusting
// server-side "today".
export function localTodayISO() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

// Shared by the Capacity page's Releases summary table and the TRI Release
// Capacity gadget's chart — both need the same three-tier classification of
// "how is this release tracking", just with different presentations (a chip
// vs. a bar color), so only the tier boundaries are shared, not the colors.
export function classifyReleaseStatus(totalCommitted, totalCapacity, thresholdPct) {
  if (totalCapacity === 0) return { tier: 'none' };
  if (totalCommitted > totalCapacity) return { tier: 'overCapacity' };
  if (totalCommitted > totalCapacity * (thresholdPct / 100)) return { tier: 'overThreshold' };
  return { tier: 'within' };
}

// Portfolio Planning tolerance bands, in percentage points around a category's
// target share. Thresholds are RELATIVE to the target (a 20% target with
// warnPct=10 is green at 18-22%), with `minTolerancePp` as a floor so small
// targets don't get impossibly tight bands: warn band = max(target*warn%,
// floor), critical band = max(target*critical%, 2*floor). A target of 0 has no
// band at all (any actual above 0 is out of range) — see classifyPortfolioShare.
export function portfolioBands(targetPct, warnPct, criticalPct, minTolerancePp) {
  const floor = Math.max(0, minTolerancePp || 0);
  return {
    warnPp: Math.max(targetPct * (warnPct / 100), floor),
    criticalPp: Math.max(targetPct * (criticalPct / 100), 2 * floor),
  };
}

// 'ok' | 'warn' | 'critical' for one category's actual share vs its target
// (both in percent). Target 0 -> any actual > 0 is critical, exactly 0 is ok;
// this is also how Unassigned (always target 0) is always red.
export function classifyPortfolioShare(actualPct, targetPct, warnPct, criticalPct, minTolerancePp) {
  if (!(targetPct > 0)) return actualPct > 0 ? 'critical' : 'ok';
  const { warnPp, criticalPp } = portfolioBands(targetPct, warnPct, criticalPct, minTolerancePp);
  const dev = Math.abs(actualPct - targetPct);
  // Epsilon so a share sitting exactly on a band edge isn't tipped over by
  // floating-point noise (e.g. 22.000000000000004 vs a 22 edge).
  if (dev <= warnPp + 1e-9) return 'ok';
  if (dev <= criticalPp + 1e-9) return 'warn';
  return 'critical';
}
