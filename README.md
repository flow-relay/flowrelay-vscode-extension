# Flow Relay VS Code Extension

Flow Relay for VS Code brings async handoff generation, project context and multi-tenant AI insights directly into your editor (VS Code, Cursor and Antigravity).

- Extension id: flowrelay.flowrelay
- Current version: 1.0.30

## Key Features

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
- `Flow Relay: Show Insights`
- `Flow Relay: Show Digests`
- `Flow Relay: Show Untracked Resources`
- `Flow Relay: Show Events`
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
