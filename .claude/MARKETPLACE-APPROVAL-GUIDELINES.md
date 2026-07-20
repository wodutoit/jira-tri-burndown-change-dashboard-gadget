# Atlassian Marketplace app approval guidelines

Source: [developer.atlassian.com/platform/marketplace/app-approval-guidelines](https://developer.atlassian.com/platform/marketplace/app-approval-guidelines/) (fetched 2026-07-20 — re-check the live page periodically, Atlassian can update these).

This file exists so future changes to this app get checked against these guidelines before shipping, not after a rejected submission. Compliance status below reflects the last check on 2026-07-20; if you change scopes, add network calls, change how data is stored, or change branding/naming, re-verify the relevant section.

## Pre-submission (administrative, not code)

- Get the Privacy and Security tab approved (ticket)
- Complete partner verification (ticket)
- Resolve any pending security vulnerability tickets
- Accept the Marketplace Partner Agreement
- Register at least one contact with the Atlassian Developer Community

None of these are checkable from code — they're steps in the Developer Console / submission flow.

## UI and performance

- **Doesn't break the host Atlassian app UI.** ✅ All 4 gadgets render entirely inside their own Custom UI iframes; nothing touches Jira's surrounding UI.
- **Doesn't degrade host app performance.** ⚠️ Mostly fine, but see the known pagination-cap limitation in `PROJECT-CONTEXT.md` — an unusually large sprint could be slow. Not a current violation, but worth re-checking if this ever gets reported as an issue.

## Branding and naming

- **Doesn't infringe Atlassian trademarks.** ✅ checked 2026-07-20 — app icon is an original design (teal descending-bar-chart mark), no resemblance to Atlassian/Jira marks or colors.
- **Naming convention: "App X for Jira," not "Jira App X."** ⚠️ Individual gadget titles (TRI Burndown, TRI Scope Change, TRI Rework, TRI Cycle Time) don't include "Jira" at all, so they're already safe. **The overall Marketplace listing name is chosen separately in the Developer Console (not in `manifest.yml`) — apply this rule there too when it's picked.**
- **Logos/banners comply with brand guidelines.** ✅ per above, original design.

## Functionality and transparency

- **Performs as described.** ✅ each gadget's `manifest.yml` description matches its actual implemented behavior (verified against the code, not just the description text).
- **Third-party service disclosure.** N/A — the app requires no third-party account or service, only the installing Jira Cloud site itself.
- **No misleading freemium.** ✅ fully free, fully functional, no paywalled tiers, no external account required.

## Documentation and marketing

- **Listing references setup/usage documentation.** ✅ `USAGE.md` — written for end users, not developers. Link this from the listing, not `README.md` (that one's for people modifying the code).
- **Marketing assets (logo/banner/screenshots).** Logo: ✅ done (`static/gadgets/public/icons/app-icon-*.png`). Screenshots: ✅ done, 14 screenshots in `docs/screenshots/` covering all 4 gadgets (including config screens and Chart/Table/Both display modes), embedded into `USAGE.md`. Banner image: still not created as of 2026-07-20 — not required for a free listing, worth adding before submission for a stronger listing page.
- **Open source / license consistency.** ✅ repo is public; `LICENSE` is a genuine MIT license matching `"license": "MIT"` in `package.json`.

## Listing and pricing

- **Reasonable pricing.** N/A — free.
- **No advertisements for other products.** ✅ checked README/SUPPORT/PRIVACY/TERMS/USAGE — nothing promotes unrelated products.
- **No duplicate listing (cloud app duplicating an existing server/DC app).** N/A — Forge-only, no server/DC equivalent exists.
- **Valid company email for paid-via-Atlassian apps.** N/A — free.

## Security and authentication

- **No Basic Auth against Atlassian product REST APIs.** ✅ verified 2026-07-20 — `src/index.js` makes zero raw `fetch()` calls and has zero hardcoded URLs or `Authorization`/`Basic` headers anywhere in the codebase (backend or frontend). Every Jira call goes through Forge's `asUser().requestJira()`, which uses Forge's own OAuth-based platform auth. **Re-run this check (`grep -rn "Authorization\|Basic \|btoa\|apiToken" src/ static/gadgets/src/`) if anyone ever adds a raw HTTP call.**
- **Secure secrets storage.** ✅ N/A in the sense that the app holds no secrets at all — no API tokens, no OAuth client secrets in code. Forge handles all auth natively.
- **Security requirements per the security workflow.** Administrative (formal security review), not code-checkable — but the underlying posture is good: minimal read-only scopes (`read:jira-work`, `read:issue:jira`, `read:project:jira`, `read:board-scope:jira-software`, `read:sprint:jira-software`, `read:issue-details:jira`, `read:jql:jira`, `storage:app`), no `permissions.external`/egress declared, no PII stored beyond issue keys/story points/status names/timestamps (see `PRIVACY.md`).

## Legal and community

- **Privacy Policy.** ✅ `PRIVACY.md`, live at `https://github.com/wodutoit/jira-tri-burndown-change-dashboard-gadget/blob/main/PRIVACY.md`.
- **Terms of Service.** ✅ `TERMS.md` — adopts Atlassian's standard Marketplace Terms of Use rather than a custom EULA (simpler for a solo/small publisher), live at `https://github.com/wodutoit/jira-tri-burndown-change-dashboard-gadget/blob/main/TERMS.md`.
- **Support contact.** ✅ `SUPPORT.md` → GitHub Issues, live at `https://github.com/wodutoit/jira-tri-burndown-change-dashboard-gadget/blob/main/SUPPORT.md`.
- Partner Agreement acceptance, community registration, other legal obligations: administrative, done during submission.

## Testing and integration

- **Third-party integration testing credentials.** N/A — no third-party integrations of any kind.

## If you change something later, re-check this section

| If you... | Re-check |
| --- | --- |
| Add a new manifest scope | Update `PRIVACY.md`'s data-access description, and re-verify "reasonable/minimal scopes" reasoning above |
| Add any `fetch()`/external URL call in `src/index.js` or the gadget frontend | Re-run the Basic Auth / secrets grep above; update `PRIVACY.md` if it changes what leaves Atlassian's platform |
| Change what's stored in `@forge/storage` | Update `PRIVACY.md`'s "What the app stores" section |
| Rename the app or change its icon/branding | Re-check the trademark and "X for Jira" naming rule above |
| Add a paid tier | This whole "Listing and pricing" section changes — billing/refund terms, valid company email, `TERMS.md` all need revisiting |
