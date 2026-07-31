# Privacy Policy

**Effective date:** 20 July 2026

This policy describes what data the TRI Sprint Dashboard Gadgets app (TRI Burndown, TRI Scope Change, TRI Rework, TRI Cycle Time, TRI Sprint Filter, TRI Velocity, TRI Kanban Burnup, TRI Kanban Rework, TRI Kanban Cycle Time, and the Capacity project tab) accesses and stores when installed on your Jira Cloud site.

## What the app accesses

Each gadget reads data from your Jira site using the permissions of the person viewing or configuring it (via Atlassian Forge's `asUser()` API) — the app never accesses more than that person could already see in Jira themselves. Specifically, it reads:

- Project (space) names and keys
- Board and sprint metadata (name, state, start/end dates)
- Issue keys, issue titles (summary), issue type, status, creation date, and the story-points field you select in the gadget's configuration
- Issue changelog entries limited to status transitions and sprint-membership changes (added to/removed from a sprint)

Issue titles are shown in the gadgets' event tables so entries are identifiable at a glance, and link back to the issue in Jira. The app does **not** access issue descriptions, comments, attachments, assignees, reporters, watchers, or any other issue content or user data beyond what's listed above. Kanban projects' Capacity calculations also read issue labels, used only to optionally filter which issues count toward an iteration's Velocity.

The Capacity page's Scrum view can also **write** to Jira: editing a sprint's Goal and dates via its Edit dialog. This is the only place in the app that changes anything in your Jira site — every other feature is read-only. It never changes a sprint's name or its Active/Future/Closed state, and never creates or deletes a sprint.

## What the app stores

The app caches a trimmed subset of the above (issue keys, issue titles, story-point values, status-change timestamps, sprint-membership event timestamps, and issue creation dates) in Forge Storage, which is hosted on Atlassian's infrastructure and scoped to your site's installation of this app. This cache exists purely to avoid re-fetching the same sprint data on every page load — it holds no data beyond what's described above, and no user-identifying information.

Each gadget's configuration (which space/sprint it's pointed at, its status-to-phase mapping, and its display settings) is stored using Jira's own standard dashboard-gadget configuration mechanism, not a separate database.

If you use the TRI Sprint Filter gadget, its current space/sprint selection is stored in Forge Storage too, scoped to the specific dashboard it's on — no new category of data beyond what's already listed above, just the same space/sprint selection shared across gadgets on one dashboard instead of saved separately in each one.

TRI Velocity's configuration can list more than one space, but it no longer fetches or caches issue data itself — it reads the Committed/Velocity numbers already computed and stored by each space's own Capacity tab (see below), plus that space's Base Capacity setting. Its Edit screen only offers spaces that already have Capacity Planning turned on.

The Capacity project tab's on/off setting is stored as a Jira **project property** (`tri-capacity-planning`, a simple `true`/`false` flag) rather than in Forge Storage — this is a Jira platform mechanism, not something the app hosts, and it holds no data beyond that one flag per project. Its other settings (Base Capacity, default iteration length, story-points field, grace window) are ordinary Forge Storage, same as everything else in this section.

For **Kanban** projects, the Capacity page's "iterations" have no Jira equivalent at all, so their full content — name, description, capacity, start/end dates, status, an optional label filter, and the computed Committed/Velocity numbers — is stored entirely in Forge Storage, scoped per project. This is new in the sense that iteration names/descriptions are free text you type into this app (not sourced from Jira), but it's the same storage mechanism and hosting (Atlassian's Forge Storage) as everything else described here.

TRI Kanban Burnup, TRI Kanban Rework, and TRI Kanban Cycle Time cache the same kind of trimmed issue data described above (issue keys, titles, story points, status-change timestamps, labels), just keyed by Kanban iteration instead of by sprint — no new category of data, and their Edit screens only offer spaces that already have Capacity Planning turned on with a Kanban board.

## What the app does not do

- It does not send any data to servers outside Atlassian's platform. There are no third-party integrations, analytics, or tracking of any kind.
- It does not sell, share, or use your data for any purpose other than displaying the gadgets you've configured.
- It does not store data about who views a gadget — only about the sprint/issue data needed to render it.

## Data retention and removal

Cached sprint data for an active sprint refreshes automatically every 5 minutes, or on demand via each gadget's Refresh button. Cached data for a closed sprint persists until manually refreshed. Uninstalling the app from your site removes its stored data in line with Atlassian Forge's standard data handling for uninstalled apps.

## Access control

Because all Jira data access happens under the permissions of the user viewing or editing a gadget, only people with existing access to the relevant project and sprint in Jira can see that data through this app.

## Questions

For privacy-related questions, open an issue at [github.com/wodutoit/jira-tri-burndown-change-dashboard-gadget/issues](https://github.com/wodutoit/jira-tri-burndown-change-dashboard-gadget/issues). Please don't include sensitive information in a public issue — describe the question generally and we'll follow up for any details we need.
