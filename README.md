# Flow Relay VS Code Extension

Flow Relay for VS Code brings async handoff generation, project context and multi-tenant AI insights directly into your editor (VS Code, Cursor and Antigravity).

- Extension id: flowrelay.flowrelay
- Current version: 1.8.0

## Key Features

- **My Work sidebar panel**: the work items assigned to you across every project, with status, finish date and project. Start an item from the inline play button (creates a branch named after the item, such as `fr-12-refund-flow`, and moves the item to In progress) or change its status from the context menu. Commits and pull requests on that branch link to the item automatically.
- **Current branch in the status bar**: when the checked-out branch names an item key (`fr-12-refund-flow`, `feature/FR-12`), the status bar shows that item and its status; click it to change the status or open the item in Flow Relay. The extension starts with the editor so the status bar entry is there without opening the sidebar first.
- **Workspace Context sidebar panel**: tenant-aware status, account type, accessible projects and role, featuring the high-fidelity mascot icon in the header row.
- **Project-scoped workflows**: handoff, insight and Q&A operations run in project context (personal or organization project) with automated asynchronous polling.
- **Project context selector**: switch active scope effortlessly (`Flow Relay: Select Project Context`).
- **Visual filter panel**: generate handoffs and insights from all connected sources or via a branded filter panel mirroring the web UI. Select real resources (repos, spaces, boards, channels, sites), branches, event types and priorities without manual typing.
- **52 Supported Integrations**:
  - *Code & VCS*: GitHub, GitLab, Bitbucket, Azure DevOps (with branch filtering)
  - *CI/CD & Deployments*: Buildkite, CircleCI, Vercel, Netlify, Render, Railway, Cloudflare Pages, Heroku
  - *Issue Trackers*: Linear, Jira, ClickUp, monday.com, Shortcut, Asana
  - *Observability & Alerting*: Sentry, Datadog, PagerDuty, incident.io, Grafana, Prometheus Alertmanager, New Relic
  - *Product Analytics*: PostHog
  - *Security & Code Quality*: Snyk, SonarQube
  - *Feature Flags & Infra*: LaunchDarkly, HCP Terraform, Pulumi Cloud
  - *Meetings & Whiteboards*: Fireflies, Zoom, Google Meet, Microsoft Teams meetings, Fathom, Google Calendar, Miro
  - *Customer Support*: Intercom, Zendesk, Jira Service Management
  - *CRM*: HubSpot, Salesforce
  - *Communication & Email*: Slack, Discord, Microsoft Teams, Microsoft Outlook, Gmail
  - *Docs & Design*: Notion, Confluence, Google Drive, Figma
- **Dual-theme integration icons**: crisp, theme-aware SVG icons for all 52 sources in both light and dark editor themes.
- **Figma visual context**: selecting Figma in the filter panel attaches rendered frame previews plus the indexed design scene (layout, texts, prototype flows) at a flat 1-credit surcharge. Greys out with an inline explanation when project region is not Global.
- **Project Q&A (`Flow Relay: Ask This Project`)**: ask questions grounded in your project's code, baselines and recent 14-day activity. Returns synchronous answers citing used events.
- **Release notes generation (`Flow Relay: Generate Release Notes`)**: turn merged work into release notes or a PR description, opened directly as a Markdown document.
- **Plan review (`Flow Relay: Generate Plan Review`)**: a status report for the active project written from the numbers of its plan (dates, variances, milestone slack, earned value, the open register) and the last 14 days of linked activity, opened as Markdown. Costs 5 credits.
- **Earned value (`Flow Relay: Show Earned Value`)** and **risk register (`Flow Relay: Show Risk Register`)**: read the costs of the active project against its baseline (project managers, plans that include costs) and its open risks, issues, decisions and dependencies without leaving the editor.
- **Create Work Item from Selection**, **Ask a What-if Question** and **Add a Template to the Plan**: turn selected text into an item with its file and line, try a what-if question on a copy of the plan (5 credits) and add a saved template to the plan.
- **Change requests (`Flow Relay: Show Change Requests`, `Flow Relay: Request a Change to an Item`)**: read what has been asked of a plan and who decided, and ask for a change to an item (status, progress, duration or deadline) that a second person must approve. Business plan and above, organization projects.
- **Decide, triage, record and delete (`Flow Relay: Decide a Change Request`, `Flow Relay: Accept or Dismiss a Suggestion`, `Flow Relay: Add a Register Entry`, `Flow Relay: Delete a Work Item`)**: approve, reject or withdraw a pending change request, accept or dismiss a suggestion made from linked activity, add a risk or another entry to the register and delete an item with its sub-items after a confirmation (a project manager can restore it).
- **Forecast (`Flow Relay: Show Forecast`)**: how likely each finish date of the active project is, from simulating its plan or its recent pace, with the chance of meeting the target and each milestone's likely date (Business plan and above).
- **Portfolio (`Flow Relay: Show Portfolio`)**: the projects of an organization you can open with their progress, forecast, next milestone, open risks and health, to see which need attention (Business plan and above).
- **Scheduled digests (`Flow Relay: Show Digests`)**: browse and open scheduled activity digests of the active project as Markdown.
- **Untracked resources detection**: surface active repos, channels and boards not yet scoped to any project, with quick-add action.
- **Discord integration**: list channels and post messages or send latest artifacts (`last_handoff`, `last_correlation`, `last_onboarding`, `last_architecture`, `last_release_notes`) as `.md` file attachments.

## Multi-Tenant Scope Behavior

The extension operates within the context of a project:

- Project scope (personal project or organization project) is required for handoff, insight and Q&A operations.
- In organization projects, the UI adapts by role and context (owner, admin, member states).

## Installation

Install from one of these channels:

- VS Code Marketplace: https://marketplace.visualstudio.com/items?itemName=flowrelay.flowrelay
- OpenVSX (Cursor / Antigravity): https://open-vsx.org/extension/flowrelay/flowrelay
- Manual VSIX from Flow Relay downloads page.

## Setup

1. Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
2. Run: `Flow Relay: Set API Key`
3. Enter your API key (format: `fr_...`). It is stored securely in VS Code SecretStorage.
4. Run `Flow Relay: Select Project Context` to switch to your desired project.

Default API base URL:

- `https://www.flowrelay.it`

You can override it in settings with `flowrelay.apiBaseUrl`.

## Commands

- `Flow Relay: Set API Key`
- `Flow Relay: Select Project Context`
- `Flow Relay: Generate Handoff`
- `Flow Relay: Generate Handoff with Filters...`
- `Flow Relay: Show Handoffs`
- `Flow Relay: Show Last Handoff`
- `Flow Relay: Show Integrations`
- `Flow Relay: List Discord Channels`
- `Flow Relay: Send Discord Message`
- `Flow Relay: Ask This Project`
- `Flow Relay: Generate Project Insight...`
- `Flow Relay: Generate Release Notes`
- `Flow Relay: Generate Plan Review`
- `Flow Relay: Show Earned Value`
- `Flow Relay: Show Risk Register`
- `Flow Relay: Show Portfolio`
- `Flow Relay: Show Forecast`
- `Flow Relay: Create Work Item from Selection`
- `Flow Relay: Ask a What-if Question`
- `Flow Relay: Add a Template to the Plan`
- `Flow Relay: Show Change Requests`
- `Flow Relay: Request a Change to an Item`
- `Flow Relay: Decide a Change Request`
- `Flow Relay: Accept or Dismiss a Suggestion`
- `Flow Relay: Add a Register Entry`
- `Flow Relay: Delete a Work Item`
- `Flow Relay: Show Insights`
- `Flow Relay: Show Digests`
- `Flow Relay: Show Untracked Resources`
- `Flow Relay: Show Events`
- `Flow Relay: Show My Work`
- `Flow Relay: Start Work Item`
- `Flow Relay: Change Work Item Status...`
- `Flow Relay: Show Current Branch Work Item`
- `Flow Relay: Refresh`

## Development

From this folder:

```bash
npm install
npm run build
npm run package
```

## Troubleshooting

- If prompts show missing API key, run `Flow Relay: Set API Key` again.
- If no project data appears, run `Flow Relay: Select Project Context` and choose scope.
- If business workspace shows no accessible projects, verify team assignment and role in Flow Relay.

## Related Docs

- Documentation & Platform: https://www.flowrelay.it
- Extension Documentation: https://www.flowrelay.it/docs/extension

## License

Copyright © 2026 Adriano Sorbello ([@atrisorb](https://github.com/atrisorb)). All rights reserved.

Distributed under the GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later). See [LICENSE](LICENSE) for more information.
