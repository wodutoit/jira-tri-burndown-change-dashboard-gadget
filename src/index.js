const Resolver = require('@forge/resolver').default;
const { route, asUser } = require('@forge/api');
const { storage } = require('@forge/storage');

const resolver = new Resolver();

// Cache TTL for active sprints (ms). Closed sprints are cached forever.
const ACTIVE_CACHE_TTL_MS = 5 * 60 * 1000;

// ── Edit-mode: projects list ──────────────────────────────────────────────────

resolver.define('getGadgetProjects', async () => {
  try {
    const res = await asUser().requestJira(
      route`/rest/api/3/project/search?maxResults=100&orderBy=name`,
      { headers: { Accept: 'application/json' } }
    );
    if (!res.ok) return { projects: [], error: `Jira ${res.status}` };
    const body = await res.json();
    const projects = (body.values || []).map(p => ({ id: p.id, key: p.key, name: p.name }));
    return { projects };
  } catch (e) {
    return { projects: [], error: e.message };
  }
});

// ── Edit-mode: numeric custom fields (story points candidates) ────────────────

resolver.define('getNumericFields', async () => {
  try {
    const res = await asUser().requestJira(
      route`/rest/api/3/field`,
      { headers: { Accept: 'application/json' } }
    );
    if (!res.ok) return { fields: [], error: `Jira ${res.status}` };
    const fields = await res.json();
    const numeric = fields
      .filter(f => f.schema && (f.schema.type === 'number' || f.schema.system === 'story_points'))
      .map(f => ({ id: f.id, name: f.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { fields: numeric };
  } catch (e) {
    return { fields: [], error: e.message };
  }
});

// ── Edit-mode: statuses for a project ────────────────────────────────────────

resolver.define('getProjectStatuses', async ({ payload }) => {
  const { projectKey } = payload ?? {};
  if (!projectKey) return { statuses: [], error: 'No project key.' };
  try {
    const res = await asUser().requestJira(
      route`/rest/api/3/project/${projectKey}/statuses`,
      { headers: { Accept: 'application/json' } }
    );
    if (!res.ok) return { statuses: [], error: `Jira ${res.status}` };
    const data = await res.json();
    const seen = new Set();
    const statuses = [];
    for (const issueType of data) {
      for (const s of issueType.statuses || []) {
        if (!seen.has(s.name)) {
          seen.add(s.name);
          statuses.push({ id: s.id, name: s.name, categoryKey: s.statusCategory?.key });
        }
      }
    }
    statuses.sort((a, b) => a.name.localeCompare(b.name));
    return { statuses };
  } catch (e) {
    return { statuses: [], error: e.message };
  }
});

// ── Edit-mode: sprints for a project ─────────────────────────────────────────

resolver.define('getSprintsForProject', async ({ payload }) => {
  const { projectKey } = payload ?? {};
  if (!projectKey) return { sprints: [], error: 'No project key.' };
  try {
    const boardRes = await asUser().requestJira(
      route`/rest/agile/1.0/board?projectKeyOrId=${projectKey}&maxResults=1`,
      { headers: { Accept: 'application/json' } }
    );
    if (!boardRes.ok) return { sprints: [], error: `Board search failed: ${boardRes.status}` };
    const boardBody = await boardRes.json();
    const board = boardBody.values?.[0];
    if (!board) return { sprints: [], error: 'No board found for this project.' };

    const boardId = board.id;
    const [activeRes, closedRes] = await Promise.all([
      asUser().requestJira(
        route`/rest/agile/1.0/board/${boardId}/sprint?state=active&maxResults=10`,
        { headers: { Accept: 'application/json' } }
      ),
      asUser().requestJira(
        route`/rest/agile/1.0/board/${boardId}/sprint?state=closed&maxResults=20`,
        { headers: { Accept: 'application/json' } }
      ),
    ]);

    const activeBody = activeRes.ok ? await activeRes.json() : { values: [] };
    const closedBody = closedRes.ok ? await closedRes.json() : { values: [] };

    const sprints = [
      ...(activeBody.values || []).map(s => ({ id: s.id, name: s.name, state: 'active', startDate: s.startDate, endDate: s.endDate })),
      ...(closedBody.values || []).map(s => ({ id: s.id, name: s.name, state: 'closed', startDate: s.startDate, endDate: s.endDate })),
    ];

    return { sprints, boardId };
  } catch (e) {
    return { sprints: [], error: e.message };
  }
});

// ── Shared: resolve which sprint a widget instance is rendering ───────────────
// 'active' mode does a fresh lookup every call so widgets never go stale when a
// sprint closes; 'fixed' mode pins to a specific (often closed) sprint id.

async function resolveActiveSprint(projectKey) {
  const boardRes = await asUser().requestJira(
    route`/rest/agile/1.0/board?projectKeyOrId=${projectKey}&maxResults=1`,
    { headers: { Accept: 'application/json' } }
  );
  if (!boardRes.ok) return { error: `Board search failed: ${boardRes.status}` };
  const boardBody = await boardRes.json();
  const board = boardBody.values?.[0];
  if (!board) return { error: 'No board found for this space.' };

  const sprintRes = await asUser().requestJira(
    route`/rest/agile/1.0/board/${board.id}/sprint?state=active&maxResults=1`,
    { headers: { Accept: 'application/json' } }
  );
  if (!sprintRes.ok) return { error: `Sprint search failed: ${sprintRes.status}` };
  const sprintBody = await sprintRes.json();
  const sprint = sprintBody.values?.[0];
  if (!sprint) return { error: 'No active sprint currently running for this space.' };
  return { sprint };
}

async function resolveSprint({ projectKey, sprintMode, sprintId }) {
  if (sprintMode === 'active') return resolveActiveSprint(projectKey);
  const sprintRes = await asUser().requestJira(
    route`/rest/agile/1.0/sprint/${sprintId}`,
    { headers: { Accept: 'application/json' } }
  );
  if (!sprintRes.ok) return { error: `Failed to fetch sprint: ${sprintRes.status}` };
  return { sprint: await sprintRes.json() };
}

// Space (project) display name never appears in the sprint payload, so fetch
// it separately for the widget header. Cached indefinitely — project names
// rarely change and this is a single cheap GET.
async function getSpaceName(projectKey) {
  const cacheKey = `space-name:${projectKey}`;
  try {
    const cached = await storage.get(cacheKey);
    if (cached) return cached;
  } catch (_) {}

  const res = await asUser().requestJira(
    route`/rest/api/3/project/${projectKey}`,
    { headers: { Accept: 'application/json' } }
  );
  const name = res.ok ? (await res.json()).name : projectKey;

  try { await storage.set(cacheKey, name); } catch (_) {}
  return name;
}

// ── Shared: fetch + cache raw per-sprint issue/changelog data ─────────────────
// This is the expensive part (pagination + full changelog per issue) and is
// identical for every widget looking at the same sprint + SP field, regardless
// of how each widget classifies statuses — so it's cached independently of any
// widget's status mapping and can be reused across TRI-Burndown, TRI-Scope-Change,
// and future widgets on the same dashboard.

async function fetchSprintIssues(projectKey, sprintId, spFieldId) {
  const fields = ['summary', 'status', 'issuetype', 'created', spFieldId];
  const allIssues = [];
  let nextPageToken;

  while (true) {
    const reqBody = {
      jql: `project = "${projectKey}" AND sprint = ${sprintId}`,
      fields,
      expand: 'changelog',
      maxResults: 50,
    };
    if (nextPageToken) reqBody.nextPageToken = nextPageToken;

    const searchRes = await asUser().requestJira(
      route`/rest/api/3/search/jql`,
      {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(reqBody),
      }
    );
    if (!searchRes.ok) {
      const txt = await searchRes.text();
      throw new Error(`Issue search failed (${searchRes.status}): ${txt}`);
    }
    const body = await searchRes.json();
    const issues = body.issues || [];
    allIssues.push(...issues);
    nextPageToken = body.nextPageToken;
    if (!issues.length || !nextPageToken) break;
  }
  return allIssues;
}

// Trim raw Jira issues+changelog down to just what every widget's math needs:
// SP value, creation date, status transitions, and ALL sprint add/remove events
// (not just the first — a ticket can be added/removed multiple times).
function extractRawSprintData(sprintId, issues, spFieldId) {
  const sprintIdStr = String(sprintId);
  const issueData = {};

  for (const issue of issues) {
    const sp = issue.fields?.[spFieldId];
    const transitions = [];
    const sprintEvents = [];

    for (const h of (issue.changelog?.histories || [])) {
      for (const item of (h.items || [])) {
        if (item.field === 'status') {
          transitions.push({ ts: h.created, from: item.fromString, to: item.toString });
        } else if (item.field === 'Sprint') {
          const toIds   = (item.to   || '').split(',').map(s => s.trim());
          const fromIds = (item.from || '').split(',').map(s => s.trim());
          if (toIds.includes(sprintIdStr) && !fromIds.includes(sprintIdStr)) {
            sprintEvents.push({ ts: h.created, type: 'added' });
          }
          if (fromIds.includes(sprintIdStr) && !toIds.includes(sprintIdStr)) {
            sprintEvents.push({ ts: h.created, type: 'removed' });
          }
        }
      }
    }
    transitions.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    sprintEvents.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));

    issueData[issue.key] = {
      sp: typeof sp === 'number' ? sp : 0,
      created: issue.fields?.created ?? null,
      transitions,
      sprintEvents,
    };
  }
  return issueData;
}

async function getSprintRawData({ projectKey, sprint, spFieldId, forceRefresh }) {
  const cacheKey = `raw:${sprint.id}:${spFieldId}`;

  if (!forceRefresh) {
    try {
      const cached = await storage.get(cacheKey);
      if (cached) {
        const stale = sprint.state === 'active' && (Date.now() - cached.cachedAt) > ACTIVE_CACHE_TTL_MS;
        if (!stale) return { issueData: cached.issueData, fromCache: true };
      }
    } catch (_) {}
  }

  const issues = await fetchSprintIssues(projectKey, sprint.id, spFieldId);
  const issueData = extractRawSprintData(sprint.id, issues, spFieldId);

  try {
    await storage.set(cacheKey, { issueData, cachedAt: Date.now() });
  } catch (_) {}

  return { issueData, fromCache: false };
}

// ── Shared: business days + committed scope + daily scope-delta bucketing ────
// Both the burndown lines and the scope-change chart/table need the same
// "committed scope" and "per-day net scope delta" numbers, so they're computed
// once here and consumed by both.

function getBusinessDays(startDateStr, endDateStr) {
  const days = [];
  const end = new Date(endDateStr + 'T00:00:00Z');
  const cur = new Date(startDateStr + 'T00:00:00Z');
  while (cur <= end) {
    const dow = cur.getUTCDay();
    if (dow !== 0 && dow !== 6) days.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return days;
}

// Match the reference script's snap_to_biz_day: only roll Saturday/Sunday
// forward to Monday. Weekday dates that fall BEFORE the sprint start are
// returned as-is (outside bizDays), so they're never applied to running scope.
// This prevents pre-sprint "added" events from being mapped to day 1 and
// double-counting SP that's already in initialScope.
function snapToBizDay(isoStr) {
  const d = new Date(isoStr.slice(0, 10) + 'T12:00:00Z');
  const dow = d.getUTCDay();
  if (dow === 6) d.setUTCDate(d.getUTCDate() + 2); // Saturday → Monday
  if (dow === 0) d.setUTCDate(d.getUTCDate() + 1); // Sunday   → Monday
  return d.toISOString().slice(0, 10);
}

function dayLabel(dayStr) {
  return new Date(dayStr + 'T12:00:00Z').toLocaleDateString('en-AU', { day: '2-digit', month: 'short' });
}

// Computes: committed (grace-window) scope, per-day net delta, and the first
// "excluded"/removed timestamp per issue (used to gate later calcs).
//
// graceWindowHours defines "committed": anything added to the sprint within
// that many hours of sprint.startDate counts as committed scope rather than
// mid-sprint scope creep. Default 12h matches the reference tool, but this
// only works if startDate reflects when the sprint was actually started. If
// a sprint's start date was backdated (started late, with an earlier date
// entered in the Start Sprint dialog), widen this to cover the gap between
// the entered start date and the real planning/activation date.
function computeScopeFoundation(sprint, issueData, statusMapping, bizDays, graceWindowHours = 12) {
  const startDate = bizDays[0];
  const endDate   = bizDays[bizDays.length - 1];
  const graceCutoffMs = new Date(sprint.startDate).getTime() + graceWindowHours * 3600 * 1000;

  const initialCommitted = {};
  const scopeDeltaByDay  = {};
  const removedTsByKey   = {};
  const nrTsByKey        = {};

  const addDelta = (day, sp) => {
    if (day >= startDate && day <= endDate) scopeDeltaByDay[day] = (scopeDeltaByDay[day] || 0) + sp;
  };

  for (const [key, issue] of Object.entries(issueData)) {
    const sp = issue.sp || 0;
    const firstAdd = issue.sprintEvents.find(e => e.type === 'added');
    const firstRemove = issue.sprintEvents.find(e => e.type === 'removed');
    if (firstRemove) removedTsByKey[key] = firstRemove.ts;

    // Committed scope: in sprint from the start (no add event, or created before
    // the sprint even existed) or added within the grace window.
    const addTs = firstAdd?.ts ?? issue.created;
    if (!addTs || Date.parse(addTs) <= graceCutoffMs) {
      initialCommitted[key] = sp;
    }

    // Every add/remove event nudges the running scope on the day it happened.
    // snapToBizDay only rolls weekends → Monday; pre-sprint weekday events
    // return a date before startDate and are filtered out by addDelta's range check.
    for (const ev of issue.sprintEvents) {
      addDelta(snapToBizDay(ev.ts), ev.type === 'added' ? sp : -sp);
    }

    // First transition into an "excluded" status (e.g. "Not Required") removes
    // the ticket's SP from scope on that day.
    const nrTrans = issue.transitions.find(t => statusMapping[t.to] === 'excluded');
    if (nrTrans) {
      nrTsByKey[key] = nrTrans.ts;
      addDelta(snapToBizDay(nrTrans.ts), -sp);
    }
  }

  const initialScope = Object.values(initialCommitted).reduce((s, v) => s + v, 0);
  return { initialScope, scopeDeltaByDay, removedTsByKey, nrTsByKey, graceCutoffMs };
}

// ── TRI-Burndown: ideal / dev remaining / review remaining / remaining ───────

function computeBurndown(sprint, issueData, statusMapping, graceWindowHours, clientTodayISO) {
  const startDate = sprint.startDate?.slice(0, 10);
  const endDate   = sprint.endDate?.slice(0, 10);
  if (!startDate || !endDate) return null;

  // Resolver functions run server-side in UTC, so "today" per new Date() can
  // lag a calendar day behind for sites east of UTC (e.g. still "yesterday"
  // in UTC during the morning in Sydney/AEST), silently chopping today off
  // the chart. The browser knows the viewer's actual local calendar date, so
  // prefer that when the frontend supplies it.
  const todayISO      = clientTodayISO || new Date().toISOString().slice(0, 10);
  const effectiveEnd  = todayISO < endDate ? todayISO : endDate;
  const bizDays       = getBusinessDays(startDate, endDate);
  if (!bizDays.length) return null;

  const { initialScope, scopeDeltaByDay, removedTsByKey, nrTsByKey } =
    computeScopeFoundation(sprint, issueData, statusMapping, bizDays, graceWindowHours);

  const allKeys = Object.keys(issueData);
  const n = bizDays.length;

  // First 'done' transition per key
  const doneTsByKey = {};
  for (const key of allKeys) {
    const t = issueData[key].transitions.find(t => statusMapping[t.to] === 'done');
    if (t) doneTsByKey[key] = t.ts;
  }

  function statusAt(key, eodMs) {
    const trans = issueData[key].transitions;
    if (!trans.length) return 'unknown';
    let st = trans[0].from || 'unknown';
    for (const t of trans) {
      if (Date.parse(t.ts) <= eodMs) st = t.to;
      else break;
    }
    return st;
  }

  const labels          = [];
  const idealSeries     = [];
  const devRemSeries    = [];
  const reviewRemSeries = [];
  const remainSeries    = [];

  let runningScope = initialScope;

  for (let i = 0; i < n; i++) {
    const day = bizDays[i];
    runningScope += (scopeDeltaByDay[day] || 0);

    idealSeries.push(n > 1 ? Math.round(initialScope * (n - 1 - i) / (n - 1) * 10) / 10 : 0);
    labels.push(dayLabel(day));

    if (day > effectiveEnd) {
      devRemSeries.push(null);
      reviewRemSeries.push(null);
      remainSeries.push(null);
      continue;
    }

    const eodMs = Date.parse(day + 'T23:59:59.999Z');
    let doneSp = 0, devSp = 0, reviewSp = 0;

    for (const key of allKeys) {
      const sp = issueData[key].sp || 0;
      if (!sp) continue;
      if (nrTsByKey[key]      && Date.parse(nrTsByKey[key])      <= eodMs) continue;
      if (removedTsByKey[key] && Date.parse(removedTsByKey[key]) <= eodMs) continue;

      if (doneTsByKey[key] && Date.parse(doneTsByKey[key]) <= eodMs) doneSp += sp;

      const phase = statusMapping[statusAt(key, eodMs)] || 'backlog';
      if (phase === 'review' || phase === 'test' || phase === 'done') devSp    += sp;
      if (phase === 'test'   || phase === 'done')                     reviewSp += sp;
    }

    devRemSeries.push(Math.round((runningScope - devSp)    * 10) / 10);
    reviewRemSeries.push(Math.round((runningScope - reviewSp) * 10) / 10);
    remainSeries.push(Math.round((runningScope - doneSp)   * 10) / 10);
  }

  return {
    labels,
    ideal:          idealSeries,
    devRem:         devRemSeries,
    reviewRem:      reviewRemSeries,
    remaining:      remainSeries,
    committedScope: initialScope,
    finalScope:     runningScope,
    sprintName:     sprint.name,
    sprintState:    sprint.state,
    startDate,
    endDate,
  };
}

resolver.define('getBurndownData', async ({ payload }) => {
  const { sprintMode, sprintId, spFieldId, statusMapping, projectKey, forceRefresh, graceWindowHours, todayISO } = payload ?? {};
  if (!spFieldId || !statusMapping || !projectKey || (sprintMode !== 'active' && !sprintId)) {
    return { error: 'Missing required config.' };
  }

  const resolved = await resolveSprint({ projectKey, sprintMode, sprintId });
  if (resolved.error) return { error: resolved.error };
  const sprint = resolved.sprint;

  let issueData, fromCache;
  try {
    ({ issueData, fromCache } = await getSprintRawData({ projectKey, sprint, spFieldId, forceRefresh }));
  } catch (e) {
    return { error: e.message };
  }

  const data = computeBurndown(sprint, issueData, statusMapping, graceWindowHours, todayISO);
  if (!data) return { error: 'Could not compute burndown — check sprint dates.' };
  data.spaceName = await getSpaceName(projectKey);

  return { data, fromCache };
});

// ── TRI-Scope-Change: daily scope-delta chart + Sprint Change Events table ────

function computeScopeChangeData(sprint, issueData, statusMapping, graceWindowHours) {
  const startDate = sprint.startDate?.slice(0, 10);
  const endDate   = sprint.endDate?.slice(0, 10);
  if (!startDate || !endDate) return null;

  const bizDays = getBusinessDays(startDate, endDate);
  if (!bizDays.length) return null;

  const { initialScope, scopeDeltaByDay } =
    computeScopeFoundation(sprint, issueData, statusMapping, bizDays, graceWindowHours);

  const labels = bizDays.map(dayLabel);
  const scopeDelta = bizDays.map(day => scopeDeltaByDay[day] || 0);

  // Event-level rows for the table — every recorded add/remove/excluded event,
  // even ones outside the sprint's date bounds (matches the reference tool,
  // which surfaces the full audit trail with a caveat rather than filtering).
  const events = [];
  for (const [key, issue] of Object.entries(issueData)) {
    const sp = issue.sp || 0;
    for (const ev of issue.sprintEvents) {
      events.push({ key, ts: ev.ts, sp: ev.type === 'added' ? sp : -sp });
    }
    for (const t of issue.transitions) {
      if (statusMapping[t.to] === 'excluded') {
        events.push({ key, ts: t.ts, sp: -sp });
      }
    }
  }
  events.sort((a, b) => a.key.localeCompare(b.key));

  return {
    labels,
    scopeDelta,
    events,
    committedScope: initialScope,
    sprintName:  sprint.name,
    sprintState: sprint.state,
    startDate,
    endDate,
  };
}

resolver.define('getScopeChangeData', async ({ payload }) => {
  const { sprintMode, sprintId, spFieldId, statusMapping, projectKey, forceRefresh, graceWindowHours } = payload ?? {};
  if (!spFieldId || !statusMapping || !projectKey || (sprintMode !== 'active' && !sprintId)) {
    return { error: 'Missing required config.' };
  }

  const resolved = await resolveSprint({ projectKey, sprintMode, sprintId });
  if (resolved.error) return { error: resolved.error };
  const sprint = resolved.sprint;

  let issueData, fromCache;
  try {
    ({ issueData, fromCache } = await getSprintRawData({ projectKey, sprint, spFieldId, forceRefresh }));
  } catch (e) {
    return { error: e.message };
  }

  const data = computeScopeChangeData(sprint, issueData, statusMapping, graceWindowHours);
  if (!data) return { error: 'Could not compute scope changes — check sprint dates.' };
  data.spaceName = await getSpaceName(projectKey);

  return { data, fromCache };
});

// ── TRI-Rework: daily rework-event chart + Sprint Rework Events table ────────
// Rework = a ticket leaving a 'test'-phase status to anywhere other than
// 'done' or 'excluded' (e.g. Testing kicked back to In Progress) — a test
// failure sending work back, not a cancellation.

function computeReworkData(sprint, issueData, statusMapping) {
  const startDate = sprint.startDate?.slice(0, 10);
  const endDate   = sprint.endDate?.slice(0, 10);
  if (!startDate || !endDate) return null;

  const bizDays = getBusinessDays(startDate, endDate);
  if (!bizDays.length) return null;

  const reworkCountByDay = {};
  const addCount = (day) => {
    if (day >= startDate && day <= endDate) reworkCountByDay[day] = (reworkCountByDay[day] || 0) + 1;
  };

  const events = [];
  for (const [key, issue] of Object.entries(issueData)) {
    const sp = issue.sp || 0;
    for (const t of issue.transitions) {
      const fromPhase = statusMapping[t.from];
      const toPhase   = statusMapping[t.to];
      if (fromPhase === 'test' && toPhase !== 'done' && toPhase !== 'excluded') {
        events.push({ key, ts: t.ts, sp });
        addCount(snapToBizDay(t.ts));
      }
    }
  }
  events.sort((a, b) => a.key.localeCompare(b.key));

  const labels = bizDays.map(dayLabel);
  const reworkCount = bizDays.map(day => reworkCountByDay[day] || 0);

  return {
    labels,
    reworkCount,
    events,
    sprintName:  sprint.name,
    sprintState: sprint.state,
    startDate,
    endDate,
  };
}

resolver.define('getReworkData', async ({ payload }) => {
  const { sprintMode, sprintId, spFieldId, statusMapping, projectKey, forceRefresh } = payload ?? {};
  if (!spFieldId || !statusMapping || !projectKey || (sprintMode !== 'active' && !sprintId)) {
    return { error: 'Missing required config.' };
  }

  const resolved = await resolveSprint({ projectKey, sprintMode, sprintId });
  if (resolved.error) return { error: resolved.error };
  const sprint = resolved.sprint;

  let issueData, fromCache;
  try {
    ({ issueData, fromCache } = await getSprintRawData({ projectKey, sprint, spFieldId, forceRefresh }));
  } catch (e) {
    return { error: e.message };
  }

  const data = computeReworkData(sprint, issueData, statusMapping);
  if (!data) return { error: 'Could not compute rework events — check sprint dates.' };
  data.spaceName = await getSpaceName(projectKey);

  return { data, fromCache };
});

// ── TRI-Cycle-Time: "Cycle Time Per Item" table ───────────────────────────────
// Tracks business hours (configurable working-hours window + UTC offset) spent
// in each of 4 buckets — In Progress, Blocked, Code Review, Test — per issue,
// converted to a story-point-equivalent for estimate-vs-actual comparison.

// Business hours between two instants within a fixed daily working window.
// The offset is a constant (no DST), so shifting both instants by it and
// treating the result as UTC gives correct local weekday/hour-of-day math —
// the same trick used by snapToBizDay elsewhere in this file.
function businessHoursBetween(startTs, endTs, workStartHour, workEndHour, utcOffsetHours) {
  const start = Date.parse(startTs);
  const end   = Date.parse(endTs);
  if (!start || !end || end <= start) return 0;

  const offsetMs = utcOffsetHours * 3600 * 1000;
  const startLocal = start + offsetMs;
  const endLocal   = end + offsetMs;
  const DAY_MS = 86400000;

  let total = 0;
  let dayStartLocal = Math.floor(startLocal / DAY_MS) * DAY_MS;
  const lastDayLocal = Math.floor(endLocal / DAY_MS) * DAY_MS;

  while (dayStartLocal <= lastDayLocal) {
    const dow = new Date(dayStartLocal).getUTCDay();
    if (dow !== 0 && dow !== 6) {
      const windowStart = dayStartLocal + workStartHour * 3600 * 1000;
      const windowEnd   = dayStartLocal + workEndHour * 3600 * 1000;
      const segStart = Math.max(startLocal, windowStart);
      const segEnd   = Math.min(endLocal, windowEnd);
      if (segEnd > segStart) total += (segEnd - segStart) / 3600000;
    }
    dayStartLocal += DAY_MS;
  }
  return total;
}

function nearestFibonacci(value) {
  if (value <= 0) return 0;
  const fibs = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89];
  while (fibs[fibs.length - 1] < value) fibs.push(fibs[fibs.length - 1] + fibs[fibs.length - 2]);
  return fibs.reduce((best, f) => (Math.abs(f - value) < Math.abs(best - value) ? f : best), fibs[0]);
}

const CYCLE_TIME_BUCKETS = { dev: 'inProgress', blocked: 'blocked', review: 'codeReview', test: 'test' };

function computeCycleTimeData(sprint, issueData, statusMapping, opts) {
  const { hoursPerSp, workStartHour, workEndHour, utcOffsetHours } = opts;
  const sprintEndMs = Date.parse(sprint.endDate);
  const nowMs = Date.now();
  const effectiveNowMs = (sprintEndMs && sprintEndMs < nowMs) ? sprintEndMs : nowMs;

  const rows = [];
  for (const [key, issue] of Object.entries(issueData).sort((a, b) => a[0].localeCompare(b[0]))) {
    const totalsHours = { inProgress: 0, blocked: 0, codeReview: 0, test: 0 };
    const trans = issue.transitions;

    if (trans.length) {
      const segments = [];

      // Pre-first-transition segment (creation -> first transition), only when
      // the initial status is untracked — otherwise a truncated changelog could
      // silently dump pre-sprint backlog time into a tracked bucket.
      const first = trans[0];
      if (issue.created && first.ts && Date.parse(first.ts) > Date.parse(issue.created) &&
          !CYCLE_TIME_BUCKETS[statusMapping[first.from]]) {
        segments.push({ status: first.from, start: issue.created, end: first.ts });
      }

      for (let i = 0; i < trans.length - 1; i++) {
        segments.push({ status: trans[i].to, start: trans[i].ts, end: trans[i + 1].ts });
      }

      const last = trans[trans.length - 1];
      if (statusMapping[last.to] !== 'done') {
        segments.push({ status: last.to, start: last.ts, end: new Date(effectiveNowMs).toISOString() });
      }

      for (const seg of segments) {
        const bucket = CYCLE_TIME_BUCKETS[statusMapping[seg.status]];
        if (bucket) totalsHours[bucket] += businessHoursBetween(seg.start, seg.end, workStartHour, workEndHour, utcOffsetHours);
      }
    }

    const bucketData = {};
    for (const bucket of Object.values(CYCLE_TIME_BUCKETS)) {
      const hours = totalsHours[bucket];
      bucketData[bucket] = { hours, sp: hours ? nearestFibonacci(hours / hoursPerSp) : 0 };
    }

    // Total Cycle Time SP deliberately excludes Blocked — waiting isn't work.
    const totalCycleTimeSp = bucketData.inProgress.sp + bucketData.codeReview.sp + bucketData.test.sp;

    rows.push({
      key,
      spEstimate: issue.sp || null,
      totalCycleTimeSp: totalCycleTimeSp || null,
      ...bucketData,
    });
  }

  return {
    rows,
    sprintName:  sprint.name,
    sprintState: sprint.state,
    startDate: sprint.startDate?.slice(0, 10),
    endDate:   sprint.endDate?.slice(0, 10),
  };
}

resolver.define('getCycleTimeData', async ({ payload }) => {
  const {
    sprintMode, sprintId, spFieldId, statusMapping, projectKey, forceRefresh,
    hoursPerSp, workStartHour, workEndHour, utcOffsetHours,
  } = payload ?? {};
  if (!spFieldId || !statusMapping || !projectKey || (sprintMode !== 'active' && !sprintId)) {
    return { error: 'Missing required config.' };
  }

  const resolved = await resolveSprint({ projectKey, sprintMode, sprintId });
  if (resolved.error) return { error: resolved.error };
  const sprint = resolved.sprint;

  let issueData, fromCache;
  try {
    ({ issueData, fromCache } = await getSprintRawData({ projectKey, sprint, spFieldId, forceRefresh }));
  } catch (e) {
    return { error: e.message };
  }

  const numOr = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  const data = computeCycleTimeData(sprint, issueData, statusMapping, {
    hoursPerSp:     numOr(hoursPerSp, 4) || 4,
    workStartHour:  numOr(workStartHour, 9),
    workEndHour:    numOr(workEndHour, 17),
    utcOffsetHours: numOr(utcOffsetHours, 10),
  });
  data.spaceName = await getSpaceName(projectKey);

  return { data, fromCache };
});

exports.handler = resolver.getDefinitions();
