const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSnapshot, parseParentRef, baseTitle, timestampedTitle, renderStorage } = require('./confluenceExport');

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
