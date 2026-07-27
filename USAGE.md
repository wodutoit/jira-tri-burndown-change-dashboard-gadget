# Using TRI Sprint Dashboard Gadgets

Five Jira dashboard gadgets for sprint reporting:

| Gadget | What it shows |
| --- | --- |
| **TRI Burndown** | A sprint burndown chart with four lines: Ideal, Dev Remaining, Review Remaining, and Remaining |
| **TRI Scope Change** | How much story-point scope was added or removed each day of the sprint, as a chart, a table of individual events, or both |
| **TRI Rework** | How often work gets kicked back out of testing, as a chart, a table of individual events, or both |
| **TRI Cycle Time** | How many business hours each issue spent In Progress, Blocked, in Code Review, and in Test, compared against its story-point estimate |
| **TRI Sprint Filter** | A space/sprint picker other TRI gadgets on the same dashboard can follow, so you only have to pick the sprint once |

All four reporting gadgets together on one dashboard:

![All four TRI gadgets on one dashboard](docs/screenshots/TRI-Full-Dashboard.png)

## Adding a gadget to your dashboard

1. Open the dashboard you want to add it to.
2. Click **Add gadget** (usually in the top-right of the dashboard).
3. Search for **TRI Burndown**, **TRI Scope Change**, **TRI Rework**, **TRI Cycle Time**, or **TRI Sprint Filter** and add it.
4. The gadget appears with a message asking you to configure it — click **Edit** on the gadget to open its settings.

## Configuring a gadget

Every gadget in this app walks through the same first few settings:

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

## Keeping data fresh

Each gadget caches its sprint data briefly to load faster — active sprints refresh automatically every 5 minutes, and closed sprints are cached until you ask for fresh data. Every gadget has a small **Refresh** button (with a ⟳ icon) to force an immediate update.

## Things to know

- If your project has more than one Scrum board, the gadget uses the first one Jira returns.
- Business-hours calculations (TRI Cycle Time) use a single fixed time-zone offset rather than a full time zone, so they don't automatically adjust for daylight saving.
- Very large sprints (roughly 100+ issues with long histories) may take longer to load the first time, since the gadget reads each issue's full status history.
- TRI Sprint Filter's live updates only reach gadgets already open in your browser tab. If you change the filter and another gadget doesn't seem to follow, refresh the page — it'll pick up the current selection on load either way.

## Getting help

See [SUPPORT.md](SUPPORT.md) for how to report a problem or ask a question.
