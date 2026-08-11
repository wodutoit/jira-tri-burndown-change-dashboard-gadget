const Resolver = require('@forge/resolver').default;
const { route, asUser } = require('@forge/api');
const { kvs } = require('@forge/kvs');
const crypto = require('crypto');

const resolver = new Resolver();

// Cache TTL for active sprints (ms). Closed sprints are cached forever.
const ACTIVE_CACHE_TTL_MS = 5 * 60 * 1000;

// Board-search's own `type` field ("scrum"/"kanban") is only meaningful for
// classic (company-managed) boards. Team-managed ("next-gen") project boards
// always report `type: "simple"` regardless of whether the project actually
// uses sprints — confirmed against a real team-managed Kanban board that
// Capacity was misreading as Scrum because of this. Probing sprint support
// directly disambiguates it: Jira returns 400 ("The board does not support
// sprints") for a board where sprints are switched off, and 200 otherwise —
// this works for classic boards too, so it's a safe universal fallback, only
// actually hit (one extra request) when `type` itself is inconclusive.
async function resolveBoardType(board) {
  if (board.type === 'scrum' || board.type === 'kanban') return board.type;
  const res = await asUser().requestJira(
    route`/rest/agile/1.0/board/${board.id}/sprint?maxResults=1`,
    { headers: { Accept: 'application/json' } }
  );
  return res.ok ? 'scrum' : 'kanban';
}

// ── Shared: board lookup (first board for a project, same convention used
// everywhere in this file) — also the only place that reads `board.type`
// ("scrum"/"kanban"), needed by TRI-Space-Capacity to pick which UI a project gets.
async function getBoardForProject(projectKey) {
  const res = await asUser().requestJira(
    route`/rest/agile/1.0/board?projectKeyOrId=${projectKey}&maxResults=1`,
    { headers: { Accept: 'application/json' } }
  );
  if (!res.ok) return { error: `Board search failed: ${res.status}` };
  const body = await res.json();
  const board = body.values?.[0];
  if (!board) return { error: 'No board found for this project.' };
  return { board: { id: board.id, type: await resolveBoardType(board) } };
}

// ── Shared: Epic story-point rollup ──────────────────────────────────────────
// Teams usually point child stories/tasks, not the Epic itself, so an Epic's own
// SP field is often blank or stale. Wherever this app reads an issue's SP value,
// an Epic with children uses the sum of its children's SP instead of its own
// field value; an Epic with no children (or whose children query comes back
// empty) falls back to its own value, unchanged from today's behavior.
// `parent = <epicKey>` is Jira Cloud's current unified hierarchy field for
// finding an Epic's children, working the same way in both team-managed and
// company-managed projects since Atlassian's hierarchy migration — if a site
// somehow doesn't support it, the query just comes back empty and the fallback
// (the Epic's own value) applies, so this never throws or breaks the pipeline.
//
// Known simplification: if a child issue is ALSO independently present in the
// same fetched issue batch as its Epic (e.g. both happen to land in the same
// sprint, or both match a Kanban status/date scan), that child's SP is counted
// once via its own row AND once via the Epic's rollup — the same class of
// documented tradeoff as the Kanban committed/velocity JQL split above, not
// silently ignored, but not solved with cross-issue dedup either, since Epics
// are not normally sprint/board items in the first place.
async function fetchEpicChildrenSp(epicKey, spFieldId) {
  let total = 0;
  let found = false;
  let nextPageToken;
  while (true) {
    const reqBody = { jql: `parent = ${epicKey}`, fields: [spFieldId], maxResults: 100 };
    if (nextPageToken) reqBody.nextPageToken = nextPageToken;
    const res = await asUser().requestJira(
      route`/rest/api/3/search/jql`,
      { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(reqBody) }
    );
    if (!res.ok) break;
    const body = await res.json();
    const children = body.issues || [];
    for (const c of children) {
      found = true;
      const sp = c.fields?.[spFieldId];
      total += typeof sp === 'number' ? sp : 0;
    }
    nextPageToken = body.nextPageToken;
    if (!children.length || !nextPageToken) break;
  }
  return found ? total : null;
}

function isEpicIssue(issue) {
  return issue.fields?.issuetype?.name === 'Epic';
}

// Resolves the SP value to use for each issue in one batch — Epics get their
// children queried in parallel, everything else passes through untouched.
async function resolveIssueSpValues(issues, spFieldId) {
  const epics = issues.filter(isEpicIssue);
  const rollups = await Promise.all(epics.map(async e => [e.key, await fetchEpicChildrenSp(e.key, spFieldId)]));
  const rollupByKey = new Map(rollups);
  return new Map(issues.map(issue => {
    const rollup = isEpicIssue(issue) ? rollupByKey.get(issue.key) : null;
    const own = issue.fields?.[spFieldId];
    const sp = rollup != null ? rollup : (typeof own === 'number' ? own : 0);
    return [issue.key, sp];
  }));
}

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

async function fetchProjectStatuses(projectKey) {
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
}

// Jira's own status category (new/indeterminate/done) — used by
// TRI-Space-Capacity instead of the custom 7-value status→phase mapping the
// other gadgets use, since Capacity only needs "not started / in progress /
// done", not Review/Test/Blocked distinctions.
function toCategoryMap(statuses) {
  return Object.fromEntries(statuses.map(s => [s.name, s.categoryKey]));
}

resolver.define('getProjectStatuses', async ({ payload }) => {
  const { projectKey } = payload ?? {};
  if (!projectKey) return { statuses: [], error: 'No project key.' };
  try {
    const { statuses, error } = await fetchProjectStatuses(projectKey);
    if (error) return { statuses: [], error };
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
    const { board, error: boardError } = await getBoardForProject(projectKey);
    if (boardError) return { sprints: [], error: boardError };
    const boardId = board.id;

    // The Agile API always returns sprints oldest-first with no server-side
    // sort option. To get the 10 MOST RECENTLY closed sprints (not the 10
    // oldest), first ask for the total closed count, then fetch just the
    // final page.
    const closedCountRes = await asUser().requestJira(
      route`/rest/agile/1.0/board/${boardId}/sprint?state=closed&maxResults=1`,
      { headers: { Accept: 'application/json' } }
    );
    const closedTotal = closedCountRes.ok ? (await closedCountRes.json()).total ?? 0 : 0;
    const closedStartAt = Math.max(0, closedTotal - 10);

    const [activeRes, closedRes] = await Promise.all([
      asUser().requestJira(
        route`/rest/agile/1.0/board/${boardId}/sprint?state=active&maxResults=10`,
        { headers: { Accept: 'application/json' } }
      ),
      asUser().requestJira(
        route`/rest/agile/1.0/board/${boardId}/sprint?state=closed&startAt=${closedStartAt}&maxResults=10`,
        { headers: { Accept: 'application/json' } }
      ),
    ]);

    const activeBody = activeRes.ok ? await activeRes.json() : { values: [] };
    const closedBody = closedRes.ok ? await closedRes.json() : { values: [] };

    const closedSprints = (closedBody.values || [])
      .map(s => ({ id: s.id, name: s.name, state: 'closed', startDate: s.startDate, endDate: s.endDate }))
      // Most recently closed first, by end date (not API/creation order — a
      // sprint's dates can be edited independently of when it was created).
      .sort((a, b) => Date.parse(b.endDate || b.startDate || 0) - Date.parse(a.endDate || a.startDate || 0));

    const sprints = [
      ...(activeBody.values || []).map(s => ({ id: s.id, name: s.name, state: 'active', startDate: s.startDate, endDate: s.endDate })),
      ...closedSprints,
    ];

    return { sprints, boardId };
  } catch (e) {
    return { sprints: [], error: e.message };
  }
});

// ── TRI-Sprint-Filter: shared dashboard-level Space+Sprint selection ─────────
// Lets one "TRI Sprint Filter" gadget drive the Space/Sprint used by every
// other TRI-* gadget on the same dashboard that opts in via its
// "Use dashboard sprint filter" edit-mode toggle. Scoped per dashboard
// (context.extension.dashboard.id) so separate dashboards never share a
// selection. Live updates while the dashboard stays open are pushed via the
// Custom UI events bridge (see useDashboardFilter.js) — this storage value is
// only the durable fallback so gadgets that mount before/after the filter
// gadget, or after a page refresh, still pick up the current selection.

resolver.define('getDashboardSprintFilter', async ({ context }) => {
  const dashboardId = context?.extension?.dashboard?.id;
  if (!dashboardId) return { filter: null };
  try {
    const filter = await kvs.get(`dashboard-filter:${dashboardId}`);
    return { filter: filter ?? null };
  } catch (e) {
    return { filter: null, error: e.message };
  }
});

resolver.define('setDashboardSprintFilter', async ({ payload, context }) => {
  const dashboardId = context?.extension?.dashboard?.id;
  if (!dashboardId) return { error: 'No dashboard context.' };
  const { projectKey, sprintMode, sprintId, sprintName } = payload ?? {};
  if (!projectKey || !sprintMode) return { error: 'Missing projectKey/sprintMode.' };
  const filter = {
    projectKey,
    sprintMode,
    sprintId: sprintId ?? null,
    sprintName: sprintName ?? '',
    updatedAt: Date.now(),
  };
  try {
    await kvs.set(`dashboard-filter:${dashboardId}`, filter);
    return { ok: true, filter };
  } catch (e) {
    return { error: e.message };
  }
});

// ── Shared: resolve which sprint a widget instance is rendering ───────────────
// 'active' mode does a fresh lookup every call so widgets never go stale when a
// sprint closes; 'fixed' mode pins to a specific (often closed) sprint id.

async function resolveActiveSprint(projectKey) {
  const { board, error } = await getBoardForProject(projectKey);
  if (error) return { error };

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
    const cached = await kvs.get(cacheKey);
    if (cached) return cached;
  } catch (_) {}

  const res = await asUser().requestJira(
    route`/rest/api/3/project/${projectKey}`,
    { headers: { Accept: 'application/json' } }
  );
  const name = res.ok ? (await res.json()).name : projectKey;

  try { await kvs.set(cacheKey, name); } catch (_) {}
  return name;
}

resolver.define('getSpaceName', async ({ payload }) => {
  const { projectKey } = payload ?? {};
  if (!projectKey) return { spaceName: '' };
  return { spaceName: await getSpaceName(projectKey) };
});

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
async function extractRawSprintData(sprintId, issues, spFieldId) {
  const sprintIdStr = String(sprintId);
  const spByKey = await resolveIssueSpValues(issues, spFieldId);
  const issueData = {};

  for (const issue of issues) {
    const sp = spByKey.get(issue.key);
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
      sp,
      summary: issue.fields?.summary ?? '',
      created: issue.fields?.created ?? null,
      currentStatus: issue.fields?.status?.name ?? null,
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
      const cached = await kvs.get(cacheKey);
      if (cached) {
        const stale = sprint.state === 'active' && (Date.now() - cached.cachedAt) > ACTIVE_CACHE_TTL_MS;
        if (!stale) return { issueData: cached.issueData, fromCache: true };
      }
    } catch (_) {}
  }

  const issues = await fetchSprintIssues(projectKey, sprint.id, spFieldId);
  const issueData = await extractRawSprintData(sprint.id, issues, spFieldId);

  try {
    await kvs.set(cacheKey, { issueData, cachedAt: Date.now() });
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

// A closed sprint's `endDate` is the originally *scheduled* end date — Jira
// never updates it if the sprint actually runs past that date. The real
// close time lives in `completeDate`, only present once a sprint is closed,
// recording the actual moment "Complete Sprint" was clicked. If a sprint ran
// late, using `endDate` alone truncates every chart/table's date range
// before the sprint's real last day of activity. Mirrors the existing
// Commitment Grace Window escape hatch for backdated start dates, but for
// the end of the sprint instead.
function actualSprintEnd(sprint) {
  if (sprint.completeDate && (!sprint.endDate || Date.parse(sprint.completeDate) > Date.parse(sprint.endDate))) {
    return sprint.completeDate;
  }
  return sprint.endDate;
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

// Reconstructs an issue's status as of a given instant from its transition
// history. Shared by TRI-Burndown (statusMapping-based phase lookup) and
// TRI-Space-Capacity's Kanban committed calc (status whitelist lookup).
// `currentStatus` is the fallback for an issue with ZERO recorded status
// transitions — Jira's changelog only records CHANGES, so a ticket created
// directly into a status and never moved has no transition to infer its
// original status from. Since it's never changed, its current status IS what
// it was at any point in its history, including `atMs`. Without this
// fallback, such a ticket resolved to the literal string 'unknown', which
// can't match any real status name or category — a real bug found 2026-07-29
// where Kanban tickets created straight into a custom "committed" status
// (never transitioned since) were silently never counted as committed.
function statusAt(transitions, atMs, currentStatus) {
  if (!transitions.length) return currentStatus ?? 'unknown';
  let st = transitions[0].from || 'unknown';
  for (const t of transitions) {
    if (Date.parse(t.ts) <= atMs) st = t.to;
    else break;
  }
  return st;
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
function graceCutoffMs(startDateISO, graceWindowHours) {
  return new Date(startDateISO).getTime() + graceWindowHours * 3600 * 1000;
}

function computeScopeFoundation(sprint, issueData, statusMapping, bizDays, graceWindowHours = 12) {
  const startDate = bizDays[0];
  const endDate   = bizDays[bizDays.length - 1];
  const cutoffMs = graceCutoffMs(sprint.startDate, graceWindowHours);

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
    if (!addTs || Date.parse(addTs) <= cutoffMs) {
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
  return { initialScope, scopeDeltaByDay, removedTsByKey, nrTsByKey, graceCutoffMs: cutoffMs };
}

// ── TRI-Burndown: ideal / dev remaining / review remaining / remaining ───────

function computeBurndown(sprint, issueData, statusMapping, graceWindowHours, clientTodayISO) {
  const startDate = sprint.startDate?.slice(0, 10);
  const endDate   = actualSprintEnd(sprint)?.slice(0, 10);
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

      const phase = statusMapping[statusAt(issueData[key].transitions, eodMs, issueData[key].currentStatus)] || 'backlog';
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
  const endDate   = actualSprintEnd(sprint)?.slice(0, 10);
  if (!startDate || !endDate) return null;

  const bizDays = getBusinessDays(startDate, endDate);
  if (!bizDays.length) return null;

  const { initialScope, scopeDeltaByDay } =
    computeScopeFoundation(sprint, issueData, statusMapping, bizDays, graceWindowHours);

  const labels = bizDays.map(dayLabel);
  const scopeDelta = bizDays.map(day => scopeDeltaByDay[day] || 0);

  // Event-level rows for the table — only events that actually land a delta on
  // the chart above (same snapToBizDay + startDate/endDate range check as
  // addDelta in computeScopeFoundation). Events outside that range don't move
  // any bar, so they're excluded here too rather than showing an entry the
  // chart can't explain.
  const events = [];
  for (const [key, issue] of Object.entries(issueData)) {
    const sp = issue.sp || 0;
    for (const ev of issue.sprintEvents) {
      const day = snapToBizDay(ev.ts);
      if (day < startDate || day > endDate) continue;
      events.push({ key, summary: issue.summary, ts: ev.ts, sp: ev.type === 'added' ? sp : -sp });
    }
    for (const t of issue.transitions) {
      if (statusMapping[t.to] === 'excluded') {
        const day = snapToBizDay(t.ts);
        if (day < startDate || day > endDate) continue;
        events.push({ key, summary: issue.summary, ts: t.ts, sp: -sp });
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
  const endDate   = actualSprintEnd(sprint)?.slice(0, 10);
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
        const day = snapToBizDay(t.ts);
        if (day < startDate || day > endDate) continue;
        events.push({ key, summary: issue.summary, ts: t.ts, sp });
        addCount(day);
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
  const sprintEndMs = Date.parse(actualSprintEnd(sprint));
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
      summary: issue.summary,
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
    endDate:   actualSprintEnd(sprint)?.slice(0, 10),
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

// ── TRI-Velocity: Capacity/Committed/Velocity per closed sprint or completed
// iteration, per space ───────────────────────────────────────────────────────
// This gadget no longer computes anything itself — it reads the same numbers
// already saved by that space's Capacity tab (capacity-rows for Scrum,
// kanban-iterations for Kanban), so a space's velocity trend here always
// matches what its Capacity page shows, and there's only one place (Capacity)
// that actually runs the grace-window/status-category math. This is also why
// TRI Velocity's Edit screen only offers spaces with Capacity Planning turned
// on (getCapacityEnabledProjects above) — a space with Capacity off has never
// had these numbers computed at all. A row whose Committed/Velocity was never
// calculated on the Capacity tab (no "Get SP Count"/"Get Velocity" click yet)
// simply shows 0 here — this gadget never triggers that calculation itself.

async function fetchClosedSprintsForBoard(projectKey, limit) {
  const { board, error } = await getBoardForProject(projectKey);
  if (error) return { error };

  const countRes = await asUser().requestJira(
    route`/rest/agile/1.0/board/${board.id}/sprint?state=closed&maxResults=1`,
    { headers: { Accept: 'application/json' } }
  );
  const total = countRes.ok ? (await countRes.json()).total ?? 0 : 0;
  const startAt = Math.max(0, total - limit);

  const res = await asUser().requestJira(
    route`/rest/agile/1.0/board/${board.id}/sprint?state=closed&startAt=${startAt}&maxResults=${limit}`,
    { headers: { Accept: 'application/json' } }
  );
  const body = res.ok ? await res.json() : { values: [] };

  // Oldest → newest, so the chart reads left-to-right chronologically.
  const sprints = (body.values || [])
    .sort((a, b) => Date.parse(a.endDate || a.startDate || 0) - Date.parse(b.endDate || b.startDate || 0));

  return { sprints };
}

// Committed = the same grace-window "initial scope" TRI Burndown uses as its
// day-1 height. Completed = SP still in the sprint (not removed/excluded) in
// a "done"-mapped status by the sprint's actual close.
function computeVelocity(sprint, issueData, statusMapping, graceWindowHours = 12) {
  const startDate = sprint.startDate?.slice(0, 10);
  const endDate   = actualSprintEnd(sprint)?.slice(0, 10);
  if (!startDate || !endDate) return null;

  const bizDays = getBusinessDays(startDate, endDate);
  if (!bizDays.length) return null;

  const { initialScope, removedTsByKey, nrTsByKey } =
    computeScopeFoundation(sprint, issueData, statusMapping, bizDays, graceWindowHours);

  const eodMs = Date.parse(bizDays[bizDays.length - 1] + 'T23:59:59.999Z');
  let completed = 0;
  for (const [key, issue] of Object.entries(issueData)) {
    const sp = issue.sp || 0;
    if (!sp) continue;
    if (nrTsByKey[key]      && Date.parse(nrTsByKey[key])      <= eodMs) continue;
    if (removedTsByKey[key] && Date.parse(removedTsByKey[key]) <= eodMs) continue;
    const doneTrans = issue.transitions.find(t => statusMapping[t.to] === 'done');
    if (doneTrans && Date.parse(doneTrans.ts) <= eodMs) completed += sp;
  }

  return {
    committed: Math.round(initialScope * 10) / 10,
    completed: Math.round(completed * 10) / 10,
    endDate,
  };
}

// Matches the closed-sprint cap used elsewhere (getSprintsForProject) — the
// viewer's 1-10 sprint-count selector slices this client-side rather than
// triggering a refetch per change.
const VELOCITY_SPRINT_CAP = 10;

resolver.define('getVelocityData', async ({ payload }) => {
  const { spaces } = payload ?? {};
  if (!Array.isArray(spaces) || spaces.length === 0) return { spaces: [], error: 'No spaces configured.' };

  const numOr = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

  const results = [];
  for (const space of spaces) {
    const { projectKey } = space ?? {};
    if (!projectKey) {
      results.push({ projectKey, name: projectKey, sprints: [], error: 'Incomplete configuration.' });
      continue;
    }
    try {
      const name = await getSpaceName(projectKey);
      const { board, error: boardErr } = await getBoardForProject(projectKey);
      if (boardErr) { results.push({ projectKey, name, sprints: [], error: boardErr }); continue; }
      const settings = await getCapacitySettingsFor(projectKey);

      let periods;
      if (board.type === 'kanban') {
        const iterations = (await getIterations(projectKey))
          .filter(it => it.status === 'completed')
          .sort((a, b) => Date.parse(a.endDate || a.startDate || 0) - Date.parse(b.endDate || b.startDate || 0))
          .slice(-VELOCITY_SPRINT_CAP);
        periods = iterations.map(it => ({
          id: it.id, name: it.name, startDate: it.startDate, endDate: it.endDate,
          capacity: numOr(it.capacitySp, settings.baseCapacitySp),
          committed: numOr(it.committedSp, 0),
          velocity: numOr(it.velocitySp, 0),
        }));
      } else {
        const { sprints, error: sprintErr } = await fetchClosedSprintsForBoard(projectKey, VELOCITY_SPRINT_CAP);
        if (sprintErr) { results.push({ projectKey, name, sprints: [], error: sprintErr }); continue; }
        const overrides = await getCapacityRows(projectKey);
        periods = sprints.map(s => {
          const row = overrides[s.id] || {};
          return {
            id: s.id, name: s.name, startDate: s.startDate, endDate: actualSprintEnd(s) || s.endDate,
            capacity: numOr(row.capacitySp, settings.baseCapacitySp),
            committed: numOr(row.committedSp, 0),
            velocity: numOr(row.velocitySp, 0),
          };
        });
      }
      results.push({ projectKey, name, sprints: periods });
    } catch (e) {
      results.push({ projectKey, name: projectKey, sprints: [], error: e.message });
    }
  }
  return { spaces: results };
});

// ── TRI-Space-Capacity: per-project "enable Capacity tab" toggle ────────────
// Stored as a Jira project entity property (not @forge/kvs) because Forge's
// jira:projectPage displayConditions.entityPropertyEqualTo can only read
// entity properties — it has no visibility into the app's own storage. See
// PROJECT-CONTEXT.md for why this is a project property and not kvs.
const CAPACITY_PROPERTY_KEY = 'tri-capacity-planning';

resolver.define('getCapacityPlanningEnabled', async ({ payload }) => {
  const { projectKey } = payload ?? {};
  if (!projectKey) return { enabled: false, error: 'No project key.' };
  try {
    const res = await asUser().requestJira(
      route`/rest/api/3/project/${projectKey}/properties/${CAPACITY_PROPERTY_KEY}`,
      { headers: { Accept: 'application/json' } }
    );
    if (res.status === 404) return { enabled: false };
    if (!res.ok) return { enabled: false, error: `Jira ${res.status}` };
    const body = await res.json();
    return { enabled: !!body.value?.enabled };
  } catch (e) {
    return { enabled: false, error: e.message };
  }
});

resolver.define('setCapacityPlanningEnabled', async ({ payload }) => {
  const { projectKey, enabled } = payload ?? {};
  if (!projectKey) return { error: 'No project key.' };
  try {
    const res = await asUser().requestJira(
      route`/rest/api/3/project/${projectKey}/properties/${CAPACITY_PROPERTY_KEY}`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !!enabled }),
      }
    );
    if (!res.ok) return { error: `Jira ${res.status}` };
    return { ok: true, enabled: !!enabled };
  } catch (e) {
    return { error: e.message };
  }
});

// TRI Velocity's Edit screen only offers spaces with Capacity Planning turned
// on, since it now reads Capacity's saved numbers instead of computing its
// own (see getVelocityData below). There's no bulk "projects with property X"
// search endpoint, so this checks each project's entity property individually
// — the same "up to 100 projects, one page" cap as getGadgetProjects, plus one
// extra property-check request per project. Bounded and one-off (Edit mode
// only), not a hot path.
resolver.define('getCapacityEnabledProjects', async ({ payload }) => {
  const { boardTypeFilter } = payload ?? {};
  try {
    const res = await asUser().requestJira(
      route`/rest/api/3/project/search?maxResults=100&orderBy=name`,
      { headers: { Accept: 'application/json' } }
    );
    if (!res.ok) return { projects: [], error: `Jira ${res.status}` };
    const body = await res.json();
    const all = (body.values || []).map(p => ({ id: p.id, key: p.key, name: p.name }));

    const flags = await Promise.all(all.map(async p => {
      try {
        const propRes = await asUser().requestJira(
          route`/rest/api/3/project/${p.key}/properties/${CAPACITY_PROPERTY_KEY}`,
          { headers: { Accept: 'application/json' } }
        );
        if (!propRes.ok) return false;
        const propBody = await propRes.json();
        return !!propBody.value?.enabled;
      } catch (_) {
        return false;
      }
    }));

    let enabled = all.filter((_, i) => flags[i]);

    // Only fetched when a caller actually needs it (e.g. the Kanban-only
    // gadgets' space pickers) — one extra board lookup per Capacity-enabled
    // project, same bounded/Edit-mode-only cost class as the property check above.
    if (boardTypeFilter) {
      const boardTypes = await Promise.all(enabled.map(async p => {
        try {
          const { board, error } = await getBoardForProject(p.key);
          if (error) return null;
          return await resolveBoardType(board);
        } catch (_) {
          return null;
        }
      }));
      enabled = enabled.filter((_, i) => boardTypes[i] === boardTypeFilter);
    }

    return { projects: enabled };
  } catch (e) {
    return { projects: [], error: e.message };
  }
});

// ── TRI-Space-Capacity: settings (Base Capacity, Iteration Length, SP Field,
// Grace Window, Kanban's "allow multiple active", Kanban's Committed-status
// whitelist) ─────────────────────────────────────────────────────────────────
// All stored in @forge/kvs (unlike the enable toggle above, these never need
// to be visible to a displayCondition, so there's no reason to use a Jira
// project property for them). Capacity deliberately does NOT use the other
// gadgets' custom 7-value status→phase mapping — see PROJECT-CONTEXT.md —
// Scrum still just uses Jira's built-in status category. Kanban's Committed
// calculation is the one exception: `kanbanCommittedStatuses` lets a project
// whitelist exactly which statuses count as committed, since category alone
// can't represent a custom status like "Team Estimated" that Jira categorizes
// as "To Do" but a team treats as already-committed (see
// defaultCommittedStatusNames() above).

const CAPACITY_SETTINGS_DEFAULTS = {
  baseCapacitySp: 20,
  defaultIterationLengthWeeks: 2,
  spFieldId: '',
  graceWindowHours: 12,
  kanbanAllowMultipleActive: false,
  boardTypeOverride: 'auto',
  kanbanCommittedStatuses: [],
  kanbanCommittedUsesLabelFilter: false,
};
const CAPACITY_BOARD_TYPE_OVERRIDE_OPTIONS = ['auto', 'scrum', 'kanban'];

// Extracted so TRI Velocity's getVelocityData (below) can look up a space's
// Base Capacity without duplicating the kvs-merge-with-defaults logic.
async function getCapacitySettingsFor(projectKey) {
  const saved = await kvs.get(`capacity-settings:${projectKey}`);
  return { ...CAPACITY_SETTINGS_DEFAULTS, ...(saved || {}) };
}

resolver.define('getCapacitySettings', async ({ payload }) => {
  const { projectKey } = payload ?? {};
  if (!projectKey) return { settings: CAPACITY_SETTINGS_DEFAULTS, error: 'No project key.' };
  try {
    return { settings: await getCapacitySettingsFor(projectKey) };
  } catch (e) {
    return { settings: CAPACITY_SETTINGS_DEFAULTS, error: e.message };
  }
});

resolver.define('setCapacitySettings', async ({ payload }) => {
  const { projectKey, settings } = payload ?? {};
  if (!projectKey || !settings) return { error: 'Missing project key or settings.' };
  const merged = {
    baseCapacitySp: Number(settings.baseCapacitySp) || 0,
    defaultIterationLengthWeeks: Number(settings.defaultIterationLengthWeeks) || 2,
    spFieldId: settings.spFieldId || '',
    graceWindowHours: Number(settings.graceWindowHours) || 12,
    kanbanAllowMultipleActive: !!settings.kanbanAllowMultipleActive,
    boardTypeOverride: CAPACITY_BOARD_TYPE_OVERRIDE_OPTIONS.includes(settings.boardTypeOverride)
      ? settings.boardTypeOverride : 'auto',
    kanbanCommittedStatuses: Array.isArray(settings.kanbanCommittedStatuses)
      ? settings.kanbanCommittedStatuses.filter(s => typeof s === 'string' && s)
      : [],
    kanbanCommittedUsesLabelFilter: !!settings.kanbanCommittedUsesLabelFilter,
  };
  try {
    await kvs.set(`capacity-settings:${projectKey}`, merged);
    return { ok: true, settings: merged };
  } catch (e) {
    return { error: e.message };
  }
});

resolver.define('getCapacityBoardInfo', async ({ payload }) => {
  const { projectKey } = payload ?? {};
  if (!projectKey) return { error: 'No project key.' };
  const { board, error } = await getBoardForProject(projectKey);
  if (error) return { error };
  const detectedType = board.type === 'kanban' ? 'kanban' : 'scrum';

  let override = 'auto';
  try {
    const settings = await kvs.get(`capacity-settings:${projectKey}`);
    if (CAPACITY_BOARD_TYPE_OVERRIDE_OPTIONS.includes(settings?.boardTypeOverride)) override = settings.boardTypeOverride;
  } catch (_) {}

  const boardType = override === 'auto' ? detectedType : override;
  return { boardId: board.id, boardType, detectedType };
});

// Every status mapped to 'done' or 'other' by Jira's own status category —
// lets Capacity reuse computeScopeFoundation/computeVelocity unchanged (they
// take a statusMapping) without pulling in the other gadgets' custom
// Backlog/Dev/Blocked/Review/Test/Done/Excluded mapping. 'excluded' never
// appears — Capacity has no equivalent concept.
function categoryBasedStatusMapping(categoryMap) {
  const mapping = {};
  for (const [name, cat] of Object.entries(categoryMap)) {
    mapping[name] = cat === 'done' ? 'done' : 'other';
  }
  return mapping;
}

async function getCapacityStatusMapping(projectKey) {
  const { statuses, error } = await fetchProjectStatuses(projectKey);
  if (error) return { error };
  return { statusMapping: categoryBasedStatusMapping(toCategoryMap(statuses)) };
}

// Kanban's Committed calculation used to rely solely on Jira's status
// category — but a status category is fixed by Jira and can't reflect a
// team's actual workflow. A team can have a custom status like "Team
// Estimated" that Jira categorizes as "To Do" but that the team treats as
// already-committed work. `kanbanCommittedStatuses` (a Capacity setting,
// Kanban-only) is an explicit whitelist of status names that overrides the
// category guess entirely once configured. This is the default used until a
// project customizes it — Committed's original spec is "in progress statuses
// at the start of the iteration", so the default is In Progress-category
// (`indeterminate`) only, not Done — a ticket that's been sitting in a
// terminal Done status since long before this iteration has nothing to do
// with it, even though it was presumably "committed" to whatever iteration
// actually finished it. Someone whose workflow genuinely needs a
// Done-categorized status counted (e.g. a "Deployed, pending sign-off" status
// Jira happens to categorize as Done) can still check it explicitly in
// TriCapacitySettingsPage.jsx's checklist.
function defaultCommittedStatusNames(categoryMap) {
  return Object.entries(categoryMap)
    .filter(([, cat]) => cat === 'indeterminate')
    .map(([name]) => name);
}

function jqlQuoteList(values) {
  return values.map(v => `"${String(v).replace(/"/g, '\\"')}"`).join(', ');
}

// ── TRI-Space-Capacity (Scrum): sprint list + Capacity/Committed/Velocity ────
// Sprints are real Jira objects — Committed/Velocity reuse computeScopeFoundation/
// computeVelocity exactly as TRI Burndown/Velocity do, just fed a status-category
// mapping (above) instead of a custom one. Per-row overrides (Capacity/Committed/
// Velocity) are stored in one KVS blob per project, not one key per row, so the
// sprint list only ever needs a single kvs.get to merge them in.

const CAPACITY_CLOSED_SPRINT_CAP = 10;
// "All" is intentionally bounded, not literally unlimited — same known-simplification
// class as this app's other pagination caps (see PROJECT-CONTEXT.md). A project with
// more closed sprints than this just sees its most recent CAPACITY_CLOSED_SPRINT_ALL_CAP.
const CAPACITY_CLOSED_SPRINT_ALL_CAP = 100;
const CAPACITY_CLOSED_LIMIT_OPTIONS = [3, 5, 10, 15];

function resolveClosedLimit(closedLimit) {
  if (closedLimit === 'all') return 'all';
  const n = Number(closedLimit);
  return CAPACITY_CLOSED_LIMIT_OPTIONS.includes(n) ? n : CAPACITY_CLOSED_SPRINT_CAP;
}

async function fetchSprintsByState(boardId, state, limit) {
  if (state === 'closed') {
    const countRes = await asUser().requestJira(
      route`/rest/agile/1.0/board/${boardId}/sprint?state=closed&maxResults=1`,
      { headers: { Accept: 'application/json' } }
    );
    const total = countRes.ok ? (await countRes.json()).total ?? 0 : 0;
    const effectiveLimit = limit === 'all' ? Math.min(total, CAPACITY_CLOSED_SPRINT_ALL_CAP) : limit;
    const startAt = Math.max(0, total - effectiveLimit);
    const res = await asUser().requestJira(
      route`/rest/agile/1.0/board/${boardId}/sprint?state=closed&startAt=${startAt}&maxResults=${effectiveLimit}`,
      { headers: { Accept: 'application/json' } }
    );
    const body = res.ok ? await res.json() : { values: [] };
    return body.values || [];
  }
  const res = await asUser().requestJira(
    route`/rest/agile/1.0/board/${boardId}/sprint?state=${state}&maxResults=${limit}`,
    { headers: { Accept: 'application/json' } }
  );
  const body = res.ok ? await res.json() : { values: [] };
  return body.values || [];
}

async function getCapacityRows(projectKey) {
  try {
    return (await kvs.get(`capacity-rows:${projectKey}`)) || {};
  } catch (_) {
    return {};
  }
}

async function updateCapacityRow(projectKey, sprintId, patch) {
  const rows = await getCapacityRows(projectKey);
  rows[sprintId] = { ...(rows[sprintId] || {}), ...patch };
  await kvs.set(`capacity-rows:${projectKey}`, rows);
  return rows[sprintId];
}

resolver.define('getScrumSprintsForCapacity', async ({ payload }) => {
  const { projectKey, closedLimit } = payload ?? {};
  if (!projectKey) return { sprints: [], error: 'No project key.' };
  try {
    const { board, error } = await getBoardForProject(projectKey);
    if (error) return { sprints: [], error };

    const [active, future, closed] = await Promise.all([
      fetchSprintsByState(board.id, 'active', 10),
      fetchSprintsByState(board.id, 'future', 20),
      fetchSprintsByState(board.id, 'closed', resolveClosedLimit(closedLimit)),
    ]);

    const overrides = await getCapacityRows(projectKey);
    const shape = (s, state) => ({
      id: s.id, name: s.name, state, startDate: s.startDate, endDate: s.endDate,
      completeDate: s.completeDate, goal: s.goal || '',
      capacitySp: null, committedSp: null, committedAt: null, velocitySp: null, velocityAt: null,
      ...(overrides[s.id] || {}),
    });

    const sprints = [
      ...active.map(s => shape(s, 'active')),
      ...future.map(s => shape(s, 'future')),
      ...closed
        .sort((a, b) => Date.parse(b.endDate || b.startDate || 0) - Date.parse(a.endDate || a.startDate || 0))
        .map(s => shape(s, 'closed')),
    ];

    return { sprints, boardId: board.id };
  } catch (e) {
    return { sprints: [], error: e.message };
  }
});

resolver.define('getSprintCommittedSp', async ({ payload }) => {
  const { projectKey, sprintId, spFieldId, graceWindowHours } = payload ?? {};
  if (!projectKey || !sprintId || !spFieldId) return { error: 'Missing config.' };
  try {
    const sprintRes = await asUser().requestJira(
      route`/rest/agile/1.0/sprint/${sprintId}`,
      { headers: { Accept: 'application/json' } }
    );
    if (!sprintRes.ok) return { error: `Failed to fetch sprint: ${sprintRes.status}` };
    const sprint = await sprintRes.json();

    let committedSp;
    if (sprint.state === 'future') {
      // No grace-window concept yet for a sprint that hasn't started — just
      // sum the SP of whatever's currently assigned to it.
      const { issueData } = await getSprintRawData({ projectKey, sprint, spFieldId, forceRefresh: true });
      committedSp = Math.round(Object.values(issueData).reduce((a, i) => a + (i.sp || 0), 0) * 10) / 10;
    } else {
      const { issueData } = await getSprintRawData({ projectKey, sprint, spFieldId });
      const startDate = sprint.startDate?.slice(0, 10);
      if (!startDate) return { error: 'Sprint has no start date yet.' };
      const endDate = actualSprintEnd(sprint)?.slice(0, 10) || startDate;
      const bizDays = getBusinessDays(startDate, endDate);
      if (!bizDays.length) return { error: 'Sprint has no start date yet.' };
      const { statusMapping, error: mapErr } = await getCapacityStatusMapping(projectKey);
      if (mapErr) return { error: mapErr };
      const { initialScope } = computeScopeFoundation(sprint, issueData, statusMapping, bizDays, Number(graceWindowHours) || 12);
      committedSp = Math.round(initialScope * 10) / 10;
    }
    await updateCapacityRow(projectKey, sprintId, { committedSp, committedAt: new Date().toISOString() });
    return { committedSp };
  } catch (e) {
    return { error: e.message };
  }
});

resolver.define('setSprintCommittedSp', async ({ payload }) => {
  const { projectKey, sprintId, committedSp } = payload ?? {};
  if (!projectKey || !sprintId) return { error: 'Missing config.' };
  try {
    await updateCapacityRow(projectKey, sprintId, {
      committedSp: committedSp == null ? null : Number(committedSp),
      committedAt: new Date().toISOString(),
    });
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
});

resolver.define('getSprintVelocitySp', async ({ payload }) => {
  const { projectKey, sprintId, spFieldId, graceWindowHours } = payload ?? {};
  if (!projectKey || !sprintId || !spFieldId) return { error: 'Missing config.' };
  try {
    const sprintRes = await asUser().requestJira(
      route`/rest/agile/1.0/sprint/${sprintId}`,
      { headers: { Accept: 'application/json' } }
    );
    if (!sprintRes.ok) return { error: `Failed to fetch sprint: ${sprintRes.status}` };
    const sprint = await sprintRes.json();
    if (sprint.state === 'future') return { velocitySp: 0 };

    const { issueData } = await getSprintRawData({ projectKey, sprint, spFieldId, forceRefresh: sprint.state === 'active' });
    const { statusMapping, error: mapErr } = await getCapacityStatusMapping(projectKey);
    if (mapErr) return { error: mapErr };
    const v = computeVelocity(sprint, issueData, statusMapping, Number(graceWindowHours) || 12);
    const velocitySp = v ? v.completed : 0;
    await updateCapacityRow(projectKey, sprintId, { velocitySp, velocityAt: new Date().toISOString() });
    return { velocitySp };
  } catch (e) {
    return { error: e.message };
  }
});

resolver.define('setSprintVelocitySp', async ({ payload }) => {
  const { projectKey, sprintId, velocitySp } = payload ?? {};
  if (!projectKey || !sprintId) return { error: 'Missing config.' };
  try {
    const sprintRes = await asUser().requestJira(
      route`/rest/agile/1.0/sprint/${sprintId}`,
      { headers: { Accept: 'application/json' } }
    );
    // Server-side re-check rather than trusting the client's idea of sprint
    // state — a manual Velocity edit is only meaningful once a sprint is closed.
    if (sprintRes.ok) {
      const sprint = await sprintRes.json();
      if (sprint.state !== 'closed') return { error: 'Velocity can only be hand-edited once the sprint is closed.' };
    }
    await updateCapacityRow(projectKey, sprintId, {
      velocitySp: velocitySp == null ? null : Number(velocitySp),
      velocityAt: new Date().toISOString(),
    });
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
});

resolver.define('setSprintCapacityOverride', async ({ payload }) => {
  const { projectKey, sprintId, capacitySp } = payload ?? {};
  if (!projectKey || !sprintId) return { error: 'Missing config.' };
  try {
    await updateCapacityRow(projectKey, sprintId, { capacitySp: capacitySp == null ? null : Number(capacitySp) });
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
});

// Deliberately excludes `name` — requirements limit editing to the sprint's
// Goal ("description" in the requirements' wording; Jira's actual field is
// `goal`) and dates. Uses POST (Jira's *partial* sprint update) rather than
// PUT (full update) specifically so omitting `name` never risks clearing it.
resolver.define('updateSprintGoalAndDates', async ({ payload }) => {
  const { sprintId, goal, startDate, endDate } = payload ?? {};
  if (!sprintId) return { error: 'No sprint id.' };
  const body = { goal: goal ?? '' };
  if (startDate) body.startDate = startDate;
  if (endDate) body.endDate = endDate;
  try {
    const res = await asUser().requestJira(
      route`/rest/agile/1.0/sprint/${sprintId}`,
      {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }
    );
    if (!res.ok) {
      const txt = await res.text();
      return { error: `Jira ${res.status}: ${txt}` };
    }
    return { ok: true, sprint: await res.json() };
  } catch (e) {
    return { error: e.message };
  }
});

// ── TRI-Space-Capacity (Kanban): iterations are 100% app-invented date ranges
// with no Jira representation at all — full CRUD lives in @forge/kvs, keyed
// per project. See PROJECT-CONTEXT.md for why (no native Kanban grouping to
// hang a "sprint"-like object off).

async function getIterations(projectKey) {
  try {
    return (await kvs.get(`kanban-iterations:${projectKey}`)) || [];
  } catch (_) {
    return [];
  }
}

async function saveIterations(projectKey, iterations) {
  await kvs.set(`kanban-iterations:${projectKey}`, iterations);
  return iterations;
}

// Shared by saveKanbanIteration and setKanbanIterationStatus — decision:
// BLOCK rather than auto-flip the previously-Active iteration when
// kanbanAllowMultipleActive is off, so the app never silently changes a row
// the user didn't touch.
async function checkSingleActiveIteration(projectKey, iterations, changedId, newStatus) {
  if (newStatus !== 'active') return null;
  let settings = {};
  try { settings = (await kvs.get(`capacity-settings:${projectKey}`)) || {}; } catch (_) {}
  if (settings.kanbanAllowMultipleActive) return null;
  const otherActive = iterations.find(it => it.id !== changedId && it.status === 'active');
  if (!otherActive) return null;
  return `Iteration "${otherActive.name}" is already Active — set it to Future or Completed first.`;
}

resolver.define('getKanbanIterations', async ({ payload }) => {
  const { projectKey } = payload ?? {};
  if (!projectKey) return { iterations: [] };
  return { iterations: await getIterations(projectKey) };
});

resolver.define('saveKanbanIteration', async ({ payload }) => {
  const { projectKey, iteration } = payload ?? {};
  if (!projectKey || !iteration || !iteration.name || !iteration.startDate || !iteration.endDate) {
    return { error: 'Missing project key, iteration name, or dates.' };
  }
  try {
    const iterations = await getIterations(projectKey);
    const isNew = !iteration.id;
    const id = iteration.id || `it-${crypto.randomUUID()}`;

    const blockErr = await checkSingleActiveIteration(projectKey, iterations, id, iteration.status || 'future');
    if (blockErr) return { error: blockErr };

    const existing = iterations.find(it => it.id === id);
    const now = new Date().toISOString();
    const record = {
      id,
      name: iteration.name,
      description: iteration.description || '',
      capacitySp: Number(iteration.capacitySp) || 0,
      startDate: iteration.startDate,
      endDate: iteration.endDate,
      status: iteration.status || 'future',
      labelFilter: iteration.labelFilter || '',
      committedSp: existing?.committedSp ?? null,
      committedAt: existing?.committedAt ?? null,
      velocitySp: existing?.velocitySp ?? null,
      velocityAt: existing?.velocityAt ?? null,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    const next = isNew ? [...iterations, record] : iterations.map(it => it.id === id ? record : it);
    await saveIterations(projectKey, next);
    return { iterations: next };
  } catch (e) {
    return { error: e.message };
  }
});

resolver.define('deleteKanbanIteration', async ({ payload }) => {
  const { projectKey, iterationId } = payload ?? {};
  if (!projectKey || !iterationId) return { error: 'Missing config.' };
  try {
    const iterations = await getIterations(projectKey);
    const next = iterations.filter(it => it.id !== iterationId);
    await saveIterations(projectKey, next);
    return { iterations: next };
  } catch (e) {
    return { error: e.message };
  }
});

resolver.define('setKanbanIterationStatus', async ({ payload }) => {
  const { projectKey, iterationId, status } = payload ?? {};
  if (!projectKey || !iterationId || !status) return { error: 'Missing config.' };
  try {
    const iterations = await getIterations(projectKey);
    if (!iterations.some(it => it.id === iterationId)) return { error: 'Iteration not found.' };

    const blockErr = await checkSingleActiveIteration(projectKey, iterations, iterationId, status);
    if (blockErr) return { error: blockErr };

    const next = iterations.map(it => it.id === iterationId ? { ...it, status, updatedAt: new Date().toISOString() } : it);
    await saveIterations(projectKey, next);
    return { iterations: next };
  } catch (e) {
    return { error: e.message };
  }
});

// Mirrors fetchSprintIssues, but bounded by JQL instead of sprint membership
// (Kanban issues have no Sprint field). Fetches `labels` too, for the
// optional per-iteration label filter (applies to both Committed and Velocity).
async function fetchIterationIssues(jql, spFieldId) {
  const fields = ['summary', 'status', 'issuetype', 'created', 'labels', spFieldId];
  const allIssues = [];
  let nextPageToken;

  while (true) {
    const reqBody = { jql, fields, expand: 'changelog', maxResults: 100 };
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

// Same trimming as extractRawSprintData, minus the Sprint-changelog parsing —
// no sprintEvents concept for Kanban issues, just status transitions + labels.
async function extractIterationIssueData(issues, spFieldId) {
  const spByKey = await resolveIssueSpValues(issues, spFieldId);
  const issueData = {};
  for (const issue of issues) {
    const transitions = [];
    for (const h of (issue.changelog?.histories || [])) {
      for (const item of (h.items || [])) {
        if (item.field === 'status') {
          transitions.push({ ts: h.created, from: item.fromString, to: item.toString });
        }
      }
    }
    transitions.sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
    issueData[issue.key] = {
      sp: spByKey.get(issue.key),
      summary: issue.fields?.summary ?? '',
      created: issue.fields?.created ?? null,
      currentStatus: issue.fields?.status?.name ?? null,
      labels: issue.fields?.labels ?? [],
      transitions,
    };
  }
  return issueData;
}

function jqlDateOnly(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

// Committed scan is bounded to issues that were in one of the committed-
// eligible statuses within a window around the cutoff (`status WAS IN (...)
// DURING (...)`, a JQL historical-value operator), not literally the whole
// project and not purely time-windowed — a strictly `updated >=` bound could
// miss an issue that's been sitting untouched in an in-progress status since
// before the window, and a *current* `status IN (...)` bound would miss one
// that was committed at the cutoff but has since moved on (e.g. to Done, or
// back to a real To Do status). `WAS IN` catches both, evaluating the field's
// historical value rather than just its current one.
//
// The `DURING` bound is a required performance fix, not an optional nicety —
// Jira's own guidance is that `WAS`/`CHANGED`-family clauses without a date
// bound force a full changelog scan of every matching issue's entire
// lifetime, which timed out (Forge's 25s function limit) on a real,
// long-running Kanban project. `DURING` narrows that scan to a small window
// instead. The ±2-day pad around the exact cutoff instant isn't about the
// grace window (already baked into `cutoffMs`) — it's slack for the fact that
// Jira evaluates JQL date literals in the site's own configured timezone,
// which can land on a different calendar day than our UTC-computed cutoff.
// This can only ever widen the fetched set (more issues re-checked by the
// precise, hour-accurate `statusAt()` call afterward), never narrow it below
// what's actually needed, so it can't silently drop an eligible issue.
async function getIterationCommittedRawData(projectKey, spFieldId, forceRefresh, committedStatuses, cutoffMs) {
  if (!committedStatuses?.length) return { issueData: {} };
  const cacheKey = `raw-kanban:${projectKey}:${spFieldId}:${cutoffMs}`;
  if (!forceRefresh) {
    try {
      const cached = await kvs.get(cacheKey);
      if (cached && (Date.now() - cached.cachedAt) <= ACTIVE_CACHE_TTL_MS) {
        return { issueData: cached.issueData };
      }
    } catch (_) {}
  }
  const windowStart = jqlDateOnly(cutoffMs - 2 * 86400000);
  const windowEnd = jqlDateOnly(cutoffMs + 2 * 86400000);
  // An issue created after the cutoff didn't exist yet, so it can't have been
  // committed to this iteration — excluding it narrows the candidate set
  // further (fewer irrelevant issues to fetch/expand) on top of the DURING
  // bound above. Bounded by the same padded `windowEnd`, not the exact
  // cutoff, for the same site-timezone-vs-UTC reason as the DURING window;
  // computeIterationCommitted() re-checks the exact `created` timestamp
  // against the precise cutoff afterward, so this can only over-fetch, never
  // wrongly exclude a genuinely-eligible issue.
  const jql = `project = "${projectKey}" AND status WAS IN (${jqlQuoteList(committedStatuses)}) DURING ("${windowStart}", "${windowEnd}") AND created <= "${windowEnd}"`;
  const issues = await fetchIterationIssues(jql, spFieldId);
  const issueData = await extractIterationIssueData(issues, spFieldId);
  try { await kvs.set(cacheKey, { issueData, cachedAt: Date.now() }); } catch (_) {}
  return { issueData };
}

// `committedStatusNames` is the explicit whitelist (custom, or the
// category-based default) — a ticket counts as committed if it was in one of
// these statuses at the grace-window cutoff, regardless of what Jira's status
// category says that status is. An issue created after the cutoff is skipped
// outright — it didn't exist yet, so whatever status `statusAt` reports for
// it (its actual initial status, since its very first transition necessarily
// happened after the cutoff too) reflects mid-iteration scope creep, not
// something that was genuinely committed at the start. `labelFilter` is only
// passed in when the `kanbanCommittedUsesLabelFilter` setting is on (off by
// default) — the caller is responsible for zeroing it out otherwise, since
// unlike Velocity, whether a release-train label should scope "what counts as
// committed" at all is a per-project judgment call, not an obvious yes.
function computeIterationCommitted(issueData, committedStatusNames, cutoffMs, labelFilter) {
  const committedSet = new Set(committedStatusNames);
  let committed = 0;
  for (const issue of Object.values(issueData)) {
    const sp = issue.sp || 0;
    if (!sp) continue;
    if (labelFilter && !(issue.labels || []).includes(labelFilter)) continue;
    if (issue.created && Date.parse(issue.created) > cutoffMs) continue;
    if (committedSet.has(statusAt(issue.transitions, cutoffMs, issue.currentStatus))) committed += sp;
  }
  return Math.round(committed * 10) / 10;
}

function computeIterationVelocity(issueData, categoryMap, startMs, endMs, labelFilter) {
  let velocity = 0;
  for (const issue of Object.values(issueData)) {
    const sp = issue.sp || 0;
    if (!sp) continue;
    if (labelFilter && !(issue.labels || []).includes(labelFilter)) continue;
    const doneTrans = issue.transitions.find(t => categoryMap[t.to] === 'done');
    if (!doneTrans) continue;
    const ts = Date.parse(doneTrans.ts);
    if (ts >= startMs && ts <= endMs) velocity += sp;
  }
  return Math.round(velocity * 10) / 10;
}

resolver.define('getIterationCommittedSp', async ({ payload }) => {
  const { projectKey, iterationId, spFieldId, graceWindowHours } = payload ?? {};
  if (!projectKey || !iterationId || !spFieldId) return { error: 'Missing config.' };
  try {
    const iterations = await getIterations(projectKey);
    const iteration = iterations.find(it => it.id === iterationId);
    if (!iteration) return { error: 'Iteration not found.' };

    const { statuses, error } = await fetchProjectStatuses(projectKey);
    if (error) return { error };
    const categoryMap = toCategoryMap(statuses);

    const settings = await getCapacitySettingsFor(projectKey);
    const committedStatuses = settings.kanbanCommittedStatuses.length
      ? settings.kanbanCommittedStatuses
      : defaultCommittedStatusNames(categoryMap);

    const cutoffMs = graceCutoffMs(iteration.startDate, Number(graceWindowHours) || 12);
    const { issueData } = await getIterationCommittedRawData(projectKey, spFieldId, true, committedStatuses, cutoffMs);
    const labelFilter = settings.kanbanCommittedUsesLabelFilter ? iteration.labelFilter : '';
    const committedSp = computeIterationCommitted(issueData, committedStatuses, cutoffMs, labelFilter);

    const next = iterations.map(it => it.id === iterationId
      ? { ...it, committedSp, committedAt: new Date().toISOString() } : it);
    await saveIterations(projectKey, next);
    return { committedSp };
  } catch (e) {
    return { error: e.message };
  }
});

resolver.define('setIterationCommittedSp', async ({ payload }) => {
  const { projectKey, iterationId, committedSp } = payload ?? {};
  if (!projectKey || !iterationId) return { error: 'Missing config.' };
  try {
    const iterations = await getIterations(projectKey);
    if (!iterations.some(it => it.id === iterationId)) return { error: 'Iteration not found.' };
    const next = iterations.map(it => it.id === iterationId
      ? { ...it, committedSp: committedSp == null ? null : Number(committedSp), committedAt: new Date().toISOString() }
      : it);
    await saveIterations(projectKey, next);
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
});

resolver.define('getIterationVelocitySp', async ({ payload }) => {
  const { projectKey, iterationId, spFieldId } = payload ?? {};
  if (!projectKey || !iterationId || !spFieldId) return { error: 'Missing config.' };
  try {
    const iterations = await getIterations(projectKey);
    const iteration = iterations.find(it => it.id === iterationId);
    if (!iteration) return { error: 'Iteration not found.' };

    const { statuses, error } = await fetchProjectStatuses(projectKey);
    if (error) return { error };
    const categoryMap = toCategoryMap(statuses);

    // `resolved` (Jira's resolutiondate) is a much closer proxy for "when this
    // issue was actually finished" than `updated` — cross-checked against the
    // real transition timestamp in computeIterationVelocity below, so this JQL
    // bound only needs to be a reasonable pre-filter, not perfectly precise.
    const jql = `project = "${projectKey}" AND statusCategory = Done AND resolved >= "${iteration.startDate}" AND resolved <= "${iteration.endDate}"`;
    const issues = await fetchIterationIssues(jql, spFieldId);
    const issueData = await extractIterationIssueData(issues, spFieldId);

    const startMs = Date.parse(iteration.startDate + 'T00:00:00.000Z');
    const endMs = Date.parse(iteration.endDate + 'T23:59:59.999Z');
    const velocitySp = computeIterationVelocity(issueData, categoryMap, startMs, endMs, iteration.labelFilter);

    const next = iterations.map(it => it.id === iterationId
      ? { ...it, velocitySp, velocityAt: new Date().toISOString() } : it);
    await saveIterations(projectKey, next);
    return { velocitySp };
  } catch (e) {
    return { error: e.message };
  }
});

resolver.define('setIterationVelocitySp', async ({ payload }) => {
  const { projectKey, iterationId, velocitySp } = payload ?? {};
  if (!projectKey || !iterationId) return { error: 'Missing config.' };
  try {
    const iterations = await getIterations(projectKey);
    const iteration = iterations.find(it => it.id === iterationId);
    if (!iteration) return { error: 'Iteration not found.' };
    if (iteration.status !== 'completed') return { error: 'Velocity can only be hand-edited once the iteration is Completed.' };
    const next = iterations.map(it => it.id === iterationId
      ? { ...it, velocitySp: velocitySp == null ? null : Number(velocitySp), velocityAt: new Date().toISOString() }
      : it);
    await saveIterations(projectKey, next);
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
});

resolver.define('setIterationCapacity', async ({ payload }) => {
  const { projectKey, iterationId, capacitySp } = payload ?? {};
  if (!projectKey || !iterationId) return { error: 'Missing config.' };
  try {
    const iterations = await getIterations(projectKey);
    if (!iterations.some(it => it.id === iterationId)) return { error: 'Iteration not found.' };
    const next = iterations.map(it => it.id === iterationId ? { ...it, capacitySp: Number(capacitySp) || 0 } : it);
    await saveIterations(projectKey, next);
    return { ok: true };
  } catch (e) {
    return { error: e.message };
  }
});

// ── TRI-Kanban-Burnup / TRI-Kanban-Rework / TRI-Kanban-Cycle-Time ─────────────
// Three sibling gadgets to TRI Burndown/Rework/Cycle Time, scoped to a Kanban
// iteration instead of a Scrum sprint. They reuse the exact same per-project
// status→phase mapping (DEFAULT_PHASE_MAP/PHASE_OPTIONS on the frontend) as
// the Scrum gadgets — Capacity's own Kanban math deliberately does NOT use
// this mapping (see the comment above CAPACITY_SETTINGS_DEFAULTS), but these
// three gadgets are direct siblings of the Scrum reporting gadgets, not of
// Capacity, so they inherit that mapping instead.

// Mirrors resolveSprint — 'active' mode does a fresh lookup every call (errors
// if zero or more than one iteration is Active, since "Active" only means
// something unambiguous when there's exactly one — same invariant
// checkSingleActiveIteration already enforces on write); 'fixed' pins to a
// specific iteration id.
async function resolveIteration({ projectKey, iterationMode, iterationId }) {
  const iterations = await getIterations(projectKey);
  if (iterationMode === 'active') {
    const actives = iterations.filter(it => it.status === 'active');
    if (!actives.length) return { error: 'No active iteration currently running for this space.' };
    if (actives.length > 1) return { error: 'Multiple active iterations found — pick a specific iteration instead of "Active".' };
    return { iteration: actives[0] };
  }
  const iteration = iterations.find(it => it.id === iterationId);
  if (!iteration) return { error: 'Iteration not found.' };
  return { iteration };
}

// computeReworkData/computeCycleTimeData only ever read .startDate, .name,
// .state, and actualSprintEnd()'s .completeDate/.endDate — a Kanban iteration
// satisfies that shape directly, so this shim lets both run completely unchanged.
function iterationAsSprintShim(iteration) {
  return {
    name: iteration.name,
    state: iteration.status,
    startDate: iteration.startDate,
    endDate: iteration.endDate,
    completeDate: iteration.status === 'completed' ? iteration.endDate : null,
  };
}

function isTrackedPhase(phase) {
  return !!phase && phase !== 'backlog' && phase !== 'excluded';
}

// Genuinely mid-flight phases — unlike isTrackedPhase, this excludes 'done'.
// Used wherever "was this issue actually in progress" matters, as opposed to
// "did this issue reach a meaningful (non-backlog) phase at all".
function isWipPhase(phase) {
  return phase === 'dev' || phase === 'blocked' || phase === 'review' || phase === 'test';
}

// True if the issue was already mid-flight at windowStart, or transitioned
// into a tracked-or-done phase at any point during (windowStart, windowEnd].
// Phase-based port of the reference script's _is_active_during_period
// (jira_kanban_burnup_extract.py) — the per-team hardcoded status sets there
// become statusMapping lookups here. The windowStart check deliberately uses
// isWipPhase, not isTrackedPhase: an issue already Done before the window
// even began isn't "active during the window" just because it got touched
// (a comment, a label) sometime inside it — only a real in-flight phase at
// windowStart, or an actual transition during the window (checked below,
// where reaching 'done' during the window is still correctly counted), makes
// it active.
function isActiveDuringWindow(issue, statusMapping, windowStartMs, windowEndMs) {
  const phaseAtStart = statusMapping[statusAt(issue.transitions, windowStartMs, issue.currentStatus)];
  if (isWipPhase(phaseAtStart)) return true;
  for (const t of issue.transitions) {
    const ts = Date.parse(t.ts);
    if (ts > windowStartMs && ts <= windowEndMs) {
      const phase = statusMapping[t.to];
      if (isTrackedPhase(phase) || phase === 'done') return true;
    }
  }
  return false;
}

// Raw fetch only, shared by all three Kanban reporting gadgets so an
// iteration's issue set is fetched/cached once regardless of how many of them
// are on a dashboard. Merges three JQL queries and caches the UNFILTERED
// union. Classification (isActiveDuringWindow) deliberately isn't baked into
// the cache — it depends on the caller's own statusMapping, which can differ
// between gadget instances pointed at the same iteration, so it's applied
// fresh on every call instead (see filterActiveDuringWindow). All three
// discovery queries are built from the caller's statusMapping purely to widen
// the candidate set, so two differently-configured gadgets sharing this cache
// within the 5-minute TTL could in theory see a slightly different candidate
// superset — same accepted, bounded tradeoff as getIterationCommittedRawData's
// WAS/DURING window.
//
// Query A — touched during the window, excluding backlog statuses (an issue
// merely groomed/commented-on while still To Do/BA Reviewed isn't iteration
// work; if a caller's mapping has no backlog statuses this degrades to the
// original unfiltered clause).
// Query B — currently mid-flight (dev/blocked/review/test, NOT done) for
// long-running issues with no recent field update, bounded by `created` so a
// brand-new in-progress ticket can't leak into a much older iteration's
// report. Excluding `done` here is the actual fix for a real timeout: this
// used to also match every status mapped to 'done', with no time bound at
// all, which on any project with real history fetched (with full changelog
// expand) literally every issue ever closed.
// Query C — reached a done-phase status DURING the window specifically. This
// is what still lets an issue that finished mid-iteration into the result set
// without Query B's unbounded scan — same WAS-IN/DURING performance pattern
// already used by getIterationCommittedRawData (src/index.js above), just
// with CHANGED TO since here it's a single from-anywhere transition rather
// than "was in one of these statuses at some point."
async function getIterationActiveRawData(projectKey, iterationId, spFieldId, startDate, endDate, statusMapping, forceRefresh) {
  const cacheKey = `raw-kanban-active:${projectKey}:${iterationId}:${spFieldId}`;
  if (!forceRefresh) {
    try {
      const cached = await kvs.get(cacheKey);
      if (cached && (Date.now() - cached.cachedAt) <= ACTIVE_CACHE_TTL_MS) {
        return { issueData: cached.issueData, fromCache: true };
      }
    } catch (_) {}
  }

  const windowStartMs = Date.parse(startDate + 'T00:00:00.000Z');
  const windowEndMs = Date.parse(endDate + 'T23:59:59.999Z');
  const paddedStart = jqlDateOnly(windowStartMs - 2 * 86400000);
  const paddedEnd = jqlDateOnly(windowEndMs + 2 * 86400000);

  const statusesForPhase = (pred) => Object.entries(statusMapping)
    .filter(([, phase]) => pred(phase))
    .map(([name]) => name);

  const backlogStatuses = statusesForPhase(phase => phase === 'backlog');
  const wipStatuses = statusesForPhase(isWipPhase);
  const doneStatuses = statusesForPhase(phase => phase === 'done');

  const queries = [
    `project = "${projectKey}" AND updated >= "${paddedStart}" AND updated <= "${paddedEnd}"`
      + (backlogStatuses.length ? ` AND status NOT IN (${jqlQuoteList(backlogStatuses)})` : ''),
  ];
  if (wipStatuses.length) {
    queries.push(`project = "${projectKey}" AND status IN (${jqlQuoteList(wipStatuses)}) AND created <= "${paddedEnd}"`);
  }
  if (doneStatuses.length) {
    queries.push(`project = "${projectKey}" AND status CHANGED TO (${jqlQuoteList(doneStatuses)}) DURING ("${paddedStart}", "${paddedEnd}")`);
  }

  const byKey = new Map();
  const results = await Promise.all(queries.map(jql => fetchIterationIssues(jql, spFieldId)));
  for (const issues of results) {
    for (const issue of issues) byKey.set(issue.key, issue);
  }

  const issueData = await extractIterationIssueData([...byKey.values()], spFieldId);
  try { await kvs.set(cacheKey, { issueData, cachedAt: Date.now() }); } catch (_) {}
  return { issueData, fromCache: false };
}

function filterActiveDuringWindow(issueData, statusMapping, startDate, endDate) {
  const windowStartMs = Date.parse(startDate + 'T00:00:00.000Z');
  const windowEndMs = Date.parse(endDate + 'T23:59:59.999Z');
  const filtered = {};
  for (const [key, issue] of Object.entries(issueData)) {
    if (isActiveDuringWindow(issue, statusMapping, windowStartMs, windowEndMs)) filtered[key] = issue;
  }
  return filtered;
}

resolver.define('getKanbanReworkData', async ({ payload }) => {
  const { projectKey, iterationMode, iterationId, spFieldId, statusMapping, forceRefresh } = payload ?? {};
  if (!projectKey || !spFieldId || !statusMapping || (iterationMode !== 'active' && !iterationId)) {
    return { error: 'Missing required config.' };
  }

  const resolved = await resolveIteration({ projectKey, iterationMode, iterationId });
  if (resolved.error) return { error: resolved.error };
  const iteration = resolved.iteration;

  let issueData, fromCache;
  try {
    ({ issueData, fromCache } = await getIterationActiveRawData(
      projectKey, iteration.id, spFieldId, iteration.startDate, iteration.endDate, statusMapping, forceRefresh
    ));
  } catch (e) {
    return { error: e.message };
  }
  issueData = filterActiveDuringWindow(issueData, statusMapping, iteration.startDate, iteration.endDate);

  const data = computeReworkData(iterationAsSprintShim(iteration), issueData, statusMapping);
  if (!data) return { error: 'Could not compute rework events — check iteration dates.' };
  data.spaceName = await getSpaceName(projectKey);

  return { data, fromCache };
});

resolver.define('getKanbanCycleTimeData', async ({ payload }) => {
  const {
    projectKey, iterationMode, iterationId, spFieldId, statusMapping, forceRefresh,
    hoursPerSp, workStartHour, workEndHour, utcOffsetHours,
  } = payload ?? {};
  if (!projectKey || !spFieldId || !statusMapping || (iterationMode !== 'active' && !iterationId)) {
    return { error: 'Missing required config.' };
  }

  const resolved = await resolveIteration({ projectKey, iterationMode, iterationId });
  if (resolved.error) return { error: resolved.error };
  const iteration = resolved.iteration;

  let issueData, fromCache;
  try {
    ({ issueData, fromCache } = await getIterationActiveRawData(
      projectKey, iteration.id, spFieldId, iteration.startDate, iteration.endDate, statusMapping, forceRefresh
    ));
  } catch (e) {
    return { error: e.message };
  }
  issueData = filterActiveDuringWindow(issueData, statusMapping, iteration.startDate, iteration.endDate);

  const numOr = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  const data = computeCycleTimeData(iterationAsSprintShim(iteration), issueData, statusMapping, {
    hoursPerSp:     numOr(hoursPerSp, 4) || 4,
    workStartHour:  numOr(workStartHour, 9),
    workEndHour:    numOr(workEndHour, 17),
    utcOffsetHours: numOr(utcOffsetHours, 10),
  });
  data.spaceName = await getSpaceName(projectKey);

  return { data, fromCache };
});

// Cumulative burn-up for a Kanban iteration — restates the reference script's
// compute_burnup_series() (jira_kanban_burnup_extract.py) against this app's
// own phase vocabulary instead of a hardcoded per-team status set. Every line
// is CUMULATIVE: an item counts toward a line from the day it first reaches
// that phase OR ANY LATER phase and stays counted thereafter, delta'd against
// day 0 so every line starts at 0 ("SP added since period start"), same
// convention as the reference script. The script's "All Work" funnel line is
// computed there but never actually charted (its own dashboard only plots
// Target/Development/Review/Testing), so it's dropped here rather than
// carried as dead data. Target's endpoint is the iteration's own Committed SP
// (already computed by the Capacity tab's "Get SP Count"), not a
// separately-entered "planned SP" — one source of truth, same principle as
// TRI Velocity reading Capacity's saved numbers instead of computing its own.
function computeIterationBurnup(iteration, issueData, statusMapping, committedSp, clientTodayISO) {
  const startDate = iteration.startDate;
  // Resolvers run server-side in UTC, so new Date() here can lag a calendar
  // day behind for sites east of UTC — same fix as computeBurndown's
  // clientTodayISO param: prefer the browser's own local date when supplied.
  const todayISO = clientTodayISO || new Date().toISOString().slice(0, 10);
  const effectiveEnd = todayISO < iteration.endDate ? todayISO : iteration.endDate;
  const bizDays = getBusinessDays(startDate, iteration.endDate);
  if (!bizDays.length) return null;

  const n = bizDays.length;
  const labels = bizDays.map(dayLabel);
  const target = bizDays.map((_, i) => (n > 1 ? Math.round(committedSp * i / (n - 1) * 10) / 10 : committedSp));

  const devPlus    = new Set(['dev', 'review', 'test', 'done']);
  const reviewPlus = new Set(['review', 'test', 'done']);
  const testPlus   = new Set(['test', 'done']);

  const development = [];
  const review = [];
  const testing = [];

  for (const day of bizDays) {
    if (day > effectiveEnd) {
      development.push(null);
      review.push(null);
      testing.push(null);
      continue;
    }
    const eodMs = Date.parse(day + 'T23:59:59.999Z');
    let devSp = 0, reviewSp = 0, testSp = 0;
    for (const issue of Object.values(issueData)) {
      const sp = issue.sp || 0;
      if (!sp) continue;
      const phase = statusMapping[statusAt(issue.transitions, eodMs, issue.currentStatus)];
      if (devPlus.has(phase))    devSp    += sp;
      if (reviewPlus.has(phase)) reviewSp += sp;
      if (testPlus.has(phase))   testSp   += sp;
    }
    development.push(devSp);
    review.push(reviewSp);
    testing.push(testSp);
  }

  // Delta from day-0 baseline so every line starts at 0.
  const baseline = arr => (arr.length && arr[0] != null ? arr[0] : 0);
  const toDelta = (arr, b) => arr.map(v => (v == null ? null : Math.round((v - b) * 10) / 10));
  const developmentDelta = toDelta(development, baseline(development));
  const reviewDelta      = toDelta(review, baseline(review));
  const testingDelta     = toDelta(testing, baseline(testing));

  const lastNonNull = arr => {
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i];
    return 0;
  };

  return {
    labels,
    target,
    development: developmentDelta,
    review: reviewDelta,
    testing: testingDelta,
    committedSp,
    lastDevelopment: lastNonNull(developmentDelta),
    lastReview: lastNonNull(reviewDelta),
    lastTesting: lastNonNull(testingDelta),
    iterationName: iteration.name,
    iterationStatus: iteration.status,
    startDate,
    endDate: iteration.endDate,
  };
}

resolver.define('getKanbanBurnupData', async ({ payload }) => {
  const { projectKey, iterationMode, iterationId, spFieldId, statusMapping, forceRefresh, todayISO } = payload ?? {};
  if (!projectKey || !spFieldId || !statusMapping || (iterationMode !== 'active' && !iterationId)) {
    return { error: 'Missing required config.' };
  }

  const resolved = await resolveIteration({ projectKey, iterationMode, iterationId });
  if (resolved.error) return { error: resolved.error };
  const iteration = resolved.iteration;

  let issueData, fromCache;
  try {
    ({ issueData, fromCache } = await getIterationActiveRawData(
      projectKey, iteration.id, spFieldId, iteration.startDate, iteration.endDate, statusMapping, forceRefresh
    ));
  } catch (e) {
    return { error: e.message };
  }
  issueData = filterActiveDuringWindow(issueData, statusMapping, iteration.startDate, iteration.endDate);

  const data = computeIterationBurnup(iteration, issueData, statusMapping, iteration.committedSp || 0, todayISO);
  if (!data) return { error: 'Could not compute burn-up — check iteration dates.' };
  data.spaceName = await getSpaceName(projectKey);

  return { data, fromCache };
});

exports.handler = resolver.getDefinitions();
