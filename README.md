# TRI Sprint Dashboard Gadgets

A standalone Atlassian Forge app providing six Jira dashboard gadgets for sprint reporting:

| Gadget | What it shows |
| --- | --- |
| **TRI Burndown** | Sprint burndown with four lines: Ideal, Dev Remaining, Review Remaining, Remaining |
| **TRI Scope Change** | Daily net story-point scope change, as a chart, table ("Sprint Change Events"), or both |
| **TRI Rework** | Daily test-failure kickback count, as a chart, table ("Sprint Rework Events"), or both |
| **TRI Cycle Time** | Per-issue business hours spent in In Progress / Blocked / Code Review / Test, with estimate-vs-actual highlighting |
| **TRI Sprint Filter** | A live Space/Sprint picker other gadgets on the same dashboard can follow, so you only pick the sprint once (see "Dashboard sprint filter" below) |
| **TRI Velocity** | Capacity/Committed/Velocity per closed sprint or completed iteration, read from each space's Capacity data — one chart per configured space, with an optional combined Total (see "Velocity gadget" below) |

The first four are ports of a reference Python reporting script (issue-changelog analysis + Excel dashboard) into live, self-configuring Jira gadgets. This project has no dependency on any other repo or app — it's a complete, self-contained Forge app you can `forge register` and deploy on its own.

This README is for developers working on the code. If you just want to add and configure these gadgets on your own dashboard, see **[USAGE.md](USAGE.md)** instead.

## Stack

- **Backend**: Node.js Forge resolver (`src/index.js`), using `@forge/resolver` and `@forge/api` (Jira REST calls via `asUser()`)
- **Frontend**: React + Vite Custom UI (`static/gadgets/`) — every gadget's view and edit mode share one built bundle; `main.jsx` decides which component to render based on the Forge context (see "How the multi-gadget pattern works" below). Charts are rendered with Recharts.
- **Storage**: `@forge/kvs` caches the expensive part — issues + full changelog for a sprint — keyed by `(sprintId, storyPointsFieldId)`. Every reporting gadget (including TRI Velocity, per closed sprint it charts) shares this cache when pointed at the same sprint, so only one Jira fetch happens regardless of how many TRI-* widgets are on a dashboard. Active sprints re-fetch after 5 minutes; closed sprints are cached indefinitely (each gadget has a manual Refresh button to force a re-fetch). Storage also holds the current TRI Sprint Filter selection per dashboard (see below). **Note:** this app previously depended on the `@forge/storage` package using a bare `const { storage } = require('@forge/storage')` pattern that doesn't actually exist in that package's v2 API (it has no ready-made `storage` export) — every `storage.get`/`storage.set` call was silently failing and swallowed by a `catch (_) {}`, so caching never worked at all until this was caught and fixed by switching to `@forge/kvs`'s `kvs` export, which Atlassian's current docs confirm is the correct/supported package.

## Prerequisites

- Node.js (matches `manifest.yml`'s `nodejs22.x` runtime)
- [Forge CLI](https://developer.atlassian.com/platform/forge/getting-started/) installed and logged in (`forge login`)
- A Jira Cloud site to install on

## Project layout

```text
manifest.yml                 Forge app manifest (modules, scopes, resource)
src/index.js                 Resolver — all backend logic, Jira API calls, and the burndown/
                              scope-change/rework/cycle-time computations
static/gadgets/              React frontend (Vite)
  src/main.jsx                Bootstraps whichever gadget's view/edit matches the Forge context
  src/styles.css              Design tokens (light/dark) + a couple of shared form classes
  src/gadget/
    gadgetUtils.js               Shared status-color helper + localTodayISO() (see note below)
    sprintConfigShared.jsx       Shared constants (phase options, styles) + Section/DisplayModeSection
    useSprintSourceConfig.js     Shared hook: Space -> Sprint -> SP Field -> Status Mapping -> Grace
                                 Window -> "use dashboard filter" state/loading, used by every
                                 reporting gadget's edit screen
    SprintSourceFields.jsx       Shared presentational form for the above
    useDisplayMode.js            Shared chart/table/both view-mode logic (Scope Change, Rework)
    useDashboardFilter.js        Reads the TRI Sprint Filter gadget's current selection for this
                                 dashboard (storage + live Custom UI events)
    useEffectiveSprintSource.js  Resolves each reporting gadget's actual Space/Sprint/Status-Mapping
                                 — own config, or the dashboard filter's override
    IssueLink.jsx                Shared "open this issue in Jira" link (uses router.open — plain
                                 <a target="_blank"> is blocked inside the Custom UI iframe sandbox)
    VelocitySpaceRow.jsx         One space's picker row in TRI Velocity's edit screen — just a
                                 Space select, no SP Field/Status Mapping/Grace Window (those come
                                 from the space's own Capacity settings now)
    useVelocityEffectiveSpaces.js Single-space TRI Velocity configs only: resolves the dashboard
                                 filter's Space override (Sprint is ignored — see below)
    Tri*GadgetView.jsx           One view component per gadget (including TriSprintFilterGadgetView)
    Tri*GadgetEdit.jsx           One edit component per gadget (including TriSprintFilterGadgetEdit)
    TriCapacitySettingsPage.jsx  jira:projectSettingsPage — Capacity Planning toggle + settings
                                 (Base Capacity, iteration length, SP field, grace window)
    TriCapacityPage.jsx          jira:projectPage — the "Capacity" tab; branches Scrum vs Kanban
    CapacityTableShared.jsx      StatusChip/InlineNumberField/HideClosedToggle/CapacityTableRow
                                 shared by both the Scrum and Kanban Capacity tables
    useCapacityRows.js           Shared loading/inline-edit-save hook for the Capacity table,
                                 parameterized by resolver names (Scrum sprints vs Kanban iterations)
    CapacityScrumTab.jsx         Capacity page content for Scrum projects (real Jira sprints)
    ScrumSprintEditDialog.jsx    Edit a sprint's Goal + dates only (no add/remove/start/complete —
                                 see "Capacity project tab" below)
    CapacityKanbanTab.jsx        Capacity page content for Kanban projects (app-invented iterations)
    KanbanIterationDialog.jsx    Add/Edit dialog for a Kanban iteration
  build/                      Built output (what manifest's `resources` points at) — gitignored
```

## First-time setup

```bash
npm install
cd static/gadgets
npm install
cd ../..
```

Register a new Forge app (this writes an `id` into `manifest.yml` — without it, `forge deploy` will fail):

```bash
forge register
```

Follow the prompts to name your app.

## Local development

Build the frontend before every deploy — Forge serves the static `build/` output, it doesn't build it for you.

```bash
cd static/gadgets
npm run build
```

Install the app to a domain you have admin access to:

```bash
forge install
```

To iterate on the resolver against a live Jira site without redeploying each time:

```bash
forge tunnel
```

## Deploying

From the repo root, after building the frontend:

```bash
forge lint
forge deploy
```

`forge deploy` defaults to the `development` environment. For other environments:

```bash
forge deploy -e staging
forge deploy -e production
```

### Installing on a site

```bash
forge install -e development -s <your-site>.atlassian.net -p jira
```

### Important: manifest changes need `install --upgrade`, not just `deploy`

If you ever add a new module (another gadget), a new scope, or anything else in `manifest.yml`, a plain `forge deploy` only updates code — it does **not** push the manifest change to sites that already have the app installed. You'll deploy, refresh Jira, and the new gadget just won't be there. Always follow a manifest change with:

```bash
forge install --upgrade -e <environment> -s <your-site>.atlassian.net -p jira --confirm-scopes --non-interactive
```

Check what's actually live with:

```bash
forge install list
```

## Configuring a gadget

Every TRI-* gadget shares the same first steps in its edit screen:

1. **Space** — pick a Jira project. The list comes from every project visible to whoever is editing.
2. **Sprint** — defaults to **"Active Sprint (auto)"**, which re-resolves the project's current active sprint on every load (so it keeps working after a sprint closes and the next one starts, with no config change needed). Pick a specific sprint instead to pin the widget to it — typically a closed sprint, for a historical view.
3. **Story Points Field** — pick the numeric custom field your site uses for story points.
4. **Status → Phase Mapping** — assign every status in the project's workflow to one of: To Do, In Progress, Blocked, Review, Test, Done, or Excluded. This mapping drives all the burndown/scope/rework/cycle-time math — there's no hardcoded status-name list, so it works with any team's custom workflow.
5. **Commitment Grace Window** (hours, default 12) — tickets added to the sprint within this many hours of the sprint's recorded start date count as "committed" scope; anything later counts as mid-sprint scope change. If a sprint's start date was backdated (started later than the date recorded), widen this to cover the gap.

TRI Scope Change and TRI Rework add a **Display As** choice (Chart / Table / Both side-by-side / Both stacked). When showing just one of Chart or Table, a toggle next to the gadget's Refresh button lets viewers switch between them live without editing the config.

TRI Cycle Time adds **Hours per Story Point** (default 4h = 1 SP) and a **Business Hours** window (start hour / end hour / UTC offset, default 9–17 UTC+10) used for its business-hours math — it has no chart, only the cycle-time table.

## Velocity gadget

TRI Velocity doesn't follow the shared Space → Sprint → SP Field → Status Mapping → Grace Window flow above, and unlike every other gadget in this app, **it computes nothing itself** — it reads the same Capacity/Committed/Velocity numbers already saved by each space's own Capacity tab (see "Capacity project tab" below), so its Edit screen is much smaller than the other gadgets':

- **Spaces** — pick one or more Jira projects ("+ Add another space"). The picker (`getCapacityEnabledProjects` in `src/index.js`) only lists projects that have **Capacity Planning enabled** — a space with it off has never had these numbers computed, so there'd be nothing to chart. There's no Story Points field, Status Mapping, or Grace Window step here anymore; those all live on the space's own Capacity Settings page now.
- **Sprints/iterations to show** (default, 1–10) — viewers can change this on the gadget itself; it just re-slices already-fetched data, no refetch.
- **Show/hide the Capacity bar** — on by default. Turn it off to go back to the original two-bar (Committed/Velocity) look.
- One chart per configured space. With more than one space, two checkboxes appear: **"Show a Total chart summing all spaces"** and **"Only show the Total"** (hides the per-space charts).
- With exactly one space configured, a **"Use dashboard sprint filter"** checkbox appears instead. When on, a TRI Sprint Filter gadget on the same dashboard overrides *which space* is charted — its Sprint selection is ignored, since Velocity always trends across closed sprints/completed iterations rather than showing a single sprint. Overriding to a different space just means reading that space's own Capacity data instead — there's no config drift to reconcile, since there's no per-gadget Status Mapping to fall back to anymore.

**How Capacity/Committed/Velocity are populated:** for a Scrum space, each closed sprint's row comes from `capacity-rows:${projectKey}` in `@forge/kvs` — whatever that sprint's Capacity tab last saved via its "Get SP Count"/"Get Velocity" buttons (or manual overrides). For a Kanban space, each completed iteration's row comes from `kanban-iterations:${projectKey}` the same way. **Capacity** falls back to the space's Base Capacity setting if that row's Capacity was never overridden; **Committed** and **Velocity** show `0` if that row's numbers were never calculated on the Capacity tab — this gadget never triggers that calculation itself, it only displays what's already there. This also means Velocity's numbers are always internally consistent with what that space's own Capacity tab shows, by construction (same stored data, not a parallel computation).

**The Total chart aligns by recency rank, not calendar date** — "most recent", "2nd-most-recent", etc. across spaces — since spaces on separate boards almost never close sprints/complete iterations on the same day. A space with fewer closed sprints/completed iterations than others just contributes to fewer of the more-recent ranks.

## Capacity project tab

Unlike the six dashboard gadgets above, Capacity isn't a `jira:dashboardGadget` — it's a `jira:projectPage` living in a *project's* own navigation (alongside Summary, Board, Reports, …), gated by a **Capacity Planning** toggle under that project's Settings (`jira:projectSettingsPage`). Both are per-space, not per-dashboard.

**Settings** (Project settings → Capacity Planning): the enable toggle, **Board Type** (Auto-detect / Force Scrum / Force Kanban — see below), **Base Capacity** (SP per sprint/iteration), **Default Sprint/Iteration Length** (weeks, Kanban only), the **Story Points field**, the **Commitment Grace Window** (hours, same meaning as the other gadgets' Grace Window), and — Kanban projects only — **Committed Statuses** (see below), **Apply Label Filter to Committed** (off by default — see below), and **Allow multiple active iterations** (off by default).

The Capacity tab detects whether the project's board is Scrum or Kanban and shows a different table. Detection reads the board's own `type` field when it's a classic (company-managed) board (`"scrum"`/`"kanban"`, always accurate); team-managed ("next-gen") boards always report `type: "simple"` regardless of which style they are, so for those it instead checks whether the board actually supports sprints. If that still guesses wrong for your setup, the **Board Type** setting lets you force it either way.

- **Scrum** — lists the project's Active, Future, and Closed (hidden by default) sprints. A persistent notice reminds you to use the **Backlog** tab to add, remove, start, or complete sprints — this table only edits an existing sprint's **Goal** and **dates** (never its name or state).
- **Kanban** — "iterations" have no Jira equivalent at all, so they're fully app-managed: Add/Edit/Delete, plus an inline Status dropdown (Future/Active/Completed) right in the table. A new iteration's Start date defaults to the day after the latest existing iteration's End date (or today, if none exist yet); its End date defaults to Start + the configured Default Iteration Length. Each iteration can optionally specify a **Label Filter** — when set, only issues carrying that exact Jira label count toward its Velocity (and toward Committed too, if the **Apply Label Filter to Committed** setting is turned on).

Every row (Scrum or Kanban) shows the same four numbers: **Capacity** (inline-editable, defaults to Base Capacity), **Committed** (inline-editable, with a "Get SP Count" button to (re)compute it), and **Velocity** (a "Get Velocity" button works any time, but the number itself is only hand-editable once the sprint/iteration is Closed/Completed).

**How Committed/Velocity are computed:** Capacity uses Jira's own built-in status *category* (To Do / In Progress / Done) rather than the other gadgets' custom Status Mapping — there's no 7-value mapping step to configure. For Scrum, this reuses the exact same `computeScopeFoundation`/`computeVelocity` math as TRI Burndown/Velocity, just fed a category-based mapping instead of a custom one. For Kanban, since there's no sprint field to scope a query by, Committed reconstructs each issue's status as of the iteration's start (+ grace window) from its changelog and checks it against the **Committed Statuses** setting — an explicit whitelist of status names, not the category directly, since a project can have a custom status (e.g. "Team Estimated") that Jira categorizes as To Do but the team treats as already-committed. Until customized, that whitelist defaults to every In Progress-category status (not Done — a ticket that's been sitting in a terminal Done status has nothing to do with a brand-new iteration just because it's never been touched since; check a Done-category status explicitly if your workflow genuinely needs it counted). An issue created after the cutoff is also excluded outright, even if its initial status happens to be one of the whitelisted ones — it didn't exist yet, so it can't have been part of what was committed at the iteration's start; that's mid-iteration scope, the Kanban equivalent of what the Commitment Grace Window already protects against for Scrum. Velocity scans issues (matching the iteration's Label Filter, if set) resolved within the iteration's date range that reached the Done category (unaffected by the Committed Statuses setting). Committed ignores the Label Filter by default — turn on **Apply Label Filter to Committed** in settings if it should scope Committed too.

**"Only one Active iteration" is enforced by blocking, not by auto-changing another row.** With "Allow multiple active iterations" off, trying to activate a second iteration while one is already Active shows an error naming the conflicting iteration — you decide what happens to it.

## Dashboard sprint filter

TRI Sprint Filter is a minimal gadget: its edit screen only asks for a Space, and its view mode is a live Sprint dropdown you interact with directly on the dashboard (not via edit/Save). Selecting a sprint there persists the choice via `@forge/kvs` (scoped per dashboard, via `context.extension.dashboard.id`) and broadcasts it live over the Custom UI `events` bridge (`useDashboardFilter.js`) so any other TRI-* gadget already open on the same dashboard updates immediately.

Each of the four Space+Sprint reporting gadgets (Burndown, Scope Change, Rework, Cycle Time) has its own **"Use dashboard sprint filter"** checkbox (in Section 2, next to Sprint — off by default). When on, `useEffectiveSprintSource.js` overrides that gadget's own Space/Sprint with the filter's current value, falling back to its own configured Space/Sprint if no filter gadget exists yet on the dashboard. SP Field, Status Mapping, and Grace Window always stay per-gadget config — they're not part of the filter. TRI Velocity has the same checkbox, but only when configured with exactly one space, and only the Space part of the filter applies — see "Velocity gadget" above.

Status Mapping is the one wrinkle: it's built against a specific project's actual status names, so it can't blindly follow a filter that might point at a different project. If the filter's Space matches what a gadget's mapping was configured against, the saved mapping is used unchanged. If the filter switches to a different Space, the gadget falls back to the same best-guess default mapping used the first time you pick a Space in edit mode, and shows a small "using a best-guess status mapping" note in its header. Re-edit the gadget while the filter points at that Space to fix the mapping properly.

### Known simplifications

- The sprint picker uses the project's first board. If a project has multiple boards, only the first one returned by Jira is used.
- The sprint picker's "Closed" group only lists the 10 most recently closed sprints (all active sprints are always listed). Older sprints aren't selectable from the dropdown.
- The project picker fetches up to 100 projects in one page — add pagination if your site has more.
- Business-hours math (TRI Cycle Time) uses a single fixed UTC offset, not a real IANA timezone — no daylight-saving transitions.
- `getSprintRawData` (`src/index.js`) paginates through every issue in a sprint with its full changelog, with no cap on issue count or page count. Tested and confirmed working with a ~100-issue sprint. Larger sprints (or issues with very long changelog histories) will take proportionally longer to fetch on a cache miss, and could risk hitting the Forge function execution time limit — if you regularly run sprints much larger than ~100 issues, test against one before relying on this in production.
- If more than one TRI Sprint Filter gadget is added to the same dashboard, they share the same dashboard-scoped storage entry — whichever one you last changed wins. There's no real use case for adding more than one, so this isn't guarded against.
- The Custom UI `events` bridge used for live filter updates is in-page only, not persisted — it's why the filter's selection is also written to storage, so gadgets that mount before/after the filter gadget, or after a page reload, still pick it up on their initial load rather than only on the next live change.
- TRI Velocity's Total chart joins spaces by recency rank (most-recent, 2nd-most-recent, …), not calendar date — see "Velocity gadget" above.
- TRI Velocity reads whatever's already saved on a space's Capacity tab — it never fetches or computes issue data itself, so it has no issue+changelog fetch cost at all anymore (unlike every other gadget in this app). The tradeoff: if a sprint/iteration's Committed or Velocity was never calculated on the Capacity tab (no "Get SP Count"/"Get Velocity" click yet), TRI Velocity just shows `0` for it rather than computing a number on the fly.
- A TRI Velocity gadget configured before this change (with a per-space Story Points Field/Status Mapping/Grace Window) keeps working, but those saved fields are now ignored — re-open and re-save the gadget to drop them, and make sure each configured space actually has Capacity Planning enabled, or it'll show all-zero Committed/Velocity.
- `getCapacityEnabledProjects` (`src/index.js`) checks every project's Capacity-enabled entity property individually (there's no bulk "projects with property X" search endpoint) — same up-to-100-projects page cap as the project picker, plus one extra request per project. One-off cost in Edit mode only, not a hot path.
- The Capacity tab has no control over where Jira places it in the project's nav (no manifest ordering property) — dragging it next to Reports, if you want that, is done through Jira's own tab customization.
- Kanban's Committed calculation scans every issue that was in one of the Committed Statuses within roughly a 4-day window around the calculation's cutoff instant (JQL's `status WAS IN (...) DURING (...)` operators — the `DURING` bound is required, not optional, since an unbounded `WAS IN` forces Jira to scan every matching issue's entire changelog history and previously caused a real 25-second Forge timeout on a long-running project). On a project with a very large volume of matching work in that window this could still be slower than the Scrum path, though it shares the same underlying pagination approach already used (and tested) elsewhere in this app.
- If a Kanban project's **Committed Statuses** setting is left with nothing checked (its default, un-customized state), Committed is calculated as if every In Progress/Done-category status were checked — same as the old category-only behavior. If you explicitly uncheck every status (leaving zero selected), Committed always calculates as `0`, since there's nothing left to count.
- Every SP sum across the whole app (Burndown, Scope Change, Rework, Cycle Time, Velocity, Capacity) treats an Epic's own SP field as a fallback, not the source of truth: if the Epic has children (found via `parent = <epicKey>`), the sum of the children's SP is used instead, since teams usually point child stories rather than the Epic itself. If a child issue is also independently pulled into the same fetched batch as its Epic (e.g. both land in the same sprint, or both match a Kanban status/date scan — unusual, since Epics aren't normally sprint/board items), that child's SP is counted twice — this is a known, accepted edge case, not something this app tries to deduplicate across issues.

## How the multi-gadget pattern works

Every gadget in this app shares the **same** static bundle (`resource: main` in the manifest) instead of getting its own Vite build. `main.jsx` asks Forge for the current context and looks up the matching gadget:

```js
const GADGETS = {
  'sprint-tri-burndown-gadget': { view: TriBurndownGadgetView, edit: TriBurndownGadgetEdit },
  // ...one entry per gadget
};

const ctx = await view.getContext();
const gadget = GADGETS[ctx.moduleKey];
const Component = ctx.extension?.entryPoint === 'edit' ? gadget.edit : gadget.view;
```

`ctx.moduleKey` is whatever `key` you gave the `jira:dashboardGadget` entry in `manifest.yml`. `ctx.extension.entryPoint` is `'edit'` while the gadget's config screen is open, and unset (view mode) otherwise.

Each gadget's own config, once saved via `view.submit({...})` in its edit component, comes back on the next load as `ctx.extension.gadgetConfiguration`.

## Adding another gadget

1. **Manifest** — add a new entry under `jira:dashboardGadget` in `manifest.yml` (copy an existing one, change `key`/`title`/`description`).
2. **Backend** — add a `resolver.define('get<YourGadget>Data', ...)` to `src/index.js`. Reuse `resolveSprint()` and `getSprintRawData()` — they handle sprint resolution and the shared cached issue/changelog fetch, so your new resolver only needs its own compute function on top of `issueData`.
3. **Frontend** — create `Tri<YourGadget>GadgetView.jsx` and `Tri<YourGadget>GadgetEdit.jsx`. For the edit screen, use the `useSprintSourceConfig()` hook + `<SprintSourceFields {...cfg} />` for the shared Space/Sprint/SP-Field/Status-Mapping/Grace-Window steps, then add whatever fields your gadget needs.
4. **Register it** — add one line to the `GADGETS` map in `main.jsx`.
5. Build, then `forge deploy` **and** `forge install --upgrade` (see above — you changed the manifest).

## Status

Six gadgets are implemented and manually tested against live sprint data. There are no automated tests or CI configured — smoke-test each gadget against an active and a closed sprint (including edge cases like a backdated sprint start date and weekend transitions), TRI Velocity against a multi-space config with the Total chart on, and the dashboard filter's live update + fallback behavior, before deploying a change.

If distributing this app beyond your own org (e.g. Atlassian Marketplace), note that packaging/listing requirements (privacy policy, EULA, support contact, security self-assessment, scopes justification) are tracked separately from this technical README.
