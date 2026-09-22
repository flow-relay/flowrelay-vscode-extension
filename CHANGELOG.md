# Changelog

All notable changes to the Flow Relay VS Code extension.

## 1.0.30 – 2026-09-22

### Added
- Google Meet, Microsoft Teams meetings and Fathom join the filter vocabulary, so the handoff and insight filter panels list their meeting organizers alongside every other source. None of the three carries a branch or a priority filter. Icons ship for both themes.

## 1.0.29 – 2026-09-21

### Added
- Heroku, Prometheus Alertmanager and Pulumi Cloud join the filter vocabulary, so the handoff and insight filter panels list Heroku apps, Alertmanager receivers and Pulumi stacks alongside every other source. Alertmanager carries a severity priority filter; GitHub gains one too for its new Dependabot and code scanning alert events. Icons ship for both themes.

## 1.0.28 – 2026-09-11

### Changed
- Repository URL updated to the `flow-relay` GitHub organization (`github.com/flow-relay/flowrelay-vscode-extension`).

## 1.0.27 – 2026-09-09

### Added
- New Relic, Jira Service Management, PostHog, HubSpot and Salesforce join the filter vocabulary, so the handoff and insight filter panels list alert policies, service desks, PostHog projects, HubSpot pipelines and Salesforce accounts alongside every other source. Icons ship for both themes.

## 1.0.26 – 2026-09-06

### Added
- LaunchDarkly, HCP Terraform, SonarQube and Miro join the filter vocabulary, so the handoff and insight filter panels list flag projects, Terraform workspaces, Sonar projects and Miro boards alongside every other source. Icons ship for both themes.

## 1.0.25 – 2026-09-05

### Added
- Zoom, Grafana, Google Calendar and Google Drive join the filter vocabulary, so the handoff and insight filter panels list meeting organizers, alert folders, calendars and picked documents alongside every other source. Icons ship for both themes.

## 1.0.24 – 2026-09-02

### Added
- Fireflies joins the filter vocabulary, so the handoff and insight filter panels list meeting organizers alongside every other source. Icons ship for both themes.

## 1.0.23 – 2026-09-01

### Added
- Snyk joins the filter vocabulary, so the handoff and insight filter panels list its monitored projects and severities alongside every other source. Icons ship for both themes.

## 1.0.22 – 2026-09-01

### Added
- Intercom and Zendesk join the filter vocabulary, so the handoff and insight filter panels list their teams and groups alongside every other source. Icons ship for both themes.

## 1.0.21 – 2026-08-28

### Added
- ClickUp, monday.com and Shortcut join the filter vocabulary, so the handoff and insight filter panels list their spaces, boards and teams alongside every other source. Icons ship for both themes.

### Changed
- Integration icons are resolved by the kebab-case form of the source id (`incident-io.svg`, not `incident_io.svg`), matching the single path convention the rest of Flow Relay uses. The bundled files were renamed to match.

## 1.0.20 – 2026-08-28

### Added
- Netlify, Render, Railway and Cloudflare Pages join the filter vocabulary, so the handoff and insight filter panels list their sites, services and projects alongside every other source. Icons ship for both themes.

## 1.0.19 – 2026-08-06

### Fixed
- The sidebar icon is the mascot again. 1.0.17 cropped too tight: the window framed only the face plate, dropping the antenna and the head outline, so the icon read as an anonymous rounded square rather than the character. The crop is now the head plus antenna – 15x15 cells of the artwork instead of 10x10, centred on the head axis – which keeps the silhouette recognisable and still renders the single-cell eyes above one device pixel at the 16px tree size.

## 1.0.18 – 2026-08-06

### Fixed
- The filter panel no longer shows a cream band under the content when the editor runs a dark theme. The dark tokens are scoped to `body.vscode-dark`, but the background was also set on `html` – which sits outside `body` and therefore always resolved the light `:root` value. With `body` capped at viewport height, everything below the first screen painted the light canvas. The background now lives on `body` alone, so it propagates to the whole scrollable canvas with the theme's own value.

## 1.0.17 – 2026-08-06

### Fixed
- The mascot's eyes are visible again in the Workspace Context header. The artwork is a 24x29 grid of 40px cells and a tree icon renders at 16px, so a single-cell feature came out at 0.55 device pixels and disappeared into the antialiasing – the mouth survived because it is four cells wide. The sidebar now uses a face crop (`mascotte-icon.svg` / `mascotte-icon-dark-theme.svg`, a 10x10 window over the same artwork) which puts every feature back above one pixel. The full-body files are untouched and stay the brand asset.

## 1.0.16 – 2026-08-02

### Fixed
- The mascot now renders. The extension declared it through `contributes.icons`, which only accepts a built-in codicon id or an icon-font glyph – a path to an SVG is rejected by the manifest schema, so the icon was never registered and the status bar printed the raw `$(flowrelay-mascot)` placeholder.
- The mascot is drawn in the Flow Relay sidebar instead, on the header row of the Workspace Context view, where VS Code renders full-color SVG art. The status bar keeps text only: it can render monochrome codicons alone, and the mascot is multi-color pixel art.

### Changed
- The Workspace Context view opens on a `Flow Relay` row carrying the account type as its description, replacing the separate `Account: ...` row.

## 1.0.15 – 2026-08-02

### Added
- Explicit package license field (`AGPL-3.0-or-later`) and author metadata in `package.json`.
- Startup banner in the VS Code Output Channel logging version, copyright, and license on extension activation.
- `## License` section in `README.md` and `@license` headers across TypeScript source files.

## 1.0.14 – 2026-07-29

### Fixed
- Added a 30-second socket timeout to the extension's native Node HTTP client to prevent network hangs from freezing the extension host or sidebar panels.

## 1.0.13 – 2026-07-25

### Added
- `Flow Relay: Send Discord Message` can post the active project's latest release notes as a `.md` attachment.

### Fixed
- `Flow Relay: Generate Release Notes` now works: the command was contributed to the palette in 1.0.12 but never registered, so running it failed with "command not found". It asks for the output style and, when the project tracks code repositories, which repository to cover.

## 1.0.12 – 2026-07-24

### Added
- `Flow Relay: Generate Release Notes` command: turn the merged work of a project into release notes or a PR description, opened as a Markdown document. Costs 3 credits per run.
- `Flow Relay: Show Digests` command: browse the scheduled digests of the active project and open one as Markdown. Reading is free – digests are generated on the schedule set from the project page.
- `release_notes` joins the insight kinds returned by `Show Insights`.

## 1.0.11 – 2026-07-24

### Added
- `Flow Relay: Ask This Project` command: ask one question about the active project and read the answer as a Markdown document. Answers synchronously and cites the events it used. Costs 2 credits per question.

## 1.0.10 – 2026-07-22

### Added
- `incident_io` joins the source vocabulary (`SOURCES`, `SOURCE_NAMES`, `SOURCE_PROJECT_LABEL`): incident.io public incident events appear in the filter panel with incident types as the resource dimension and severities as priorities.

## 1.0.9 – 2026-07-20

### Added
- `vercel` joins the source vocabulary (`SOURCES`, `SOURCE_NAMES`, `SOURCE_PROJECT_LABEL`): Vercel deployment results appear in the filter panel with projects as the resource dimension.

## 1.0.8 – 2026-07-16

### Added
- `circleci` joins the source vocabulary (`SOURCES`, `SOURCE_NAMES`, `SOURCE_PROJECT_LABEL`): CircleCI workflow results appear in the filter panel with projects as the resource dimension.

## 1.0.7 – 2026-07-15

### Added
- `buildkite` joins the source vocabulary (`SOURCES`, `SOURCE_NAMES`, `SOURCE_PROJECT_LABEL`): Buildkite build results appear in the filter panel with pipelines as the resource dimension.

## 1.0.6 – 2026-07-10

### Added
- `gmail` and `asana` complete the source vocabulary.


## 1.0.5 – 2026-07-08

### Fixed
- Added `pagerduty` to the source vocabulary (`SOURCES`, `SOURCE_NAMES`, `SOURCE_PROJECT_LABEL`). It was added to the platform but never reached the extension, so PagerDuty was missing from the filter panel and its resources rendered without a proper label.

### Fixed
- Workspace sidebar labeled the no-project state as "Personal stream (no project)"; the personal stream is retired, so it now reads "Scope: No project selected".

## 1.0.4 – 2026-07-04

### Added
- `Flow Relay: Show Events` command – lists recent context events for the active project in a quick pick, with full detail view on selection. Closes the parity gap with the MCP server's `list_events` tool.

## 1.0.3 – 2026-07-03

### Added
- Figma region awareness in the filter panel. When the active project's processing region is not Global, Figma appears greyed out with an inline note explaining that Figma visual context requires the Global region (and who can change it). Selecting Figma on Global projects attaches rendered frame previews plus the indexed design scene to the generation, at a flat 1-credit surcharge.

## 1.0.2 – 2026-07-03

### Changed
- `showHandoffDocument` / `showInsightDocument` open the server-rendered `markdown` (canonical serializer, byte-identical to the dashboard copy button) with a local minimal fallback for pre-markdown servers.

## 1.0.1 – 2026-06-29

### Added
- **Send Discord Message** can now post a Flow Relay artifact directly: pick a channel, then choose to type a message or send the latest handoff, correlation, onboarding, or architecture insight for the active project. The artifact is rendered to the same Markdown as the dashboard copy button and delivered as a `.md` file attachment.

## 1.0.0 – 2026-06-28

### Changed
- Reworked the handoff/insight filter panel into a faithful, branded port of the Flow Relay web UI. Sources and per-source filters (resources, branches, event types, priorities) are now **selected from real options** fetched from `GET /api/v1/handoffs/filters` – no manual typing, so no typos or forgotten values. Branch selection is single-choice (radio) with the default branch flagged, matching the web app.
- Full-page panel layout that fills the editor tab, with a sticky action bar.
- Bundled the correct brand fonts (Geist Sans for body, Geist Mono for resource/branch labels, Rubik for the "Flow Relay" wordmark – 500 / 300 weights) and refreshed the mascot to the current design. Avorio (light) + Sera (dark) theming follows the editor theme.

## 0.9.0 – 2026-06-28

### Added
- First version of the visual filter panel for handoff and insight generation, plus per-source filter support end to end.

### Changed
- "Generate Handoff from Source..." renamed to "Generate Handoff with Filters...".
- Handoff and insight generation poll asynchronous jobs to completion.

### Fixed
- Removed a banned unicode arrow from a sidebar message.
- Removed the dead inline-handoff response path.
