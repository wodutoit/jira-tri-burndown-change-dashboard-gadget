# Using TRI Sprint Dashboard Gadgets

Nine Jira dashboard gadgets for sprint/iteration reporting, plus a project-level **Capacity** tab (see its own section below):

| Gadget | What it shows |
| --- | --- |
| **TRI Burndown** | A sprint burndown chart with four lines: Ideal, Dev Remaining, Review Remaining, and Remaining |
| **TRI Scope Change** | How much story-point scope was added or removed each day of the sprint, as a chart, a table of individual events, or both |
| **TRI Rework** | How often work gets kicked back out of testing, as a chart, a table of individual events, or both |
| **TRI Cycle Time** | How many business hours each issue spent In Progress, Blocked, in Code Review, and in Test, compared against its story-point estimate |
| **TRI Sprint Filter** | A space/sprint picker other TRI gadgets on the same dashboard can follow, so you only have to pick the sprint once |
| **TRI Velocity** | Capacity/Committed/Velocity per closed sprint or completed iteration, from each space's Capacity data — one chart per space, with an optional combined Total across spaces |
| **TRI Kanban Burnup** | A cumulative burn-up chart (Target/Development/Review/Testing) for a Kanban iteration |
| **TRI Kanban Rework** | Same as TRI Rework, but for a Kanban iteration instead of a sprint |
| **TRI Kanban Cycle Time** | Same as TRI Cycle Time, but for a Kanban iteration instead of a sprint |

All four Scrum reporting gadgets together on one dashboard:

![All four TRI gadgets on one dashboard](docs/screenshots/TRI-Full-Dashboard.png)

## Adding a gadget to your dashboard

1. Open the dashboard you want to add it to.
2. Click **Add gadget** (usually in the top-right of the dashboard).
3. Search for **TRI Burndown**, **TRI Scope Change**, **TRI Rework**, **TRI Cycle Time**, **TRI Sprint Filter**, **TRI Velocity**, **TRI Kanban Burnup**, **TRI Kanban Rework**, or **TRI Kanban Cycle Time** and add it.
4. The gadget appears with a message asking you to configure it — click **Edit** on the gadget to open its settings.

## Configuring a gadget

TRI Burndown, TRI Scope Change, TRI Rework, and TRI Cycle Time walk through the same first few settings (TRI Sprint Filter and TRI Velocity are configured differently — see their own sections below):

1. **Space** — pick the Jira project you want to report on. You'll see every project you have access to.
2. **Sprint** — leave this on **"Active Sprint (auto)"** and the gadget will always show whichever sprint is currently active for that project, automatically moving to the next sprint once the current one closes — no need to touch this again. Or pick a specific sprint (including a closed one) if you want the gadget locked to that sprint for a historical view.
3. **Story Points Field** — pick the field your team uses for story points.
4. **Status → Phase Mapping** — for each status in your project's workflow, tell the gadget what it represents: To Do, In Progress, Blocked, Review, Test, Done, or Excluded (for things like "Won't Do" or "Not Required" that should drop out of the sprint's scope entirely). This is what lets the gadget work with your team's actual workflow instead of assuming fixed status names.
5. **Commitment Grace Window** — how many hours after a sprint's recorded start date a ticket can still be added and count as originally "committed" scope, rather than as a mid-sprint scope change. The default of 12 hours works for most teams. If your sprint's recorded start date doesn't match when the sprint was actually started (for example, if it was started later than the date on record), widen this to cover the gap.

Right below Sprint is a checkbox, **"Use dashboard sprint filter"** (off by default). Turn it on if you've added a **TRI Sprint Filter** gadget to this dashboard (see below) and want this gadget to follow whatever space/sprint it's currently set to, instead of the Space/Sprint you pick above. You still need to pick a Space and Sprint above either way — they're what the gadget uses to build the Status Mapping list.

![TRI Burndown's config screen showing the shared Space / Sprint / Story Points Field / Status Mapping / Commitment Grace Window steps](docs/screenshots/TRI-Burndown-Config.png)

Click **Save** once you're happy with the settings — the gadget will load your sprint data right away.

## TRI Burndown

![TRI Burndown chart with Committed, Dev Remaining, Review Remaining, and Remaining stat chips above a four-line chart](docs/screenshots/TRI-Burndown.png)

## TRI Scope Change and TRI Rework: chart, table, or both

Both of these gadgets add one more setting: **Display As**, with four options — Chart, Table, Both (side by side), or Both (stacked). If you pick just Chart or just Table, a small toggle button next to the gadget's Refresh button lets you switch views on the fly without reopening the settings.

Chart only:
![TRI Scope Change showing only the daily net scope-change bar chart](docs/screenshots/TRI-Scope-Change-Chart-Only.png)

Table only — every individual scope-change event:
![TRI Scope Change showing only the Sprint Change Events table](docs/screenshots/TRI-Scope-Change-Table-Only.png)

Both, side by side (this is what "Both" looks like on a wide enough dashboard column — it stacks into one column automatically on narrow ones):
![TRI Scope Change chart and table side by side](docs/screenshots/TRI-Scope-Change-Chart-Table-Sidebyside.png)

TRI Rework works the same way — a chart of how often work gets sent back out of testing, and/or a table of each individual rework event:
![TRI Rework chart and table side by side](docs/screenshots/TRI-Rework-Chart-Table-Sidebyside.png)

## TRI Cycle Time

Adds two more settings beyond the shared ones:
- **Hours per Story Point** — how many business hours count as one story point of effort (default: 4 hours, i.e. 2 points per 8-hour day).
- **Business Hours** — your team's working hours and time zone offset (default: 9am–5pm, UTC+10), used to calculate how much time was actually spent working on each issue rather than counting nights and weekends.

![TRI Cycle Time's config screen showing the Hours per Story Point and Business Hours settings](docs/screenshots/TRI-Cycle-Time-Config.png)

It has no chart — just a table, one row per issue, showing each issue's story-point estimate against the business hours (and SP-equivalent) it actually spent in each phase:

![TRI Cycle Time table with SP Estimate, Total Cycle Time SP, In Progress, Blocked, Code Review, and Test columns](docs/screenshots/TRI-Cycle-Time.png)

## TRI Sprint Filter — pick the sprint once for the whole dashboard

If you've got several TRI gadgets on one dashboard and keep changing the same sprint on each of them one by one, add a **TRI Sprint Filter** gadget instead. Its own settings only ask for a Space; the Sprint itself is picked directly on the dashboard, right in the gadget — no Edit screen round-trip needed.

To use it:

1. Add the **TRI Sprint Filter** gadget and set its Space in Edit mode.
2. On each other TRI gadget you want to follow it, edit the gadget and turn on **"Use dashboard sprint filter"**.
3. Change the sprint in the TRI Sprint Filter gadget — every gadget with the toggle on updates automatically, without needing a page refresh.

If a gadget has the toggle on but the filter points at a different space than the one it was configured with, it falls back to a best-guess status mapping for that space and shows a small note saying so — edit the gadget while the filter points at that space to fine-tune the mapping.

## TRI Velocity

Capacity, Committed, and Velocity story points per closed sprint or completed iteration. This gadget doesn't calculate anything itself — it reads the same numbers already saved on each space's own **Capacity** tab (see below), so a space needs **Capacity Planning enabled** before you can add it here. Unlike the other gadgets, its Edit screen doesn't ask for a single Space/Sprint — it asks for one or more **spaces**, since it's meant to work either as a single team's velocity trend or a multi-team rollup:

1. Pick a **Space** from the list (only Capacity-enabled spaces are offered). Click **+ Add another space** to add more. There's no Story Points Field, Status Mapping, or Grace Window to set here — those live on the space's own Capacity Settings page now.
2. Set **Sprints/iterations to show** (default, 1–10) — you can change this on the gadget itself later without editing the config.
3. Turn **Show/hide the Capacity bar** on or off (on by default) — this controls whether each chart shows a third bar for Capacity alongside Committed and Velocity.
4. With **more than one space**, two extra checkboxes appear: show a **Total** chart summing every space's numbers, and/or **only** show that Total (hiding the individual space charts).
5. With **exactly one space**, a **"Use dashboard sprint filter"** checkbox appears instead — turn it on to have this gadget follow whichever space a TRI Sprint Filter gadget on the same dashboard is set to. Only the *space* is followed; the sprint filter's sprint selection doesn't apply here, since TRI Velocity always shows a trend across several closed sprints/completed iterations rather than one sprint at a time.

Each space's chart shows a blue bar for Capacity (if shown), a grey bar for Committed, and a green bar for Completed, per sprint/iteration — plus that space's averages across the periods shown. If a sprint or iteration's Committed/Velocity was never calculated on its Capacity tab yet (no "Get SP Count"/"Get Velocity" click there), it shows as `0` here rather than being computed on the fly.

The Total chart (when enabled) lines sprints/iterations up by recency — "most recent", "2nd most recent", and so on — rather than by calendar date, since different spaces close their sprints (or complete their iterations) on their own schedules.

## Capacity — a project tab, not a dashboard gadget

Everything above is a dashboard gadget. **Capacity** is different: it's a tab that appears on a **project's** own pages (next to Summary, Board, Reports, …), not something you add to a dashboard.

1. Go to the project you want to enable it for, open **Project settings**, and find **Capacity Planning**.
2. Turn on **Enable Capacity Planning for this space**, then set **Base Capacity** (story points per sprint/iteration), **Default Sprint/Iteration Length** (weeks — Kanban projects only), the **Story Points Field**, and the **Commitment Grace Window** (same meaning as the other gadgets' setting). Kanban projects also get a **Committed Statuses** checklist, an **Apply Label Filter to Committed** checkbox (off by default), and an **Allow multiple active iterations** checkbox (off by default).
   - There's also a **Board Type** setting, defaulted to **Auto-detect**. It shows what it currently detects (Scrum or Kanban) right in the dropdown. If your project shows the wrong table — sprints when you expected iterations, or vice versa — switch this to **Force Scrum** or **Force Kanban** instead of relying on auto-detection. (This mainly affects newer "team-managed" projects, where Jira doesn't always expose enough information to tell Scrum and Kanban boards apart automatically.)
   - **Committed Statuses** (Kanban only) lists every status in your project with a checkbox — check the ones that should count toward a ticket being "committed". It starts pre-checked to match every In Progress-category status (not Done — a ticket that finished long ago and hasn't been touched since shouldn't count toward a brand-new iteration), so it works out of the box, but if your team has a custom status that Jira treats as "To Do" but you actually treat as already-committed (a "Team Estimated" status, for example), check that one too — and if your workflow genuinely needs a Done-category status counted, you can check that too. There's a "Reset to default" link once you've customized it, in case you want to go back to the automatic category-based set.
3. Reload the project — a new **Capacity** tab now appears in its navigation. (Jira only checks this setting when the project loads, so a change here needs a reload to show up as a tab appearing or disappearing.)
4. Open the **Capacity** tab. What you see depends on whether the project uses a Scrum or Kanban board:
   - **Scrum** — a table of the project's sprints (Active and Future always shown; Closed sprints hidden by default, with a checkbox to show them). Once you show closed sprints, a **Show** dropdown next to the checkbox lets you pick how many (3, 5, 10, 15, or All) instead of always seeing the same fixed number. You can't add, remove, start, or complete sprints from here — a notice above the table links to the **Backlog** tab for that. You *can* edit a sprint's **Goal** and **dates**, and its **Capacity**/**Committed**/**Velocity** numbers.
   - **Kanban** — Kanban boards have no concept of a sprint, so this app lets you define your own **iterations**: click **+ Add Iteration** to create one (Name, Description, Capacity, Start/End dates, Status, and an optional Label Filter), and use the Edit/Delete icons on each row to manage them. You can also change an iteration's status directly in the table. Completed iterations are hidden by default, same as closed sprints — uncheck **Hide completed iterations** and a matching **Show** dropdown (3, 5, 10, 15, or All) lets you pick how many of the most recent ones to see.
5. For every row: **Capacity** defaults to your Base Capacity setting but can be typed over per row. **Committed** has a **Get SP Count** button to calculate it (and can also be typed in by hand). **Velocity** has a **Get Velocity** button that works whether the sprint/iteration is still open or already closed — but the number itself only becomes hand-editable once it's Closed/Completed. When an iteration has a **Label Filter** set, **Get Velocity** always only counts issues carrying that exact label; **Get SP Count** only respects it if you've turned on **Apply Label Filter to Committed** in settings (off by default).

If you turn on **Allow multiple active iterations** (Kanban only), you can have more than one Active iteration at a time. Leave it off (the default) and trying to activate a second iteration while one is already Active shows an error telling you which one to change first — nothing gets changed automatically behind your back.

## TRI Kanban Burnup, TRI Kanban Rework, and TRI Kanban Cycle Time

These three are Kanban-only siblings of the Scrum gadgets above, reporting against a **Capacity iteration** (see the Capacity section above) instead of a Jira sprint — so a space needs **Capacity Planning enabled with a Kanban board** before any of them will have anything to point at.

Their Edit screen follows a similar flow to "Configuring a gadget" above, with Iteration in place of Sprint:

1. **Space** — only Capacity-enabled Kanban spaces are listed.
2. **Iteration** — leave this on **"Active Iteration (auto)"** to always track whichever iteration is currently Active on that space's Capacity tab, or pick a specific one (including a completed iteration) for a historical view.
3. **Story Points Field** and **4. Status → Phase Mapping** — same as the Scrum gadgets.

There's no Commitment Grace Window setting and no "Use dashboard sprint filter" checkbox for these three — neither concept applies to a Kanban iteration.

- **TRI Kanban Burnup** shows a cumulative burn-up: a dashed **Target** line ramping from 0 to the iteration's Committed SP (whatever that iteration's **Get SP Count** on the Capacity tab last calculated), plus **Development**, **Review**, and **Testing** lines showing story points that have reached that stage (or any later one) since the iteration began. It's chart-only — there's no table view.
- **TRI Kanban Rework** and **TRI Kanban Cycle Time** work exactly like TRI Rework and TRI Cycle Time — same chart/table options, same columns — just reading the selected iteration's issues instead of a sprint's.

## Keeping data fresh

Each gadget caches its sprint data briefly to load faster — active sprints refresh automatically every 5 minutes, and closed sprints are cached until you ask for fresh data. Every gadget has a small **Refresh** button (with a ⟳ icon) to force an immediate update.

## Things to know

- If your project has more than one Scrum board, the gadget uses the first one Jira returns.
- Business-hours calculations (TRI Cycle Time) use a single fixed time-zone offset rather than a full time zone, so they don't automatically adjust for daylight saving.
- Very large sprints (roughly 100+ issues with long histories) may take longer to load the first time, since the gadget reads each issue's full status history.
- TRI Sprint Filter's live updates only reach gadgets already open in your browser tab. If you change the filter and another gadget doesn't seem to follow, refresh the page — it'll pick up the current selection on load either way.
- TRI Velocity reads whatever a space's Capacity tab has already calculated — it doesn't calculate anything itself. If a sprint or iteration's Committed/Velocity was never fetched there (no "Get SP Count"/"Get Velocity" click yet), TRI Velocity shows `0` for it rather than computing a number on its own.
- Capacity has no control over exactly where its tab lands in a project's navigation — if you want it next to Reports specifically, drag it there yourself using Jira's own tab customization, the same way you'd move a Tempo or Time Tracker tab.
- Kanban iterations are entirely defined inside this app — they don't show up anywhere else in Jira (no calendar entry, no board marker). Deleting an iteration only removes it from this table; it never touches the underlying issues.
- TRI Kanban Burnup's Target line is only as good as that iteration's Committed value on the Capacity tab — if **Get SP Count** has never been run for it, Target just ramps from 0 to 0.

## Getting help

See [SUPPORT.md](SUPPORT.md) for how to report a problem or ask a question.
