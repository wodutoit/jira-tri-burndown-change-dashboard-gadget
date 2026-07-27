# TRI Sprint Dashboard Gadgets

A standalone Atlassian Forge app providing five Jira dashboard gadgets for sprint reporting:

| Gadget | What it shows |
| --- | --- |
| **TRI Burndown** | Sprint burndown with four lines: Ideal, Dev Remaining, Review Remaining, Remaining |
| **TRI Scope Change** | Daily net story-point scope change, as a chart, table ("Sprint Change Events"), or both |
| **TRI Rework** | Daily test-failure kickback count, as a chart, table ("Sprint Rework Events"), or both |
| **TRI Cycle Time** | Per-issue business hours spent in In Progress / Blocked / Code Review / Test, with estimate-vs-actual highlighting |
| **TRI Sprint Filter** | A live Space/Sprint picker other gadgets on the same dashboard can follow, so you only pick the sprint once (see "Dashboard sprint filter" below) |

The first four are ports of a reference Python reporting script (issue-changelog analysis + Excel dashboard) into live, self-configuring Jira gadgets. This project has no dependency on any other repo or app — it's a complete, self-contained Forge app you can `forge register` and deploy on its own.

This README is for developers working on the code. If you just want to add and configure these gadgets on your own dashboard, see **[USAGE.md](USAGE.md)** instead.

## Stack

- **Backend**: Node.js Forge resolver (`src/index.js`), using `@forge/resolver` and `@forge/api` (Jira REST calls via `asUser()`)
- **Frontend**: React + Vite Custom UI (`static/gadgets/`) — every gadget's view and edit mode share one built bundle; `main.jsx` decides which component to render based on the Forge context (see "How the multi-gadget pattern works" below). Charts are rendered with Recharts.
- **Storage**: `@forge/kvs` caches the expensive part — issues + full changelog for a sprint — keyed by `(sprintId, storyPointsFieldId)`. All four reporting gadgets share this cache when pointed at the same sprint, so only one Jira fetch happens regardless of how many TRI-* widgets are on a dashboard. Active sprints re-fetch after 5 minutes; closed sprints are cached indefinitely (each gadget has a manual Refresh button to force a re-fetch). Storage also holds the current TRI Sprint Filter selection per dashboard (see below). **Note:** this app previously depended on the `@forge/storage` package using a bare `const { storage } = require('@forge/storage')` pattern that doesn't actually exist in that package's v2 API (it has no ready-made `storage` export) — every `storage.get`/`storage.set` call was silently failing and swallowed by a `catch (_) {}`, so caching never worked at all until this was caught and fixed by switching to `@forge/kvs`'s `kvs` export, which Atlassian's current docs confirm is the correct/supported package.

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
    Tri*GadgetView.jsx           One view component per gadget (including TriSprintFilterGadgetView)
    Tri*GadgetEdit.jsx           One edit component per gadget (including TriSprintFilterGadgetEdit)
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

## Dashboard sprint filter

TRI Sprint Filter is a fifth, minimal gadget: its edit screen only asks for a Space, and its view mode is a live Sprint dropdown you interact with directly on the dashboard (not via edit/Save). Selecting a sprint there persists the choice via `@forge/kvs` (scoped per dashboard, via `context.extension.dashboard.id`) and broadcasts it live over the Custom UI `events` bridge (`useDashboardFilter.js`) so any of the other four gadgets already open on the same dashboard update immediately.

Each of the four reporting gadgets has its own **"Use dashboard sprint filter"** checkbox (in Section 2, next to Sprint — off by default). When on, `useEffectiveSprintSource.js` overrides that gadget's own Space/Sprint with the filter's current value, falling back to its own configured Space/Sprint if no filter gadget exists yet on the dashboard. SP Field, Status Mapping, and Grace Window always stay per-gadget config — they're not part of the filter.

Status Mapping is the one wrinkle: it's built against a specific project's actual status names, so it can't blindly follow a filter that might point at a different project. If the filter's Space matches what a gadget's mapping was configured against, the saved mapping is used unchanged. If the filter switches to a different Space, the gadget falls back to the same best-guess default mapping used the first time you pick a Space in edit mode, and shows a small "using a best-guess status mapping" note in its header. Re-edit the gadget while the filter points at that Space to fix the mapping properly.

### Known simplifications

- The sprint picker uses the project's first board. If a project has multiple boards, only the first one returned by Jira is used.
- The sprint picker's "Closed" group only lists the 10 most recently closed sprints (all active sprints are always listed). Older sprints aren't selectable from the dropdown.
- The project picker fetches up to 100 projects in one page — add pagination if your site has more.
- Business-hours math (TRI Cycle Time) uses a single fixed UTC offset, not a real IANA timezone — no daylight-saving transitions.
- `getSprintRawData` (`src/index.js`) paginates through every issue in a sprint with its full changelog, with no cap on issue count or page count. Tested and confirmed working with a ~100-issue sprint. Larger sprints (or issues with very long changelog histories) will take proportionally longer to fetch on a cache miss, and could risk hitting the Forge function execution time limit — if you regularly run sprints much larger than ~100 issues, test against one before relying on this in production.
- If more than one TRI Sprint Filter gadget is added to the same dashboard, they share the same dashboard-scoped storage entry — whichever one you last changed wins. There's no real use case for adding more than one, so this isn't guarded against.
- The Custom UI `events` bridge used for live filter updates is in-page only, not persisted — it's why the filter's selection is also written to storage, so gadgets that mount before/after the filter gadget, or after a page reload, still pick it up on their initial load rather than only on the next live change.

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

Five gadgets are implemented and manually tested against live sprint data. There are no automated tests or CI configured — smoke-test each gadget against an active and a closed sprint (including edge cases like a backdated sprint start date and weekend transitions), and the dashboard filter's live update + fallback behavior, before deploying a change.

If distributing this app beyond your own org (e.g. Atlassian Marketplace), note that packaging/listing requirements (privacy policy, EULA, support contact, security self-assessment, scopes justification) are tracked separately from this technical README.
