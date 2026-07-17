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

// ── Burndown computation ──────────────────────────────────────────────────────

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

function computeBurndown(sprint, issues, spFieldId, statusMapping) {
  const startDate = sprint.startDate?.slice(0, 10);
  const endDate   = sprint.endDate?.slice(0, 10);
  if (!startDate || !endDate) return null;

  const todayISO    = new Date().toISOString().slice(0, 10);
  const effectiveEnd = todayISO < endDate ? todayISO : endDate;
  const bizDays     = getBusinessDays(startDate, endDate);
  if (!bizDays.length) return null;

  // Per-issue SP and status transition timeline
  const issueSpMap = {};
  const transitionsByKey = {};

  for (const issue of issues) {
    const sp = issue.fields?.[spFieldId];
    issueSpMap[issue.key] = typeof sp === 'number' ? sp : 0;
    const trans = [];
    for (const h of (issue.changelog?.histories || [])) {
      for (const item of (h.items || [])) {
        if (item.field === 'status') {
          trans.push({ ts: h.created, from: item.fromString, to: item.toString });
        }
      }
    }
    trans.sort((a, b) => a.ts.localeCompare(b.ts));
    transitionsByKey[issue.key] = trans;
  }

  // Grace window: 12 h after sprint start = committed scope
  const graceCutoffISO = new Date(new Date(sprint.startDate).getTime() + 12 * 3600 * 1000).toISOString();

  const initialCommitted = {};
  const allSprintKeys    = new Set();
  const scopeDeltaByDay  = {};
  const removedTsByKey   = {};
  const nrTsByKey        = {};
  const sprintIdStr      = String(sprint.id);

  for (const issue of issues) {
    allSprintKeys.add(issue.key);

    // Sprint membership changes from changelog
    let firstAddTs = null;
    for (const h of (issue.changelog?.histories || [])) {
      for (const item of (h.items || [])) {
        if (item.field !== 'Sprint') continue;
        const toIds   = (item.to   || '').split(',').map(s => s.trim());
        const fromIds = (item.from || '').split(',').map(s => s.trim());
        if (toIds.includes(sprintIdStr) && !fromIds.includes(sprintIdStr)) {
          if (!firstAddTs || h.created < firstAddTs) firstAddTs = h.created;
        }
        if (fromIds.includes(sprintIdStr) && !toIds.includes(sprintIdStr)) {
          if (!removedTsByKey[issue.key] || h.created < removedTsByKey[issue.key]) {
            removedTsByKey[issue.key] = h.created;
          }
        }
      }
    }

    // Mid-sprint add → scope increase after grace window
    if (firstAddTs && firstAddTs > graceCutoffISO) {
      const d = snapToBizDay(firstAddTs, bizDays);
      if (d >= startDate && d <= endDate) {
        scopeDeltaByDay[d] = (scopeDeltaByDay[d] || 0) + (issueSpMap[issue.key] || 0);
      }
    }
    // Remove → scope decrease
    if (removedTsByKey[issue.key]) {
      const d = snapToBizDay(removedTsByKey[issue.key], bizDays);
      if (d >= startDate && d <= endDate) {
        scopeDeltaByDay[d] = (scopeDeltaByDay[d] || 0) - (issueSpMap[issue.key] || 0);
      }
    }

    // Committed scope: in sprint from start (no add event) or added within grace window
    if (!firstAddTs || firstAddTs <= graceCutoffISO) {
      initialCommitted[issue.key] = issueSpMap[issue.key] || 0;
    }

    // First transition to an 'excluded' status (e.g. "Not Required")
    for (const t of transitionsByKey[issue.key]) {
      if (statusMapping[t.to] === 'excluded' && !nrTsByKey[issue.key]) {
        nrTsByKey[issue.key] = t.ts;
      }
    }
    // Excluded → scope reduction
    if (nrTsByKey[issue.key]) {
      const d = snapToBizDay(nrTsByKey[issue.key], bizDays);
      if (d >= startDate && d <= endDate) {
        scopeDeltaByDay[d] = (scopeDeltaByDay[d] || 0) - (issueSpMap[issue.key] || 0);
      }
    }
  }

  const initialScope = Object.values(initialCommitted).reduce((s, v) => s + v, 0);
  const n = bizDays.length;

  // First 'done' transition per key
  const doneTsByKey = {};
  for (const key of allSprintKeys) {
    for (const t of transitionsByKey[key] || []) {
      if (statusMapping[t.to] === 'done' && !doneTsByKey[key]) {
        doneTsByKey[key] = t.ts;
      }
    }
  }

  // Status as-of end-of-day reconstruction from changelog
  function statusAt(key, eodISO) {
    const trans = transitionsByKey[key] || [];
    if (!trans.length) return 'unknown';
    let st = trans[0].from || 'unknown';
    for (const t of trans) {
      if (t.ts <= eodISO) st = t.to;
      else break;
    }
    return st;
  }

  const labels       = [];
  const idealSeries  = [];
  const devRemSeries = [];
  const reviewRemSeries = [];
  const remainSeries = [];

  let runningScope = initialScope;

  for (let i = 0; i < n; i++) {
    const day = bizDays[i];
    runningScope += (scopeDeltaByDay[day] || 0);

    idealSeries.push(n > 1 ? Math.round(initialScope * (n - 1 - i) / (n - 1) * 10) / 10 : 0);

    const d = new Date(day + 'T12:00:00Z');
    labels.push(d.toLocaleDateString('en-AU', { day: '2-digit', month: 'short' }));

    if (day > effectiveEnd) {
      devRemSeries.push(null);
      reviewRemSeries.push(null);
      remainSeries.push(null);
      continue;
    }

    const eod = day + 'T23:59:59.999Z';
    let doneSp = 0, devSp = 0, reviewSp = 0;

    for (const key of allSprintKeys) {
      const sp = issueSpMap[key] || 0;
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

// Resolve the project's board + its currently active sprint (used for sprintMode: 'active').
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

// ── Main burndown resolver with caching ───────────────────────────────────────

resolver.define('getBurndownData', async ({ payload }) => {
  const { sprintMode, sprintId, spFieldId, statusMapping, projectKey, forceRefresh } = payload ?? {};
  if (!spFieldId || !statusMapping || !projectKey || (sprintMode !== 'active' && !sprintId)) {
    return { error: 'Missing required config.' };
  }

  // Resolve which sprint we're actually rendering — dynamic lookup for 'active' mode,
  // direct fetch for a pinned sprint (e.g. a closed historical sprint).
  let sprint;
  if (sprintMode === 'active') {
    const resolved = await resolveActiveSprint(projectKey);
    if (resolved.error) return { error: resolved.error };
    sprint = resolved.sprint;
  } else {
    const sprintRes = await asUser().requestJira(
      route`/rest/agile/1.0/sprint/${sprintId}`,
      { headers: { Accept: 'application/json' } }
    );
    if (!sprintRes.ok) return { error: `Failed to fetch sprint: ${sprintRes.status}` };
    sprint = await sprintRes.json();
  }

  const cacheKey = `burndown:${sprint.id}:${spFieldId}:${JSON.stringify(statusMapping)}`;

  if (!forceRefresh) {
    try {
      const cached = await storage.get(cacheKey);
      if (cached) {
        const stale = sprint.state === 'active' && (Date.now() - cached.cachedAt) > ACTIVE_CACHE_TTL_MS;
        if (!stale) return { data: cached.data, fromCache: true };
      }
    } catch (_) {}
  }

  // Issues with changelog — /search/jql is cursor-paginated (nextPageToken), not startAt.
  const fields = ['summary', 'status', 'issuetype', spFieldId];
  const allIssues = [];
  let nextPageToken;

  while (true) {
    const reqBody = {
      jql: `project = "${projectKey}" AND sprint = ${sprint.id}`,
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
      return { error: `Issue search failed (${searchRes.status}): ${txt}` };
    }
    const body = await searchRes.json();
    const issues = body.issues || [];
    allIssues.push(...issues);
    nextPageToken = body.nextPageToken;
    if (!issues.length || !nextPageToken) break;
  }

  const data = computeBurndown(sprint, allIssues, spFieldId, statusMapping);
  if (!data) return { error: 'Could not compute burndown — check sprint dates.' };

  try {
    await storage.set(cacheKey, { data, cachedAt: Date.now() });
  } catch (_) {}

  return { data, fromCache: false };
});

exports.handler = resolver.getDefinitions();
