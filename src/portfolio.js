// Pure Portfolio Planning helpers — no Forge/Jira imports, so they can be unit
// tested with `node --test` and reused by later steps (actuals, gadget rollups).

const MAX_OPTIONS = 200;
const MAX_NAME_LEN = 100;
// Allocations are one-decimal percentages; the epsilon stops 33.3 + 33.3 + 33.4
// style sums from being rejected over floating-point noise.
const TOTAL_EPSILON = 1e-6;

const round1 = (n) => Math.round(n * 10) / 10;

// Validates and normalizes one release's allocation, server-side — the UI
// validates the same rules for feedback, but this is the authority.
//   alloc: { [optionId]: percent }   names: { [optionId]: display name } for every known option (optional)
// Returns { alloc, names, total } (percent values rounded to 1 decimal, zero
// allocations dropped, names trimmed/truncated and limited to allocated ids)
// or { error }.
function validateAllocation(alloc, names) {
  if (!alloc || typeof alloc !== 'object' || Array.isArray(alloc)) {
    return { error: 'Allocation must be an object of option id to percent.' };
  }
  const entries = Object.entries(alloc);
  if (entries.length > MAX_OPTIONS) return { error: `Too many options (max ${MAX_OPTIONS}).` };

  const clean = {};
  let total = 0;
  for (const [id, raw] of entries) {
    if (typeof id !== 'string' || !/^\d{1,20}$/.test(id)) {
      return { error: `Invalid option id "${String(id).slice(0, 30)}".` };
    }
    if (raw === '' || raw == null || typeof raw === 'boolean') return { error: 'Every allocation must be a number.' };
    const n = Number(raw);
    if (!Number.isFinite(n)) return { error: 'Every allocation must be a number.' };
    if (n < 0 || n > 100) return { error: 'Each allocation must be between 0 and 100.' };
    const r = round1(n);
    if (r > 0) { clean[id] = r; total += r; }
  }
  if (total > 100 + TOTAL_EPSILON) {
    return { error: `Allocations total ${round1(total)}% — the maximum is 100%.` };
  }

  // `names` is the snapshot of every option the editor knew about at save time
  // (allocated or not): an option that's in Jira later but missing from this
  // snapshot is "new" since the last save, which is how the UI tells it apart
  // from one deliberately left at 0%.
  const cleanNames = {};
  if (names && typeof names === 'object' && !Array.isArray(names)) {
    const nameEntries = Object.entries(names);
    if (nameEntries.length > MAX_OPTIONS) return { error: `Too many options (max ${MAX_OPTIONS}).` };
    for (const [id, nm] of nameEntries) {
      if (!/^\d{1,20}$/.test(id)) return { error: `Invalid option id "${String(id).slice(0, 30)}".` };
      if (typeof nm === 'string' && nm.trim()) cleanNames[id] = nm.trim().slice(0, MAX_NAME_LEN);
    }
  }
  return { alloc: clean, names: cleanNames, total: round1(total) };
}

// Story points a ticket with NO estimate contributes, so it still shows up in
// the distribution rather than vanishing. Only a missing/blank estimate gets
// this — an explicit 0 is a deliberate estimate and stays 0.
const DEFAULT_UNESTIMATED_SP = 1;

// Buckets Jira issues (raw search results: { key, fields }) by the value of the
// portfolio select field, summing story points.
//  - Deduped by issue key: a ticket that spilled over sits in several of a
//    release's sprints and must only count once.
//  - Unestimated, non-subtask tickets count as `defaultSp`. Subtasks are the
//    exception: they rarely carry their own estimate (the parent does), so a
//    blank-estimate subtask counts 0 — otherwise every subtask would inflate the
//    parent's category by a phantom point. A subtask WITH its own estimate counts.
//  - A ticket with no category value goes to the Unassigned bucket (never a
//    category), which still counts toward the total.
// Returns percent-ready sums (SP rounded to 1 decimal at the end only, so
// rounding never accumulates).
//  - `skipKeys` (optional Set of issue keys) are ignored entirely. The caller
//    passes the Epics in the sprint that HAVE children: the children are counted
//    on their own, so counting the Epic too would double-count. An Epic with no
//    children isn't in the set and counts like any other ticket (its own estimate).
function aggregateActuals(issues, { spFieldId, fieldId, defaultSp = DEFAULT_UNESTIMATED_SP, skipKeys }) {
  const seen = new Set();
  const categories = {};
  let totalSp = 0, issueCount = 0, unestimatedCount = 0;
  const unassigned = { sp: 0, issueCount: 0, unestimatedCount: 0 };

  for (const issue of issues || []) {
    if (!issue || seen.has(issue.key) || (skipKeys && skipKeys.has(issue.key))) continue;
    seen.add(issue.key);

    const isSubtask = !!issue.fields?.issuetype?.subtask;
    const raw = issue.fields?.[spFieldId];
    const hasEstimate = typeof raw === 'number' && Number.isFinite(raw);
    let sp, unestimated = false;
    if (hasEstimate) sp = Math.max(0, raw);
    else if (isSubtask) sp = 0;
    else { sp = defaultSp; unestimated = true; }
    if (isSubtask && sp === 0) continue; // nothing to contribute, don't count it as a ticket

    totalSp += sp;
    issueCount++;
    if (unestimated) unestimatedCount++;

    const opt = issue.fields?.[fieldId];
    const id = opt && opt.id != null ? String(opt.id) : null;
    if (id == null) {
      unassigned.sp += sp; unassigned.issueCount++; if (unestimated) unassigned.unestimatedCount++;
    } else {
      const c = categories[id] || (categories[id] = { name: opt.value ?? opt.name ?? id, sp: 0, issueCount: 0, unestimatedCount: 0 });
      c.sp += sp; c.issueCount++; if (unestimated) c.unestimatedCount++;
    }
  }

  const out = {};
  for (const [id, c] of Object.entries(categories)) out[id] = { ...c, sp: round1(c.sp) };
  return {
    totalSp: round1(totalSp), issueCount, unestimatedCount,
    categories: out,
    unassigned: { ...unassigned, sp: round1(unassigned.sp) },
  };
}

// ── Cross-space Total (gadget) ───────────────────────────────────────────────
// One space's distribution for one release has this shape (built in index.js):
//   { name, totalCapacity, hasAllocation, alloc:{id:pct}, names:{id:name},
//     totalSp, categories:{id:{name,sp}}, unassigned:{sp}, unestimatedCount,
//     sprintCount, thresholds:{warnPct,criticalPct,minTolerancePp} }
// Option ids differ per space (each has its own field), so spaces are merged by
// category NAME (trimmed, case-insensitive). The merged result has the same
// shape with synthetic "n:<name>" ids, so it renders through the same code.
//
//  - Actual SP: summed per category (and Unassigned) across spaces.
//  - Target %: weighted by each space's capacity for the release (the plan, not
//    the actual mix of work), over only the spaces that HAVE an allocation for
//    it; a space without one is left out of the weights and listed in
//    `spacesWithoutAllocation`. If no included space has capacity, equal weights.
//  - Thresholds: the most lenient (largest) of the spaces', so the Total is never
//    flagged harsher than a space that contributes to it.
const normName = (n) => String(n ?? '').trim().toLowerCase();

function mergeSpaceDistributions(items) {
  const list = (items || []).filter(Boolean);
  const names = {};      // key -> display name (first seen)
  const sp = {};         // key -> actual SP
  const targetNum = {};  // key -> sum(weight * pct)
  let totalSp = 0, unassignedSp = 0, unestimatedCount = 0, sprintCount = 0;

  const touch = (name) => {
    const key = `n:${normName(name)}`;
    if (!(key in names)) { names[key] = String(name ?? '').trim() || key; sp[key] = 0; targetNum[key] = 0; }
    return key;
  };

  for (const d of list) {
    totalSp += d.totalSp || 0;
    unassignedSp += d.unassigned?.sp || 0;
    unestimatedCount += d.unestimatedCount || 0;
    sprintCount += d.sprintCount || 0;
    for (const c of Object.values(d.categories || {})) sp[touch(c.name)] += c.sp || 0;
  }

  const withAlloc = list.filter(d => d.hasAllocation);
  const capSum = withAlloc.reduce((a, d) => a + Math.max(0, d.totalCapacity || 0), 0);
  const weightOf = (d) => (capSum > 0 ? Math.max(0, d.totalCapacity || 0) : 1);
  const weightSum = withAlloc.reduce((a, d) => a + weightOf(d), 0);

  for (const d of withAlloc) {
    for (const [id, pct] of Object.entries(d.alloc || {})) {
      const nm = d.names?.[id] ?? d.categories?.[id]?.name ?? id;
      targetNum[touch(nm)] += weightOf(d) * pct;
    }
  }

  const alloc = {}, categories = {}, outNames = {};
  for (const key of Object.keys(names)) {
    outNames[key] = names[key];
    categories[key] = { name: names[key], sp: round1(sp[key]) };
    const t = weightSum > 0 ? targetNum[key] / weightSum : 0;
    if (t > 0) alloc[key] = round1(t);
  }

  const ths = list.map(d => d.thresholds).filter(Boolean);
  return {
    name: 'Total',
    totalCapacity: withAlloc.reduce((a, d) => a + (d.totalCapacity || 0), 0),
    hasAllocation: withAlloc.length > 0,
    alloc, names: outNames, categories,
    totalSp: round1(totalSp), unassigned: { sp: round1(unassignedSp) },
    unestimatedCount, sprintCount,
    thresholds: ths.length ? {
      warnPct: Math.max(...ths.map(t => t.warnPct)),
      criticalPct: Math.max(...ths.map(t => t.criticalPct)),
      minTolerancePp: Math.max(...ths.map(t => t.minTolerancePp)),
    } : null,
    spacesIncluded: list.length,
    spacesWithoutAllocation: list.filter(d => !d.hasAllocation).map(d => d.name),
  };
}

module.exports = { validateAllocation, aggregateActuals, mergeSpaceDistributions, round1, MAX_OPTIONS, DEFAULT_UNESTIMATED_SP };
