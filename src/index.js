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
    transitions.sort((a, b) => a.ts.localeCompare(b.ts));
    sprintEvents.sort((a, b) => a.ts.localeCompare(b.ts));

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

function snapToBizDay(isoStr, bizDays) {
  const d = isoStr.slice(0, 10);
  if (bizDays.includes(d)) return d;
  return bizDays.find(b => b >= d) ?? bizDays[bizDays.length - 1];
}

function dayLabel(dayStr) {
  return new Date(dayStr + 'T12:00:00Z').toLocaleDateString('en-AU', { day: '2-digit', month: 'short' });
}

// Computes: committed (grace-window) scope, per-day net delta, and the first
// "excluded"/removed timestamp per issue (used to gate later calcs).
function computeScopeFoundation(sprint, issueData, statusMapping, bizDays) {
  const startDate = bizDays[0];
  const endDate   = bizDays[bizDays.length - 1];
  const graceCutoffISO = new Date(new Date(sprint.startDate).getTime() + 12 * 3600 * 1000).toISOString();

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
    // the sprint even existed) or added within the 12h grace window.
    const addTs = firstAdd?.ts ?? issue.created;
    if (!addTs || addTs <= graceCutoffISO) {
      initialCommitted[key] = sp;
    }

    // Every add/remove event nudges the running scope on the day it happened —
    // mirrors the reference tool bucketing ALL membership-change events, not
    // just the first (a ticket can be added, dropped, and re-added).
    for (const ev of issue.sprintEvents) {
      const day = snapToBizDay(ev.ts, bizDays);
      addDelta(day, ev.type === 'added' ? sp : -sp);
    }

    // First transition into an "excluded" status (e.g. "Not Required") removes
    // the ticket's SP from scope on that day.
    const nrTrans = issue.transitions.find(t => statusMapping[t.to] === 'excluded');
    if (nrTrans) {
      nrTsByKey[key] = nrTrans.ts;
      addDelta(snapToBizDay(nrTrans.ts, bizDays), -sp);
    }
  }

  const initialScope = Object.values(initialCommitted).reduce((s, v) => s + v, 0);
  return { initialScope, scopeDeltaByDay, removedTsByKey, nrTsByKey, graceCutoffISO };
}

// ── TRI-Burndown: ideal / dev remaining / review remaining / remaining ───────

function computeBurndown(sprint, issueData, statusMapping) {
  const startDate = sprint.startDate?.slice(0, 10);
  const endDate   = sprint.endDate?.slice(0, 10);
  if (!startDate || !endDate) return null;

  const todayISO      = new Date().toISOString().slice(0, 10);
  const effectiveEnd  = todayISO < endDate ? todayISO : endDate;
  const bizDays       = getBusinessDays(startDate, endDate);
  if (!bizDays.length) return null;

  const { initialScope, scopeDeltaByDay, removedTsByKey, nrTsByKey } =
    computeScopeFoundation(sprint, issueData, statusMapping, bizDays);

  const allKeys = Object.keys(issueData);
  const n = bizDays.length;

  // First 'done' transition per key
  const doneTsByKey = {};
  for (const key of allKeys) {
    const t = issueData[key].transitions.find(t => statusMapping[t.to] === 'done');
    if (t) doneTsByKey[key] = t.ts;
  }

  function statusAt(key, eodISO) {
    const trans = issueData[key].transitions;
    if (!trans.length) return 'unknown';
    let st = trans[0].from || 'unknown';
    for (const t of trans) {
      if (t.ts <= eodISO) st = t.to;
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

    const eod = day + 'T23:59:59.999Z';
    let doneSp = 0, devSp = 0, reviewSp = 0;

    for (const key of allKeys) {
      const sp = issueData[key].sp || 0;
      if (!sp) continue;
      if (nrTsByKey[key]      && nrTsByKey[key]      <= eod) continue;
      if (removedTsByKey[key] && removedTsByKey[key] <= eod) continue;

      if (doneTsByKey[key] && doneTsByKey[key] <= eod) doneSp += sp;

      const phase = statusMapping[statusAt(key, eod)] || 'backlog';
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

  const data = computeBurndown(sprint, issueData, statusMapping);
  if (!data) return { error: 'Could not compute burndown — check sprint dates.' };

  return { data, fromCache };
});

// ── TRI-Scope-Change: daily scope-delta chart + Sprint Change Events table ────

function computeScopeChangeData(sprint, issueData, statusMapping) {
  const startDate = sprint.startDate?.slice(0, 10);
  const endDate   = sprint.endDate?.slice(0, 10);
  if (!startDate || !endDate) return null;

  const bizDays = getBusinessDays(startDate, endDate);
  if (!bizDays.length) return null;

  const { initialScope, scopeDeltaByDay } =
    computeScopeFoundation(sprint, issueData, statusMapping, bizDays);

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

  const data = computeScopeChangeData(sprint, issueData, statusMapping);
  if (!data) return { error: 'Could not compute scope changes — check sprint dates.' };

  return { data, fromCache };
});

exports.handler = resolver.getDefinitions();
