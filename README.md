# Jira Dashboard Gadget Starter

A standalone Atlassian Forge app for building a **set of Jira dashboard gadgets**. It ships with one working example — **Sprint Status by Points** — and is structured so adding your next gadget is a copy-paste-and-rename exercise, not a redesign.

The example gadget: pick a Jira project ("space") in its edit view, and it shows the count of Stories and sum of story points per status in that project's active sprint.

This project has no dependency on any other repo or app — it's a complete, self-contained Forge app you can `forge register` and deploy on its own.

## Stack

- **Backend**: Node.js Forge resolver (`src/index.js`), using `@forge/resolver` and `@forge/api` (Jira REST calls via `asUser()`)
- **Frontend**: React + Vite Custom UI (`static/gadgets/`) — every gadget's view and edit mode share one built bundle; `main.jsx` decides which component to render based on the Forge context (see "How the multi-gadget pattern works" below)
- **No storage**: this starter has no `@forge/kvs` dependency — the only "config" is each gadget instance's own `gadgetConfiguration`, handled entirely through `view.submit()` / `view.getContext()`. Add `@forge/kvs` yourself if a future gadget needs app-wide settings shared across gadget instances.

## Prerequisites

- Node.js (matches `manifest.yml`'s `nodejs22.x` runtime)
- [Forge CLI](https://developer.atlassian.com/platform/forge/getting-started/) installed and logged in (`forge login`)
- A Jira Cloud site to install on

## Project layout

```text
manifest.yml                 Forge app manifest (modules, scopes, resource)
src/index.js                 Resolver — all backend logic and Jira API calls
static/gadgets/       React frontend (Vite)
  src/main.jsx                Bootstraps whichever gadget's view/edit matches the Forge context
  src/styles.css              Design tokens (light/dark) + a couple of shared form classes
  src/gadget/
    gadgetUtils.js             Shared helpers used by every gadget
    SprintStatusGadgetView.jsx The example gadget's dashboard view
    SprintStatusGadgetEdit.jsx The example gadget's edit/config view
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

Install the app to a domain you have admin access to
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

## Configuring the example gadget

1. Add the "Sprint Status by Points" gadget to a Jira dashboard.
2. Click **Edit** on the gadget.
3. Pick a **Jira space** (project) from the dropdown — this list comes from every project visible to whoever is editing.
4. Click **Save**.

The gadget will show the active sprint on that project's first Scrum board, with one row per status: story count, a proportion bar, and story points. If the project has no Scrum board, or no sprint is currently active, the gadget says so instead of erroring.

### Customizing the story points field

`src/index.js` hardcodes `STORY_POINTS_FIELD = 'customfield_10016'` — the default "Story point estimate" field id on most Jira Cloud sites. If your site uses a different field, change that one constant. (A more advanced version could look this up per-project via `/rest/api/3/issue/createmeta`, like a full field-mapping config screen — out of scope for this starter.)

### Other simplifications worth knowing about

- Only issues with issue type **Story** are counted. Broaden the filter in `getActiveSprintStatusCounts` (`src/index.js`) if you want Bugs/Tasks/Sub-tasks included.
- If a project has multiple Scrum boards, only the first one returned by Jira is used.
- The project picker fetches up to 100 projects in one page — add pagination if your site has more.

## How the multi-gadget pattern works

Every gadget in this app shares the **same** static bundle (`resource: main` in the manifest) instead of getting its own Vite build. `main.jsx` asks Forge for the current context and looks up the matching gadget:

```js
const GADGETS = {
  'sprint-status-gadget': { view: SprintStatusGadgetView, edit: SprintStatusGadgetEdit },
};

const ctx = await view.getContext();
const gadget = GADGETS[ctx.moduleKey];
const Component = ctx.extension?.entryPoint === 'edit' ? gadget.edit : gadget.view;
```

`ctx.moduleKey` is whatever `key` you gave the `jira:dashboardGadget` entry in `manifest.yml`. `ctx.extension.entryPoint` is `'edit'` while the gadget's config screen is open, and unset (view mode) otherwise.

Each gadget's own config, once saved via `view.submit({...})` in its edit component, comes back on the next load as `ctx.extension.gadgetConfiguration` — that's the whole config story for a single gadget instance. No backend storage needed unless you want settings shared *across* instances.

## Adding another gadget

Say you want a new gadget called "Open Bugs by Priority":

1. **Manifest** — add a new entry under `jira:dashboardGadget` in `manifest.yml`:

   ```yaml
     - key: open-bugs-gadget
       title: Open Bugs by Priority
       description: Count of open bugs per priority for a selected project.
       thumbnail: https://developer.atlassian.com/platform/forge/images/icons/issue-panel-icon.svg
       resource: main
       resolver:
         function: resolver
       edit:
         resource: main
   ```

2. **Backend** — add whatever `resolver.define('...')` calls it needs to `src/index.js`. It can freely reuse `getGadgetProjects` if it also starts with a project picker.

3. **Frontend** — create `src/gadget/OpenBugsGadgetView.jsx` and `src/gadget/OpenBugsGadgetEdit.jsx`, following the same shape as the `SprintStatus*` pair.

4. **Register it** — add one line to the `GADGETS` map in `main.jsx`:

   ```js
   'open-bugs-gadget': { view: OpenBugsGadgetView, edit: OpenBugsGadgetEdit },
   ```

5. Build, then `forge deploy` **and** `forge install --upgrade` (see above — you changed the manifest).

## Status

This is a starter, not a finished product — it has one working example gadget and the scaffolding to add more. There are no automated tests or CI configured; add them as this grows past a handful of gadgets.
