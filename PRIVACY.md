# Privacy Policy

**Effective date:** 20 July 2026

This policy describes what data the TRI Sprint Dashboard Gadgets app (TRI Burndown, TRI Scope Change, TRI Rework, TRI Cycle Time) accesses and stores when installed on your Jira Cloud site.

## What the app accesses

Each gadget reads data from your Jira site using the permissions of the person viewing or configuring it (via Atlassian Forge's `asUser()` API) — the app never accesses more than that person could already see in Jira themselves. Specifically, it reads:

- Project (space) names and keys
- Board and sprint metadata (name, state, start/end dates)
- Issue keys, issue type, status, creation date, and the story-points field you select in the gadget's configuration
- Issue changelog entries limited to status transitions and sprint-membership changes (added to/removed from a sprint)

The app does **not** access issue summaries, descriptions, comments, attachments, assignees, reporters, watchers, or any other issue content or user data beyond what's listed above.

## What the app stores

The app caches a trimmed subset of the above (issue keys, story-point values, status-change timestamps, sprint-membership event timestamps, and issue creation dates) in Forge Storage, which is hosted on Atlassian's infrastructure and scoped to your site's installation of this app. This cache exists purely to avoid re-fetching the same sprint data on every page load — it holds no data beyond what's described above, and no issue content or user-identifying information.

Each gadget's configuration (which space/sprint it's pointed at, its status-to-phase mapping, and its display settings) is stored using Jira's own standard dashboard-gadget configuration mechanism, not a separate database.

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
