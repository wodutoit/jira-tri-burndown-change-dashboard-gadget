# Portfolio Planning & Distribution — implementation plan

Status: **in progress** — steps 1–5 (settings, allocation model, actuals, Capacity page UI, dashboard gadget) implemented; step 6 (release prep) pending.
Stage: POC on a test Jira site. Not yet reviewed against DMSi standards (see "Before production").

Adds per-release portfolio allocation (a target % per category of a select-list field), a comparison of
those targets against the story points actually in the release's sprints, and a dashboard gadget to
visualise it.

## Decisions

| Area | Decision |
| --- | --- |
| Enable/disable | Per space (not site-wide). Scrum spaces only. Requires Release Mapping. Disabled = hidden on the Capacity page and unavailable to the gadget (picker *and* data resolvers). |
| Category field | One single-select (select list / radio) custom field per space. |
| Actuals | All tickets currently in the release's mapped sprints, deduped by issue key, current story points. |
| Unassigned | Visible bucket, counts toward the total, target 0% so always red when > 0. |
| Thresholds | **Relative to the target**: warn (default 10%) and critical (default 20%). 20% target → green 18–22%. |
| Minimum tolerance | Floor in percentage points (default 1, 0 = off). warn band = max(target × warn%, floor); critical band = max(target × critical%, 2 × floor). |
| Target of 0% | No band: any actual > 0 is critical, exactly 0 is ok. |
| Allocation validation | Each 0–100 (one decimal), total ≤ 100. Remainder shown as "Unallocated". Enforced client- and server-side. |
| Edit rights | Anyone who can open the space's Capacity page — decided: governed by Jira access control (anyone with access to the space can already change its tickets). |
| Total target (gadget) | Weighted by each space's capacity for the release (same capacity figure the release rollups use). Spaces with no allocation for that release are left out of the weights and flagged. |
| Charts | Donut with a target ring (default); bullet bars as an option. |

## Data model

- Settings (`capacity-settings:<project>`, KVS): `portfolioPlanningEnabled`, `portfolioFieldId`,
  `portfolioWarnPct`, `portfolioCriticalPct`, `portfolioMinTolerancePp`.
- Allocations (`portfolio-alloc:<project>`, KVS):
  `{ fields: { [fieldId]: { releases: { [versionId]: { alloc: { [optionId]: pct }, names: { [optionId]: name }, updatedAt } } } } }`.
  Bucketed by field so a field change never destroys the old field's allocations — they stop being read
  and return if the field is switched back. Writes carry `expectedUpdatedAt`; a mismatch returns a
  conflict instead of overwriting someone else's edit of the same release (different releases in the
  same space can still race at document level — accepted for now, same as `capacity-rows`).
- Actuals are never stored — computed from live issues and cached briefly.
- Everything is keyed by Jira **option id** (stable across renames). Names are only used to merge
  categories across spaces, since each space has its own field and option ids.

## When the option list changes

| Change in Jira | Behaviour |
| --- | --- |
| Option added | Shows in the popup at 0% with a "New" badge; tickets carrying it count against a 0% target (red until allocated). Banner: "N new options". |
| Option renamed | Nothing to do (id-keyed); label and stored name snapshot refresh on next save. |
| Option removed/disabled | Allocation kept; shown as struck-through "(removed) Name", still counts toward the 100% total until cleared; hatched segment in the bar. Tickets still carrying it show under the snapshot name. |
| Option reordered | Display follows Jira order; nothing stored. |
| Space field changed | Stored allocations ignored (not deleted) because `fieldId` no longer matches; bar shows "Portfolio field changed — re-allocate". Switching back restores them. |
| Release already shipped | Allocation is a historical snapshot; never raises new/removed-option warnings. |

Reconciliation happens on popup open / bar load and never silently edits saved data.

## Actuals calculation

- One search per release over its mapped sprint ids (`sprint in (…)`), fetching only the SP field and the
  portfolio field (no changelog), paged. Dedupe by issue key across the release's sprints (spillover).
- Actual % per option = option SP / total SP; unassigned tickets are in the total.
- Cache in KVS: 5 min TTL when the release has an active sprint, ~1 h otherwise. Bars load lazily.
- Epic SP: reuse the app's existing epic rollup (`resolveIssueSpValues`) so numbers match the rest of the app.
  A ticket with no field value is Unassigned (no inheritance from its epic).
- Known gap: "Total committed" in the summary table is the sprint-start snapshot, so it can differ from the
  portfolio total; the popup labels its basis.

## UI

**Capacity page** — in `ReleasesSummaryTable`, per visible release: a Portfolio button + allocation bar under
the Status chip. Segment width = allocation %; colour = status of actual vs target; grey segment =
unallocated; red "Unassigned x%" pill under the bar when > 0. Tooltips: name, target %, actual %,
SP/total SP, status word. Red segments are hatched and status is also in text (not colour-only).

**Popup** — every current option in Jira order, % input, actual share as a hint, live total, removed/new
option handling above.

**Gadget — TRI Portfolio Distribution** (one gadget, two modes, recharts):
- *By release, all spaces* — live release dropdown; one chart per configured space and a Total chart;
  Edit config "Show": spaces / total / both. Total merges categories by name (trimmed, case-insensitive).
- *By space, multiple releases* — one space, a "number of releases" dropdown, one chart per release.
- Chart style (Edit config): donut with outer ring = actual, inner ring = target, plus a legend table
  (actual %, target %, status dot); or bullet bars (bar = actual coloured by status, tick = target, shaded
  green/orange bands, rows sorted worst-first, Unassigned last).
- Slice colours = category identity (stable per name); green/orange/red only ever mean status.

## Build order

1. **Settings** ✅ per-space toggle (Scrum + Release Mapping gated, server-enforced), field picker, option
   discovery, relative thresholds + minimum tolerance with validation.
2. ✅ Allocation model: `getPortfolioAllocations` / `setPortfolioAllocation` resolvers, server-side
   validation in `src/portfolio.js` (unit tests: `npm test`), field-bucketed storage, conflict check.
   Option ids must be numeric (Jira option ids are); the client popup (step 4) repeats the same rules for
   feedback but the server is the authority.
3. ✅ Actuals: `getPortfolioActuals` resolver (Scrum only, one search per release, cached) and
   `aggregateActuals` in `src/portfolio.js` (unit tested), plus deviation logic (`classifyPortfolioShare`
   in `gadgetUtils.js`). Counting rules: deduped by issue key; **a ticket with no estimate counts as 1 SP**
   (an explicit 0 stays 0); blank-estimate subtasks count 0 (estimated subtasks count); no category →
   Unassigned. Epics get no rollup: an Epic in a sprint that has child issues is ignored (its children are
   counted directly); an Epic with no children counts with its own estimate like any ticket.
   Results include `unestimatedCount` so the UI can say "N tickets counted as 1 SP".
4. ✅ Capacity page: `PortfolioDialog` (allocation editor, new/removed-option handling, conflict-safe save),
   `PortfolioBar` (allocation bar under the Status chip, Unassigned pill, native tooltips, hatched red
   segments), `usePortfolio` hook, and `portfolioModel.js` (pure row/status model, unit tested). Saved
   `names` now snapshot every option known at save time so "new option" can be told apart from "left at 0%".
5. ✅ Gadget **TRI Portfolio Distribution** (`sprint-tri-portfolio-distribution-gadget`): both modes
   (`getPortfolioReleaseDistribution` / `getPortfolioRoadmapDistribution`), donut-with-target-ring and bullet
   bars (`PortfolioChart.jsx`), capacity-weighted Total (`mergeSpaceDistributions`, unit tested), Edit screen,
   `portfolioFilter` in `getCapacityEnabledProjects` (Portfolio on + field set; callers add
   `boardTypeFilter: 'scrum'`). New manifest module — needs `forge install --upgrade`. Edit rights stay
   governed by Jira access: anyone who can open the space's Capacity page can set allocations.
   Total thresholds = the most lenient of the contributing spaces' thresholds.
6. Release prep: `PRIVACY.md` ("What the app stores"), `USAGE.md`, Marketplace checklist, gadget
   description/icon/screenshots, version bump (1.7.0), build + deploy.

Pure functions (deviation, validation, dedupe, target weighting) are kept separate from I/O so they can be
tested without Jira; the repo has no test runner yet (proposal: Vitest for just those).

## Risks / things to verify

- **Option discovery needs Create Issue permission** (reads create-metadata `allowedValues`; the
  field-context options API needs Jira admin). Verify the call works under the current scopes
  (`read:jira-work`); if a new scope is needed that triggers `forge install --upgrade` + Marketplace re-review.
- Cross-space name mismatches split into separate slices (a "merge categories" mapping may be needed later).
- Large releases = several paged searches; test on the biggest release.
- If a Scrum space's board is later switched to Kanban, existing portfolio data stays but resolvers reject it.

## Before production

- Edit rights = anyone who can open the space's Capacity page (decided: governed by Jira access control). If that changes, run the
  DMSi standards lookup for authorization/access control (Tier 2 review) before this leaves POC.
- Update `PRIVACY.md` (new KVS key, new field read) and re-check `.claude/MARKETPLACE-APPROVAL-GUIDELINES.md`
  (gadget description must match behaviour; screenshots/icon).
- Commits: `[AI: Claude – portfolio planning]`.
