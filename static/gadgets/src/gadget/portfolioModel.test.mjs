import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPortfolioRows } from './portfolioModel.js';

const thresholds = { warnPct: 10, criticalPct: 20, minTolerancePp: 1 };
const options = [{ id: '1', name: 'Infra' }, { id: '2', name: 'Features' }, { id: '3', name: 'Defects' }];
const actuals = (cats, unassigned = 0, extra = {}) => {
  const categories = Object.fromEntries(Object.entries(cats).map(([id, sp]) => [id, { name: `n${id}`, sp }]));
  const totalSp = Object.values(cats).reduce((a, n) => a + n, 0) + unassigned;
  return { totalSp, categories, unassigned: { sp: unassigned }, ...extra };
};
const build = (o) => buildPortfolioRows({ thresholds, optionsLoaded: true, options, ...o });

test('status per row follows the relative thresholds', () => {
  const allocation = { alloc: { 1: 20, 2: 50, 3: 30 }, names: { 1: 'Infra', 2: 'Features', 3: 'Defects' } };
  // targets 20/50/30. Actual 20 = on target; 42 vs 50 = 8pt off (inside the 10pt critical band -> warn);
  // 38 vs 30 = 8pt off (outside the 6pt critical band -> critical).
  const r = build({ allocation, actuals: actuals({ 1: 20, 2: 42, 3: 38 }) });
  const by = Object.fromEntries(r.rows.map(x => [x.id, x.status]));
  assert.deepEqual(by, { 1: 'ok', 2: 'warn', 3: 'critical' });
});

test('unassigned work is always critical, and absent when zero', () => {
  const allocation = { alloc: { 1: 100 }, names: { 1: 'Infra' } };
  assert.equal(build({ allocation, actuals: actuals({ 1: 92 }, 8) }).unassigned.status, 'critical');
  assert.equal(build({ allocation, actuals: actuals({ 1: 100 }) }).unassigned.status, 'none');
});

test('no tickets yet -> status none everywhere (not a wall of red)', () => {
  const r = build({ allocation: { alloc: { 1: 50 }, names: {} }, actuals: actuals({}) });
  assert.ok(r.rows.every(x => x.status === 'none'));
  assert.equal(r.hasActuals, false);
});

test('a new Jira option is flagged only when the release has a saved allocation that predates it', () => {
  const allocation = { alloc: { 1: 50 }, names: { 1: 'Infra', 2: 'Features' } };
  const r = build({ allocation, actuals: null });
  assert.deepEqual(r.rows.filter(x => x.isNew).map(x => x.id), ['3']);
  assert.equal(build({ allocation: null, actuals: null }).newCount, 0);
});

test('an allocated option Jira no longer lists is kept and flagged removed', () => {
  const allocation = { alloc: { 1: 40, 9: 10 }, names: { 1: 'Infra', 9: 'Old thing' } };
  const r = build({ allocation, actuals: null });
  const old = r.rows.find(x => x.id === '9');
  assert.equal(old.removed, true);
  assert.equal(old.name, 'Old thing');
  assert.equal(r.removedCount, 1);
  assert.equal(r.allocatedTotal, 50);
  assert.equal(r.unallocatedPct, 50);
});

test('tickets carrying an unlisted option still show, labelled from the actuals', () => {
  const r = build({ allocation: null, actuals: actuals({ 1: 10, 7: 10 }) });
  const x = r.rows.find(y => y.id === '7');
  assert.equal(x.name, 'n7');
  assert.equal(x.removed, true);
  assert.equal(x.status, 'critical'); // target 0, actual 50%
});

test('released versions get no new/removed flags (historical snapshot)', () => {
  const allocation = { alloc: { 1: 40, 9: 10 }, names: { 1: 'Infra' } };
  const r = build({ allocation, actuals: null, historical: true });
  assert.ok(r.rows.every(x => !x.isNew && !x.removed));
});

test('when options could not be listed nothing is flagged and names fall back to the snapshot', () => {
  const allocation = { alloc: { 5: 30 }, names: { 5: 'Snapshot name' } };
  const r = buildPortfolioRows({ thresholds, options: [], optionsLoaded: false, allocation, actuals: null });
  assert.equal(r.rows[0].name, 'Snapshot name');
  assert.ok(r.rows.every(x => !x.isNew && !x.removed));
});
