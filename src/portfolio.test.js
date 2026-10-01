const test = require('node:test');
const assert = require('node:assert/strict');
const { validateAllocation } = require('./portfolio');

test('accepts a valid allocation and rounds to one decimal', () => {
  const r = validateAllocation({ 10001: 20.04, 10002: '30', 10003: 49.96 }, { 10001: ' Infra ', 10002: 'Features', 10003: 'Defects' });
  assert.deepEqual(r.alloc, { 10001: 20, 10002: 30, 10003: 50 });
  assert.equal(r.total, 100);
  assert.equal(r.names['10001'], 'Infra');
});

test('total of exactly 100 passes, including float noise', () => {
  assert.ok(!validateAllocation({ 1: 33.3, 2: 33.3, 3: 33.4 }).error);
});

test('total over 100 is rejected', () => {
  assert.match(validateAllocation({ 1: 60, 2: 40.1 }).error, /maximum is 100%/);
});

test('under 100 is allowed (remainder is "unallocated")', () => {
  assert.equal(validateAllocation({ 1: 25 }).total, 25);
});

test('rejects negative, >100, non-numeric, blank and boolean values', () => {
  assert.ok(validateAllocation({ 1: -1 }).error);
  assert.ok(validateAllocation({ 1: 100.1 }).error);
  assert.ok(validateAllocation({ 1: 'x' }).error);
  assert.ok(validateAllocation({ 1: '' }).error);
  assert.ok(validateAllocation({ 1: true }).error);
  assert.ok(validateAllocation({ 1: NaN }).error);
});

test('zero allocations are dropped; empty allocation is valid (clears the release)', () => {
  assert.deepEqual(validateAllocation({ 1: 0, 2: 10 }).alloc, { 2: 10 });
  assert.deepEqual(validateAllocation({}).alloc, {});
});

test('rejects malformed option ids and non-objects', () => {
  assert.ok(validateAllocation({ 'a b': 10 }).error);
  assert.ok(validateAllocation(JSON.parse('{"__proto__": 10}')).error);
  assert.ok(validateAllocation(null).error);
  assert.ok(validateAllocation([10]).error);
});

test('names are kept for every known option (not just allocated), trimmed and truncated', () => {
  const r = validateAllocation({ 1: 10 }, { 1: 'x'.repeat(300), 2: ' Other ' });
  assert.equal(r.names[1].length, 100);
  assert.equal(r.names[2], 'Other');
});

test('names with a malformed option id are rejected', () => {
  assert.ok(validateAllocation({ 1: 10 }, { 'bad id': 'x' }).error);
});

// ── aggregateActuals ─────────────────────────────────────────────────────────
const { aggregateActuals } = require('./portfolio');
const SP = 'customfield_sp', CAT = 'customfield_cat';
const issue = (key, sp, cat, subtask = false) => ({
  key,
  fields: { [SP]: sp, [CAT]: cat === undefined ? null : { id: cat, value: `Cat ${cat}` }, issuetype: { subtask } },
});
const opts = { spFieldId: SP, fieldId: CAT };

test('sums story points per category and an Unassigned bucket', () => {
  const r = aggregateActuals([issue('A-1', 5, '1'), issue('A-2', 3, '1'), issue('A-3', 2, '2'), issue('A-4', 4)], opts);
  assert.equal(r.categories['1'].sp, 8);
  assert.equal(r.categories['2'].sp, 2);
  assert.equal(r.unassigned.sp, 4);
  assert.equal(r.totalSp, 14);
});

test('a ticket with no estimate counts as 1 SP and is reported', () => {
  const r = aggregateActuals([issue('A-1', null, '1'), issue('A-2', undefined, '1'), issue('A-3', 5, '1')], opts);
  assert.equal(r.categories['1'].sp, 7);
  assert.equal(r.categories['1'].unestimatedCount, 2);
  assert.equal(r.unestimatedCount, 2);
});

test('an unestimated ticket with no category lands in Unassigned as 1 SP', () => {
  const r = aggregateActuals([issue('A-1', null)], opts);
  assert.equal(r.unassigned.sp, 1);
  assert.equal(r.unassigned.unestimatedCount, 1);
});

test('an explicit 0 estimate stays 0 (only a missing estimate defaults)', () => {
  const r = aggregateActuals([issue('A-1', 0, '1')], opts);
  assert.equal(r.categories['1'].sp, 0);
  assert.equal(r.unestimatedCount, 0);
});

test('a ticket appearing in several sprints is counted once', () => {
  const r = aggregateActuals([issue('A-1', 5, '1'), issue('A-1', 5, '1'), issue('A-1', 5, '1')], opts);
  assert.equal(r.totalSp, 5);
  assert.equal(r.issueCount, 1);
});

test('unestimated subtasks contribute nothing; estimated subtasks count', () => {
  const r = aggregateActuals([issue('A-1', 8, '1'), issue('A-2', null, '1', true), issue('A-3', 2, '1', true)], opts);
  assert.equal(r.categories['1'].sp, 10);
  assert.equal(r.issueCount, 2);
  assert.equal(r.unestimatedCount, 0);
});

test('negative estimates clamp to 0; rounding happens once at the end', () => {
  assert.equal(aggregateActuals([issue('A-1', -3, '1')], opts).categories['1'].sp, 0);
  const r = aggregateActuals([issue('A-1', 0.1, '1'), issue('A-2', 0.2, '1')], opts);
  assert.equal(r.categories['1'].sp, 0.3);
});

test('category name comes from the issue value; empty input is safe', () => {
  assert.equal(aggregateActuals([issue('A-1', 1, '7')], opts).categories['7'].name, 'Cat 7');
  const r = aggregateActuals([], opts);
  assert.equal(r.totalSp, 0);
  assert.deepEqual(r.categories, {});
});

test('epics listed in skipKeys (epics with children) are ignored; other epics count normally', () => {
  const withChildren = issue('E-1', 13, '1');
  const childless = issue('E-2', 8, '1');
  const child = issue('A-1', 5, '1');
  const r = aggregateActuals([withChildren, childless, child], { ...opts, skipKeys: new Set(['E-1']) });
  assert.equal(r.categories['1'].sp, 13); // childless epic 8 + child 5, not the 13-pt epic
  assert.equal(r.issueCount, 2);
});
