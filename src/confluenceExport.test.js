const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSnapshot, parseParentRef, baseTitle, timestampedTitle, isLogTitle, renderStorage } = require('./confluenceExport');

const meta = {
  projectKey: 'ZEN', projectName: 'ZENITH', boardType: 'scrum', baseCapacitySp: 20,
  releaseMappingEnabled: true, releaseThresholdPct: 70, generatedAt: '2026-10-19T14:32:05.000Z',
};

test('parseParentRef handles ids, page URLs and folder URLs', () => {
  assert.equal(parseParentRef('12345'), '12345');
  assert.equal(parseParentRef('https://x.atlassian.net/wiki/spaces/ENG/pages/98765/Some+Title'), '98765');
  assert.equal(parseParentRef('https://x.atlassian.net/wiki/spaces/ENG/folder/555?atlOrigin=abc'), '555');
  assert.equal(parseParentRef(''), null);
  assert.equal(parseParentRef('not a ref'), null);
});

test('titles', () => {
  assert.equal(baseTitle('ZENITH'), 'ZENITH-Capacity Log');
  assert.equal(timestampedTitle('ZENITH', new Date('2026-10-19T14:32:05Z')), 'ZENITH-Capacity Log 2026-10-19 14:32 UTC');
});

test('isLogTitle matches only the base and timestamped titles', () => {
  assert.ok(isLogTitle('ZENITH-Capacity Log', 'ZENITH'));
  assert.ok(isLogTitle('ZENITH-Capacity Log 2026-10-19 14:32 UTC', 'ZENITH'));
  assert.ok(!isLogTitle('ZENITH-Capacity Log Notes', 'ZENITH'));
  assert.ok(!isLogTitle('Other-Capacity Log', 'ZENITH'));
  assert.ok(!isLogTitle('ZENITH-Capacity Log 2026-10-19', 'ZENITH'));
  // regex metacharacters in a project name are literal
  assert.ok(isLogTitle('A.B (x)-Capacity Log', 'A.B (x)'));
  assert.ok(!isLogTitle('AxB (x)-Capacity Log', 'A.B (x)'));
});

test('validateSnapshot rebuilds fields and drops junk', () => {
  const { snapshot, error } = validateSnapshot({
    periodType: 'iteration', hideClosed: 1,
    periods: [{ id: 5, name: 'S1\u0000x', capacity: '78', committed: 'abc', velocity: null, evil: '<script>', releaseId: null }],
    releases: [{ id: 'r', name: 'R', status: 'bogus', totalCapacity: 10 }],
  });
  assert.equal(error, undefined);
  assert.equal(snapshot.periodType, 'iteration');
  assert.equal(snapshot.periods[0].name, 'S1 x');
  assert.equal(snapshot.periods[0].capacity, 78);
  assert.equal(snapshot.periods[0].committed, null);
  assert.equal('evil' in snapshot.periods[0], false);
  assert.equal(snapshot.releases[0].status, 'no_capacity');
});

test('validateSnapshot rejects oversized or malformed input', () => {
  assert.ok(validateSnapshot(null).error);
  assert.ok(validateSnapshot({ periods: 'x' }).error);
  assert.ok(validateSnapshot({ periods: new Array(501).fill({}) }).error);
});

test('renderStorage escapes markup and keeps JSON CDATA safe', () => {
  const { snapshot } = validateSnapshot({
    periods: [{ id: '1', name: '</td><b>x</b> ]]> & "q"', capacity: 5, committed: 3, velocity: 0, state: 'active', releaseName: 'R1' }],
    releases: [{ id: 'r1', name: 'R1', periodCount: 1, totalCapacity: 5, thresholdCapacity: 3.5, totalCommitted: 3, avgVelocity: 0, status: 'within_threshold' }],
  });
  const xml = renderStorage(meta, snapshot);
  assert.ok(!xml.includes('<b>x</b>'));
  assert.ok(xml.includes('&lt;/td&gt;&lt;b&gt;x&lt;/b&gt;'));
  const cdata = xml.match(/<!\[CDATA\[([\s\S]*)\]\]><\/ac:plain-text-body>/)[1];
  assert.ok(!cdata.includes(']]>'));
  const parsed = JSON.parse(cdata);
  assert.equal(parsed.schema, 'tri-capacity-log/v1');
  assert.equal(parsed.periods[0].name, '</td><b>x</b> ]]> & "q"');
  assert.equal(parsed.releases[0].status, 'within_threshold');
});

test('renderStorage omits Releases section when release mapping is off', () => {
  const { snapshot } = validateSnapshot({ periods: [], releases: [] });
  const xml = renderStorage({ ...meta, releaseMappingEnabled: false }, snapshot);
  assert.ok(!xml.includes('<h2>Releases</h2>'));
});

test('portfolio sub-table renders per release when enabled, and is dropped when the server says it is off', () => {
  const { snapshot } = validateSnapshot({
    periods: [],
    releases: [{
      id: 'r1', name: 'Rel <1>', status: 'within_threshold',
      portfolio: {
        basis: 'committed', hasAllocation: true, isDefaultAllocation: true, totalCommitted: 40, totalCapacity: 100,
        categories: [{ id: 'a', name: 'Features & more', targetPct: 60, targetSp: 60, actualSp: 30, actualPct: 75, status: 'warn' }, { id: 'b', name: 'X', status: 'bogus' }],
        unassigned: { actualSp: 5, actualPct: 12.5, status: 'critical' },
        notes: ['2 tickets have no estimate'],
      },
    }],
  });
  assert.equal(snapshot.releases[0].portfolio.categories[1].status, 'none');
  const on = renderStorage({ ...meta, portfolio: { warnPct: 10, criticalPct: 20, minTolerancePp: 1 } }, snapshot);
  assert.ok(on.includes('<h3>Portfolio — Rel &lt;1&gt;</h3>'));
  assert.ok(on.includes('Features &amp; more'));
  assert.ok(on.includes('Outside warn threshold'));
  assert.ok(on.includes('Unassigned'));
  assert.ok(on.includes('space default allocation'));
  const data = JSON.parse(on.match(/<!\[CDATA\[([\s\S]*)\]\]>/)[1]);
  assert.equal(data.releases[0].portfolio.unassigned.status, 'critical');
  assert.equal(data.settings.portfolio.warnPct, 10);
  const off = renderStorage({ ...meta, portfolio: null }, snapshot);
  assert.ok(!off.includes('<h3>Portfolio'));
});
