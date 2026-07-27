# Project context: what we built and why

Architecture and setup are documented in `README.md`; this file is the "why," not a restatement of what's readable from the code.

## Shared abstractions (why they exist)

All 4 gadgets share the same first config steps (Space → Sprint → Story Points Field → Status Mapping → Grace Window). Rather than duplicate that ~150 lines of state/loading/JSX per gadget, it's factored into:

- `useSprintSourceConfig.js` — the hook owning all of that state/loading/hydration
- `SprintSourceFields.jsx` — the presentational form for it
- `sprintConfigShared.jsx` — shared constants (`PHASE_OPTIONS`, `DEFAULT_PHASE_MAP`) and styles
- `useDisplayMode.js` — shared chart/table/both view-mode logic (TRI Scope Change, TRI Rework)

Each gadget's `Edit` component composes these and adds only its own extra fields (e.g. TRI Cycle Time's Hours-per-SP and Business Hours fields).

## Shared cache (why it's keyed the way it is)

`getSprintRawData()` in `src/index.js` fetches issues + full changelog for a sprint — the expensive part (pagination + changelog per issue) — and caches it via `@forge/kvs`, keyed by `(sprintId, storyPointsFieldId)`. This is deliberately **not** keyed by status mapping, because the mapping only affects the cheap compute step (classifying transitions into phases), not the fetch. Result: if two widgets on the same dashboard point at the same sprint and SP field — even with different status mappings — only one Jira fetch happens.

**`@forge/storage` vs `@forge/kvs` — don't reintroduce the former.** This app originally (incorrectly) depended on `@forge/storage` with `const { storage } = require('@forge/storage')`. That package's actual v2 API has no ready-made `storage` export at all (only low-level primitives like `GlobalStorage`/`getStorageInstanceWithQuery` meant for manual OAuth-client wiring) — so `storage` was `undefined` and every `storage.get`/`storage.set` call silently threw, swallowed everywhere by `catch (_) {}` except in two resolvers added 2026-07-27 that didn't swallow it, which is how this was caught (see bug #6 below). Caching had never actually worked in this app until it was fixed by switching to `@forge/kvs`'s `kvs` export — confirmed via Atlassian's current Storage API docs as the supported package. No manifest change was needed (`storage:app` scope covers both).

## Status/phase mapping model (the core abstraction)

There is no hardcoded status-name list anywhere. Every gadget works off a per-instance `statusMapping: { [statusName]: phase }` where phase is one of: `backlog`, `dev`, `blocked`, `review`, `test`, `done`, `excluded`. This is what lets one codebase work with any team's custom Jira workflow. `blocked` was added later (originally folded into `dev`) specifically so TRI Cycle Time could track blocked-time separately, matching the reference script's 4-bucket cycle-time table. Verified safe to add: burndown/scope-change/rework only special-case `review`/`test`/`done`/`excluded`, so an unrecognized-there `blocked` phase behaves like `backlog`/`dev` — no behavior change for those three.

## Dashboard sprint filter (why it's built this way)

TRI Sprint Filter is a 5th gadget added later so multiple TRI-* widgets on one dashboard can share a single Space/Sprint selection instead of each being configured separately. Jira dashboards have no native cross-gadget filter mechanism, so this is built entirely out of two Forge primitives working together:

- **`@forge/kvs`, keyed by `dashboard-filter:${context.extension.dashboard.id}`** — the durable source of truth. `dashboard.id` comes from the gadget's own context (confirmed against Atlassian's `jira:dashboardGadget` context docs — `context.extension.dashboard.id` / `context.extension.gadget.id`), not passed up from the client, so it can't be spoofed and needs no extra plumbing.
- **`@forge/bridge`'s `events.emit`/`events.on`** — for instant updates to gadgets already open on the same dashboard, without a page refresh. This channel is explicitly in-page-only and unpersisted (confirmed against Atlassian's Custom UI bridge events docs) — it does NOT replay past events to a late subscriber. That's why storage is still read on every gadget's mount: a gadget that mounts before, after, or without ever seeing the live event still picks up the current selection.

`useDashboardFilter.js` wraps that hybrid (poll storage on mount + subscribe to the live event). `useEffectiveSprintSource.js` sits on top of it and is what each of the 4 reporting gadgets' views actually call — it decides, per gadget, whether to use its own saved config or the filter's override, and never both partially.

**The status-mapping wrinkle, and the resolved tradeoff:** Status → Phase Mapping is keyed by a specific project's actual status names (see the section above), so it can't blindly follow a filter that might point at a different Space's differently-named workflow — doing so would silently classify every status as `backlog` with no error, which is worse than not following the filter at all. Resolved by: if the filter's Space matches what the gadget's mapping was configured against, use the saved mapping; if not, fetch that Space's statuses and apply the same `DEFAULT_PHASE_MAP` best-guess heuristic already used the first time a Space is picked in edit mode, and surface a "using a best-guess mapping" note in the view (`source.usingDefaultMapping`). This was a deliberate simpler-alternative chosen over the more correct-but-heavier option of storing a status mapping per-Space inside each gadget's config — reasonable because the expected use case is switching *sprints* within one project, not switching between differently-shaped projects on the same dashboard.

SP Field, Status Mapping, and Grace Window are never part of the filter override — only Space and Sprint are. A gadget must still be fully configured (its own Space picked, to seed the Status Mapping list) even when "Use dashboard sprint filter" is on.

## Real bugs found and fixed — don't reintroduce these

1. **`snapToBizDay` must only roll Saturday/Sunday forward to Monday.** An earlier version snapped ANY pre-sprint date forward to the sprint's start day (`bizDays.find(b => b >= d)`), which double-counted committed scope: a ticket added before the sprint started got counted both in the initial committed-scope sum AND as a same-day "add" delta, making all burndown lines start at roughly double the ideal line's height.

2. **Never compare Jira timestamps as raw strings.** Jira's changelog `created` timestamps keep the site's local UTC offset (e.g. `+10:00`); `new Date(...).toISOString()` always normalizes to `Z`. String-comparing a `+10:00` value against a `Z` value is unsound near boundaries even though it "looks" ISO-8601. Every comparison in `src/index.js` goes through `Date.parse()` to compare actual epoch milliseconds.

3. **"Today" for burndown truncation must come from the browser, not the resolver.** Forge resolvers run server-side in UTC. For a site east of UTC (e.g. Sydney, UTC+10), `new Date()` on the server can still say "yesterday" well into the local morning — silently chopping the current day off the chart. Fixed by having the frontend compute `localTodayISO()` (`gadgetUtils.js`) from the browser's actual local date and pass it to the resolver as `todayISO`, instead of trusting server-side `new Date()`.

4. **The Commitment Grace Window (default 12h) only works if a sprint's `startDate` reflects when it was actually started.** If a team backdates the start date (e.g. enters a date a week before they actually click "Start Sprint"), there's no way to detect or correct for this via the Jira API — a Sprint has no field recording "the actual moment it was activated" separate from the editable `startDate`. This is why the grace window is user-configurable (per gadget instance) rather than hardcoded — it's the escape hatch for that workflow, not a bug to fix algorithmically.

5. **`jira:dashboardGadget.thumbnail` requires an absolute URL.** There is no manifest syntax for pointing it at a path inside a declared static `resource` — confirmed against Atlassian's own docs. Icons are hosted via `raw.githubusercontent.com/wodutoit/jira-tri-burndown-change-dashboard-gadget/icons-v1/...`, pinned to the `icons-v1` git tag (not a branch) so the URL can't silently change. **If icons are ever regenerated: create a new tag, and update all `thumbnail` URLs in `manifest.yml` to point at it.** TRI Sprint Filter's icon (`tri-sprint-filter.svg`) was added after `icons-v1` was tagged, so its `thumbnail` points at a separate `icons-v2` tag rather than retagging the other 4 — **that tag still needs to be created** (`git tag icons-v2 && git push origin icons-v2`) before the new gadget's icon will actually resolve; until then its thumbnail URL 404s (the gadget still works, it just won't have an icon in the "Add gadget" sidebar).

6. **`@forge/storage`'s `const { storage } = require('@forge/storage')` pattern silently did nothing — every call failed and was swallowed.** That package's actual v2 API (installed: 2.0.3) has no ready-made `storage` export, only low-level primitives requiring manual OAuth-client wiring not meant for direct app use. `storage` was `undefined`, so every `storage.get`/`storage.set` threw "Cannot read properties of undefined (reading 'get'/'set')" — invisible everywhere because every call site wrapped it in `catch (_) {}`. Caching had silently never worked (confirmed: the "· cached" indicator had never once appeared in testing) until the two new dashboard-filter resolvers (2026-07-27), which don't swallow the error, surfaced it in the UI. Fixed by switching to `@forge/kvs`'s `kvs` export, the package Atlassian's current docs confirm is actually supported. **If you ever see "Cannot read properties of undefined (reading 'get'/'set')" again, check for a stray `require('@forge/storage')` before assuming it's something else — this exact failure mode is easy to reintroduce by copying an old snippet.**

## Deleted, on purpose

- `reference/jira_sprint_extract.py` — the original Python/Excel sprint-reporting script all 4 gadgets are ports of. Removed before making the repo public/Marketplace-facing because it contained the org's real Jira site URL and internal Confluence page IDs. If you need to re-check a computation against the original logic, ask the project owner — they have the source script.
- `static/gadgets/src/gadget/SprintStatusGadgetEdit.jsx` / `SprintStatusGadgetView.jsx` — the original single-gadget starter-template example, superseded by the 4 real gadgets and no longer referenced anywhere.

## Known, accepted limitation (not yet fixed)

`getSprintRawData`'s issue+changelog pagination has no cap on issue count or page count. Tested and working with a ~100-issue sprint. Documented in `README.md`'s "Known simplifications" as a real scaling risk (possible Forge function timeout on much larger sprints), not silently ignored — but not fixed either. If this becomes a real problem, the fix is either a hard cap with a clear "sprint too large" message, or moving to incremental/background fetching.

## Release state

v1.2.0. Deployed to Forge `development`, `staging`, and `production` environments, all installed on `prediktivity.atlassian.net`. Being prepared for Atlassian Marketplace submission (broader distribution beyond internal use) — see `.claude/MARKETPLACE-APPROVAL-GUIDELINES.md`.
