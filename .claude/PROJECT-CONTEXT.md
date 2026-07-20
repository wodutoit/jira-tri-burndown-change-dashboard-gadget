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

`getSprintRawData()` in `src/index.js` fetches issues + full changelog for a sprint — the expensive part (pagination + changelog per issue) — and caches it in `@forge/storage`, keyed by `(sprintId, storyPointsFieldId)`. This is deliberately **not** keyed by status mapping, because the mapping only affects the cheap compute step (classifying transitions into phases), not the fetch. Result: if two widgets on the same dashboard point at the same sprint and SP field — even with different status mappings — only one Jira fetch happens.

## Status/phase mapping model (the core abstraction)

There is no hardcoded status-name list anywhere. Every gadget works off a per-instance `statusMapping: { [statusName]: phase }` where phase is one of: `backlog`, `dev`, `blocked`, `review`, `test`, `done`, `excluded`. This is what lets one codebase work with any team's custom Jira workflow. `blocked` was added later (originally folded into `dev`) specifically so TRI Cycle Time could track blocked-time separately, matching the reference script's 4-bucket cycle-time table. Verified safe to add: burndown/scope-change/rework only special-case `review`/`test`/`done`/`excluded`, so an unrecognized-there `blocked` phase behaves like `backlog`/`dev` — no behavior change for those three.

## Real bugs found and fixed — don't reintroduce these

1. **`snapToBizDay` must only roll Saturday/Sunday forward to Monday.** An earlier version snapped ANY pre-sprint date forward to the sprint's start day (`bizDays.find(b => b >= d)`), which double-counted committed scope: a ticket added before the sprint started got counted both in the initial committed-scope sum AND as a same-day "add" delta, making all burndown lines start at roughly double the ideal line's height.

2. **Never compare Jira timestamps as raw strings.** Jira's changelog `created` timestamps keep the site's local UTC offset (e.g. `+10:00`); `new Date(...).toISOString()` always normalizes to `Z`. String-comparing a `+10:00` value against a `Z` value is unsound near boundaries even though it "looks" ISO-8601. Every comparison in `src/index.js` goes through `Date.parse()` to compare actual epoch milliseconds.

3. **"Today" for burndown truncation must come from the browser, not the resolver.** Forge resolvers run server-side in UTC. For a site east of UTC (e.g. Sydney, UTC+10), `new Date()` on the server can still say "yesterday" well into the local morning — silently chopping the current day off the chart. Fixed by having the frontend compute `localTodayISO()` (`gadgetUtils.js`) from the browser's actual local date and pass it to the resolver as `todayISO`, instead of trusting server-side `new Date()`.

4. **The Commitment Grace Window (default 12h) only works if a sprint's `startDate` reflects when it was actually started.** If a team backdates the start date (e.g. enters a date a week before they actually click "Start Sprint"), there's no way to detect or correct for this via the Jira API — a Sprint has no field recording "the actual moment it was activated" separate from the editable `startDate`. This is why the grace window is user-configurable (per gadget instance) rather than hardcoded — it's the escape hatch for that workflow, not a bug to fix algorithmically.

5. **`jira:dashboardGadget.thumbnail` requires an absolute URL.** There is no manifest syntax for pointing it at a path inside a declared static `resource` — confirmed against Atlassian's own docs. Icons are hosted via `raw.githubusercontent.com/wodutoit/jira-tri-burndown-change-dashboard-gadget/icons-v1/...`, pinned to the `icons-v1` git tag (not a branch) so the URL can't silently change. **If icons are ever regenerated: create a new tag, and update all 4 `thumbnail` URLs in `manifest.yml` to point at it.**

## Deleted, on purpose

- `reference/jira_sprint_extract.py` — the original Python/Excel sprint-reporting script all 4 gadgets are ports of. Removed before making the repo public/Marketplace-facing because it contained the org's real Jira site URL and internal Confluence page IDs. If you need to re-check a computation against the original logic, ask the project owner — they have the source script.
- `static/gadgets/src/gadget/SprintStatusGadgetEdit.jsx` / `SprintStatusGadgetView.jsx` — the original single-gadget starter-template example, superseded by the 4 real gadgets and no longer referenced anywhere.

## Known, accepted limitation (not yet fixed)

`getSprintRawData`'s issue+changelog pagination has no cap on issue count or page count. Tested and working with a ~100-issue sprint. Documented in `README.md`'s "Known simplifications" as a real scaling risk (possible Forge function timeout on much larger sprints), not silently ignored — but not fixed either. If this becomes a real problem, the fix is either a hard cap with a clear "sprint too large" message, or moving to incremental/background fetching.

## Release state

v1.0.0. Deployed to Forge `development`, `staging`, and `production` environments, all installed on `prediktivity.atlassian.net`. Being prepared for Atlassian Marketplace submission (broader distribution beyond internal use) — see `.claude/MARKETPLACE-APPROVAL-GUIDELINES.md`.
