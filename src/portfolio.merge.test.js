const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeSpaceDistributions } = require('./portfolio');

const space = (name, cap, alloc, cats, extra = {}) => ({
  name, totalCapacity: cap, hasAllocation: !!alloc,
  alloc: alloc?.pct ?? {}, names: alloc?.names ?? {},
  categories: Object.fromEntries(Object.entries(cats).map(([id, [nm, sp]]) => [id, { name: nm, sp }])),
  totalSp: Object.values(cats).reduce((a, [, sp]) => a + sp, 0) + (extra.unassigned || 0),
  unassigned: { sp: extra.unassigned || 0 }, unestimatedCount: extra.unestimated || 0, sprintCount: 1,
  thresholds: extra.thresholds || { warnPct: 10, criticalPct: 20, minTolerancePp: 1 },
});

test('merges categories across spaces by name (case/space-insensitive) and sums actual SP', () => {
  const a = space('A', 100, { pct: { 11: 20 }, names: { 11: 'Infra' } }, { 11: ['Infra', 30] });
  const b = space('B', 100, { pct: { 22: 20 }, names: { 22: 'infra ' } }, { 22: ['infra ', 10], 23: ['Features', 60] });
  const t = mergeSpaceDistributions([a, b]);
  assert.equal(Object.keys(t.categories).length, 2);
  assert.equal(t.categories['n:infra'].sp, 40);
  assert.equal(t.categories['n:features'].sp, 60);
  assert.equal(t.totalSp, 100);
});

test('total target is capacity-weighted over spaces that have an allocation', () => {
  // A: capacity 300, Infra 20%.  B: capacity 100, Infra 60%.  => (300*20 + 100*60)/400 = 30%
  const a = space('A', 300, { pct: { 1: 20 }, names: { 1: 'Infra' } }, { 1: ['Infra', 1] });
  const b = space('B', 100, { pct: { 2: 60 }, names: { 2: 'Infra' } }, { 2: ['Infra', 1] });
  const t = mergeSpaceDistributions([a, b]);
  assert.equal(t.alloc['n:infra'], 30);
  assert.equal(t.hasAllocation, true);
});

test('a space with no allocation is excluded from the weights and reported', () => {
  const a = space('A', 100, { pct: { 1: 40 }, names: { 1: 'Infra' } }, { 1: ['Infra', 5] });
  const b = space('B', 900, null, { 2: ['Infra', 5] });
  const t = mergeSpaceDistributions([a, b]);
  assert.equal(t.alloc['n:infra'], 40); // the large unallocated space does not dilute it
  assert.deepEqual(t.spacesWithoutAllocation, ['B']);
  assert.equal(t.categories['n:infra'].sp, 10); // but its actual work still counts
});

test('a category only some spaces allocate counts as 0 for the others', () => {
  const a = space('A', 100, { pct: { 1: 50 }, names: { 1: 'Infra' } }, {});
  const b = space('B', 100, { pct: { 2: 50 }, names: { 2: 'Features' } }, {});
  const t = mergeSpaceDistributions([a, b]);
  assert.equal(t.alloc['n:infra'], 25);
  assert.equal(t.alloc['n:features'], 25);
});

test('equal weights when no included space has capacity; no allocation at all -> hasAllocation false', () => {
  const a = space('A', 0, { pct: { 1: 20 }, names: { 1: 'Infra' } }, {});
  const b = space('B', 0, { pct: { 2: 40 }, names: { 2: 'Infra' } }, {});
  assert.equal(mergeSpaceDistributions([a, b]).alloc['n:infra'], 30);
  assert.equal(mergeSpaceDistributions([space('C', 10, null, {})]).hasAllocation, false);
});

test('thresholds use the most lenient value; unassigned and unestimated are summed', () => {
  const a = space('A', 1, null, {}, { unassigned: 3, unestimated: 2, thresholds: { warnPct: 10, criticalPct: 12, minTolerancePp: 0 } });
  const b = space('B', 1, null, {}, { unassigned: 4, unestimated: 1, thresholds: { warnPct: 9, criticalPct: 30, minTolerancePp: 2 } });
  const t = mergeSpaceDistributions([a, b]);
  assert.deepEqual(t.thresholds, { warnPct: 10, criticalPct: 30, minTolerancePp: 2 });
  assert.equal(t.unassigned.sp, 7);
  assert.equal(t.unestimatedCount, 3);
});
