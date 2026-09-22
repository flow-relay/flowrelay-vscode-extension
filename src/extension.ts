/**
 * @license
 * Flow Relay VS Code Extension
 * Copyright (c) 2026 Adriano Sorbello (atrisorb) <https://github.com/atrisorb>
 * Licensed under GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)
 */

import * as vscode from 'vscode';
import { FlowRelayAPI, Handoff, TenantProject, Insight, SourceFilter, AvailableFilters, FigmaGateInfo } from './api';
import {
  HandoffsProvider,
  IntegrationsProvider,
  WorkspaceProvider,
  WorkspaceSnapshot,
} from './sidebar';
import { SOURCE_NAMES } from './filter-data';
import { openFilterPanel } from './filter-panel';

const SECRET_KEY = 'flowrelay.apiKey';
const ACTIVE_PROJECT_KEY = 'flowrelay.activeProjectId';
const CODE_SOURCES = ['github', 'gitlab', 'bitbucket', 'azure_devops'] as const;

async function loadAvailableFilters(
  api: FlowRelayAPI,
  projectId: string,
): Promise<{ filters: AvailableFilters; figma: FigmaGateInfo | null }> {
  return vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: 'Flow Relay: loading filter options...' },
    async () => {
      try {
        return await api.getHandoffFilters(projectId);
      } catch {
        return { filters: {}, figma: null };
      }
    },
  );
}

let api: FlowRelayAPI | null = null;

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel('Flow Relay');
  context.subscriptions.push(outputChannel);
  outputChannel.appendLine(`Flow Relay VS Code Extension v${context.extension.packageJSON.version}`);
  outputChannel.appendLine('Copyright (c) 2026 Adriano Sorbello (atrisorb) <https://github.com/atrisorb>');
  outputChannel.appendLine('Licensed under GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)');

  let snapshot: WorkspaceSnapshot = {
    tenant: null,
    activeProjectId: context.globalState.get<string | null>(ACTIVE_PROJECT_KEY, null),
  };

  const getSnapshot = () => snapshot;

  const getActiveProject = () => {
    if (!snapshot.tenant || !snapshot.activeProjectId) return null;
    return snapshot.tenant.projects.find((project) => project.id === snapshot.activeProjectId) ?? null;
  };



  const setActiveProjectId = async (projectId: string | null) => {
    snapshot = {
      ...snapshot,
      activeProjectId: projectId,
    };
    await context.globalState.update(ACTIVE_PROJECT_KEY, projectId);
  };

  // ── Init API client ──────────────────────────────────────────────
  const initApi = async () => {
    const key = await context.secrets.get(SECRET_KEY);
    if (key) {
      const baseUrl = vscode.workspace.getConfiguration('flowrelay').get<string>('apiBaseUrl', 'https://www.flowrelay.it');
      api = new FlowRelayAPI(key, baseUrl);
    } else {
      api = null;
    }
  };

  const refreshWorkspaceContext = async () => {
    if (!api) {
      snapshot = { tenant: null, activeProjectId: null };
      return;
    }

    const tenant = await api.listProjects();
    let activeProjectId = snapshot.activeProjectId;

    if (activeProjectId && !tenant.projects.some((project) => project.id === activeProjectId)) {
      activeProjectId = null;
      await context.globalState.update(ACTIVE_PROJECT_KEY, null);
    }

    snapshot = { tenant, activeProjectId };
  };

  // ── Sidebar providers ────────────────────────────────────────────
  const workspaceProvider = new WorkspaceProvider(() => api, context.extensionUri, getSnapshot);
  const handoffsProvider = new HandoffsProvider(() => api, getSnapshot);
  const integrationsProvider = new IntegrationsProvider(() => api, context.extensionUri, getSnapshot);

  vscode.window.registerTreeDataProvider('flowrelay.workspace', workspaceProvider);
  vscode.window.registerTreeDataProvider('flowrelay.handoffs', handoffsProvider);
  vscode.window.registerTreeDataProvider('flowrelay.integrations', integrationsProvider);

  // Status bar item
  const statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 50);
  statusItem.command = 'flowrelay.generateHandoff';
  statusItem.show();
  context.subscriptions.push(statusItem);

  const updateStatusBar = () => {
    const activeProject = getActiveProject();
    if (!api) {
      statusItem.text = 'Flow Relay';
      statusItem.tooltip = 'Set your Flow Relay API key to start.';
      return;
    }

    if (activeProject) {
      statusItem.text = activeProject.name;
      statusItem.tooltip = `Flow Relay scope: ${activeProject.project_type === 'organization' ? 'Organization project' : 'Personal project'}`;
      return;
    }

    statusItem.text = 'Flow Relay';
    statusItem.tooltip = 'Flow Relay: select a project to generate handoffs';
  };

  const refreshAll = async (showErrors = false) => {
    try {
      await refreshWorkspaceContext();
    } catch (err) {
      if (showErrors) {
        vscode.window.showErrorMessage(`Failed to load workspace context: ${(err as Error).message}`);
      }
    }

    workspaceProvider.refresh();
    handoffsProvider.refresh();
    integrationsProvider.refresh();
    updateStatusBar();
  };

  const ensureApi = async (): Promise<boolean> => {
    if (api) return true;
    await vscode.commands.executeCommand('flowrelay.setApiKey');
    return !!api;
  };

  const promptForProjectContextIfNeeded = async (): Promise<boolean> => {
    if (snapshot.activeProjectId) return true;
    if (!snapshot.tenant || snapshot.tenant.projects.length === 0) {
      vscode.window.showWarningMessage('Create a project in Flow Relay to generate handoffs.');
      return false;
    }

    const choice = await vscode.window.showWarningMessage(
      'No project selected. Select a project to generate handoffs.',
      'Select Project',
    );

    if (choice === 'Select Project') {
      await vscode.commands.executeCommand('flowrelay.selectProject');
      return !!snapshot.activeProjectId;
    }

    return false;
  };

  const sortProjects = (projects: TenantProject[]) => {
    return [...projects].sort((a, b) => {
      if (a.project_type !== b.project_type) {
        return a.project_type === 'personal' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  };

  void initApi()
    .then(() => refreshAll())
    .catch((err) => {
      vscode.window.showErrorMessage(`Failed to initialize Flow Relay: ${(err as Error).message}`);
    });

  // ── Commands ─────────────────────────────────────────────────────

  // Set API Key
  context.subscriptions.push(
    vscode.commands.registerCommand('flowrelay.setApiKey', async () => {
      const key = await vscode.window.showInputBox({
        prompt: 'Enter your Flow Relay API key',
        placeHolder: 'fr_...',
        password: true,
        validateInput: (v) => v.startsWith('fr_') ? null : 'API key must start with "fr_"',
      });
      if (key) {
        await context.secrets.store(SECRET_KEY, key);
        await initApi();
        await refreshAll(true);
        vscode.window.showInformationMessage('Flow Relay API key saved.');
      }
    }),
  );

  // Select active project context
  context.subscriptions.push(
    vscode.commands.registerCommand('flowrelay.selectProject', async () => {
      if (!(await ensureApi())) {
        return;
      }

      await refreshAll(true);
      if (!snapshot.tenant) {
        vscode.window.showErrorMessage('Workspace context is not available yet.');
        return;
      }

      const activeProjectId = snapshot.activeProjectId;

      const picks: Array<vscode.QuickPickItem & { projectId: string | null }> = [
        {
          label: `${activeProjectId ? '' : '$(check) '}No project selected`,
          description: 'Handoff and insight generation requires selecting a project.',
          projectId: null,
        },
      ];

      for (const project of sortProjects(snapshot.tenant.projects)) {
        const checked = project.id === activeProjectId ? '$(check) ' : '';
        const scopeLabel = project.project_type === 'organization'
          ? `Organization project • ${project.organization_name ?? 'Unknown org'}`
          : 'Personal project';

        const roleLabel = project.access_role === 'owner'
          ? 'owner'
          : project.access_role === 'admin'
            ? 'admin'
            : 'member';

        picks.push({
          label: `${checked}${project.name}`,
          description: `${scopeLabel} • ${roleLabel}`,
          detail: project.id,
          projectId: project.id,
        });
      }

      const selected = await vscode.window.showQuickPick(picks, {
        placeHolder: 'Select Flow Relay project context',
      });

      if (!selected) return;

      await setActiveProjectId(selected.projectId);
      await refreshAll();

      if (selected.projectId) {
        const selectedProject = getActiveProject();
        vscode.window.showInformationMessage(`Flow Relay context set to ${selectedProject?.name ?? 'project'}.`);
      } else {
        vscode.window.showInformationMessage('Flow Relay context cleared.');
      }
    }),
  );

  // Refresh sidebar
  context.subscriptions.push(
    vscode.commands.registerCommand('flowrelay.refreshSidebar', async () => {
      await refreshAll(true);
    }),
  );

  // Generate Handoff (all sources)
  context.subscriptions.push(
    vscode.commands.registerCommand('flowrelay.generateHandoff', async () => {
      if (!(await ensureApi())) {
        return;
      }

      await refreshAll(true);
      if (!(await promptForProjectContextIfNeeded())) return;
      if (!snapshot.activeProjectId) {
        vscode.window.showErrorMessage('A project must be selected to generate a handoff.');
        return;
      }

      const activeProject = getActiveProject();
      if (!activeProject) {
        vscode.window.showErrorMessage('Selected project context could not be resolved.');
        return;
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Generating handoff for ${activeProject.name}...`,
        },
        async () => {
          try {
            const handoff = await runGenerateHandoff(api!, undefined, undefined, snapshot.activeProjectId!);
            showHandoffDocument(handoff);
            await refreshAll();
            vscode.window.showInformationMessage(`Handoff generated: ${handoff.title}`);
          } catch (err) {
            vscode.window.showErrorMessage(`Failed: ${(err as Error).message}`);
          }
        },
      );
    }),
  );

  // Generate Handoff from specific source
  context.subscriptions.push(
    vscode.commands.registerCommand('flowrelay.generateHandoffFromSource', async () => {
      if (!(await ensureApi())) {
        return;
      }

      await refreshAll(true);
      if (!(await promptForProjectContextIfNeeded())) return;
      if (!snapshot.activeProjectId) {
        vscode.window.showErrorMessage('A project must be selected to generate a handoff.');
        return;
      }

      const activeProject = getActiveProject();
      const available = await loadAvailableFilters(api!, snapshot.activeProjectId);
      const result = await openFilterPanel(context.extensionUri, available.filters, {
        title: 'Generate handoff',
        figmaGate: available.figma,
        subtitle: activeProject ? activeProject.name : 'Scope and filter the activity to summarize',
        generateLabel: 'Generate handoff',
      });

      if (!result) return;

      const sources = result.sources.length ? result.sources : undefined;
      const filters = Object.keys(result.filters).length ? result.filters : undefined;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Generating filtered handoff...',
        },
        async () => {
          try {
            const handoff = await runGenerateHandoff(api!, sources, filters, snapshot.activeProjectId!);
            showHandoffDocument(handoff);
            await refreshAll();
            vscode.window.showInformationMessage(`Handoff generated: ${handoff.title}`);
          } catch (err) {
            vscode.window.showErrorMessage(`Failed: ${(err as Error).message}`);
          }
        },
      );
    }),
  );

  // Discord list channels
  context.subscriptions.push(
    vscode.commands.registerCommand('flowrelay.discordListChannels', async () => {
      if (!(await ensureApi())) {
        return;
      }
      await refreshAll(true);
      try {
        const channels = await api!.discordListChannels();
        if (channels.length === 0) {
          vscode.window.showInformationMessage('No channels found.');
          return;
        }
        const picks = channels.map((c) => ({
          label: `#${c.name}`,
          description: c.topic ?? '',
          detail: c.id,
          channel: c,
        }));
        const selected = await vscode.window.showQuickPick(picks, {
          placeHolder: 'Select a channel',
        });
        if (selected) {
          vscode.window.showInformationMessage(`Selected channel #${selected.channel.name} (${selected.channel.id})`);
        }
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to list Discord channels: ${(err as Error).message}`);
      }
    }),
  );

  // Discord send message
  context.subscriptions.push(
    vscode.commands.registerCommand('flowrelay.discordSendMessage', async () => {
      if (!(await ensureApi())) {
        return;
      }
      await refreshAll(true);
      try {
        const channels = await api!.discordListChannels();
        if (channels.length === 0) {
          vscode.window.showInformationMessage('No channels found.');
          return;
        }
        const channelPicks = channels.map((c) => ({
          label: `#${c.name}`,
          description: c.topic ?? '',
          detail: c.id,
          channel: c,
        }));
        const selectedChannel = await vscode.window.showQuickPick(channelPicks, {
          placeHolder: 'Select a channel to send to',
        });
        if (!selectedChannel) return;

        type Artifact =
          | 'last_handoff'
          | 'last_correlation'
          | 'last_onboarding'
          | 'last_architecture'
          | 'last_release_notes';
        const whatPicks: { label: string; artifact?: Artifact }[] = [
          { label: 'Type a message' },
          { label: 'Send latest handoff', artifact: 'last_handoff' },
          { label: 'Send latest correlation insight', artifact: 'last_correlation' },
          { label: 'Send latest onboarding brief', artifact: 'last_onboarding' },
          { label: 'Send latest architecture insight', artifact: 'last_architecture' },
          { label: 'Send latest release notes', artifact: 'last_release_notes' },
        ];
        const what = await vscode.window.showQuickPick(whatPicks, {
          placeHolder: `What to send to #${selectedChannel.channel.name}?`,
        });
        if (!what) return;

        let payload: {
          content?: string;
          artifact?: Artifact;
          project_id?: string;
        };
        if (what.artifact) {
          const project = getActiveProject();
          if (!project) {
            vscode.window.showWarningMessage('Select a project first (Flow Relay: Select Project Context).');
            return;
          }
          payload = { artifact: what.artifact, project_id: project.id };
        } else {
          const content = await vscode.window.showInputBox({
            prompt: `Enter message content to send to #${selectedChannel.channel.name}`,
            placeHolder: 'Hello team...',
          });
          if (!content) return;
          payload = { content };
        }

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Sending to #${selectedChannel.channel.name}...`,
          },
          async () => {
            const res = await api!.discordSendMessage(selectedChannel.channel.id, payload);
            if (res.ok) {
              vscode.window.showInformationMessage(`Message sent (ID: ${res.message_id})`);
            } else {
              vscode.window.showErrorMessage('Failed to send message.');
            }
          },
        );
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to send Discord message: ${(err as Error).message}`);
      }
    }),
  );

  // Show Handoffs list
  context.subscriptions.push(
    vscode.commands.registerCommand('flowrelay.listHandoffs', async () => {
      if (!(await ensureApi())) {
        return;
      }

      await refreshAll(true);

      try {
        const handoffs = await api!.listHandoffs('active', 20, snapshot.activeProjectId);
        if (handoffs.length === 0) {
          const activeProject = getActiveProject();
          vscode.window.showInformationMessage(
            activeProject
              ? `No active handoffs for ${activeProject.name}.`
              : 'No active handoffs.',
          );
          return;
        }
        const pick = await vscode.window.showQuickPick(
          handoffs.map((h) => ({
            label: h.title,
            description: h.sources.map((s) => SOURCE_NAMES[s] ?? s).join(', ') + (h.project_name ? ` • ${h.project_name}` : ''),
            detail: h.summary.slice(0, 120) + '...',
            handoff: h,
          })),
          { placeHolder: 'Select a handoff to view' },
        );
        if (pick) showHandoffDocument(pick.handoff);
      } catch (err) {
        vscode.window.showErrorMessage(`Failed: ${(err as Error).message}`);
      }
    }),
  );

  // Show Integrations
  context.subscriptions.push(
    vscode.commands.registerCommand('flowrelay.listIntegrations', async () => {
      if (!(await ensureApi())) {
        return;
      }

      await refreshAll(true);

      try {
        const integrations = await api!.listIntegrations(snapshot.activeProjectId);
        if (integrations.length === 0) {
          const activeProject = getActiveProject();
          vscode.window.showInformationMessage(
            activeProject
              ? `No integrations configured for ${activeProject.name}.`
              : 'No integrations connected. Visit flowrelay.it/integrations to set up.',
          );
          return;
        }
        const items = integrations.map((i) => ({
          label: SOURCE_NAMES[i.source] ?? i.source,
          description: i.workspace_name ?? (i.scope === 'project' ? 'Project-scoped source' : ''),
          detail: i.scope === 'project'
            ? `Status: ${i.connection_status ?? 'unknown'} • Providers: ${i.providers_connected ?? 0}`
            : `Connected ${new Date(i.connected_at).toLocaleDateString()}`,
        }));
        vscode.window.showQuickPick(items, { placeHolder: 'Connected integrations' });
      } catch (err) {
        vscode.window.showErrorMessage(`Failed: ${(err as Error).message}`);
      }
    }),
  );

  // Show Untracked Resources
  context.subscriptions.push(
    vscode.commands.registerCommand('flowrelay.listUntrackedResources', async () => {
      if (!(await ensureApi())) {
        return;
      }

      await refreshAll(true);

      try {
        const resources = await api!.listUntrackedResources();
        if (resources.length === 0) {
          vscode.window.showInformationMessage('All discovered active resources are already tracked in your projects.');
          return;
        }
        const items = resources.map((r) => ({
          label: r.resource_name,
          description: `${SOURCE_NAMES[r.source] ?? r.source} (${r.resource_type})`,
          detail: `ID: ${r.resource_id}`,
        }));
        vscode.window.showQuickPick(items, { placeHolder: 'Untracked active resources' });
      } catch (err) {
        vscode.window.showErrorMessage(`Failed: ${(err as Error).message}`);
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('flowrelay.listEvents', async () => {
      if (!(await ensureApi())) {
        return;
      }

      await refreshAll(true);

      try {
        const events = await api!.listEvents(undefined, 20, snapshot.activeProjectId);
        if (events.length === 0) {
          const activeProject = getActiveProject();
          vscode.window.showInformationMessage(
            activeProject
              ? `No recent events for ${activeProject.name}.`
              : 'No recent events.',
          );
          return;
        }
        const pick = await vscode.window.showQuickPick(
          events.map((e) => ({
            label: `${SOURCE_NAMES[e.source] ?? e.source} / ${e.event_type}`,
            description: new Date(e.created_at).toLocaleString(),
            detail: e.title,
            event: e,
          })),
          { placeHolder: 'Select an event to view' },
        );
        if (pick) {
          const e = pick.event;
          const body = e.content || 'No additional content.';
          const content = `# ${e.title}\n\n**Source:** ${e.source}  \n**Type:** ${e.event_type}  \n**Created:** ${e.created_at}\n\n---\n\n${body}\n`;
          const uri = vscode.Uri.parse(`untitled:Flow Relay - Event - ${e.title.slice(0, 60)}.md`);
          const doc = await vscode.workspace.openTextDocument(uri);
          const edit = new vscode.WorkspaceEdit();
          edit.insert(uri, new vscode.Position(0, 0), content);
          await vscode.workspace.applyEdit(edit);
          await vscode.window.showTextDocument(doc, { preview: true });
        }
      } catch (err) {
        vscode.window.showErrorMessage(`Failed: ${(err as Error).message}`);
      }
    }),
  );

  // Show Last Handoff
  context.subscriptions.push(
    vscode.commands.registerCommand('flowrelay.showLastHandoff', async () => {
      if (!(await ensureApi())) {
        return;
      }

      await refreshAll(true);

      try {
        const handoffs = await api!.listHandoffs('active', 1, snapshot.activeProjectId);
        if (handoffs.length === 0) {
          vscode.window.showInformationMessage('No active handoffs.');
          return;
        }
        showHandoffDocument(handoffs[0]);
      } catch (err) {
        vscode.window.showErrorMessage(`Failed: ${(err as Error).message}`);
      }
    }),
  );

  // Generate Insight
  context.subscriptions.push(
    vscode.commands.registerCommand('flowrelay.generateInsight', async () => {
      if (!(await ensureApi())) return;
      await refreshAll(true);

      if (!snapshot.activeProjectId) {
        const choice = await vscode.window.showWarningMessage(
          'Please select a project context first to generate insights.',
          'Select Project',
        );
        if (choice === 'Select Project') {
          await vscode.commands.executeCommand('flowrelay.selectProject');
        }
        if (!snapshot.activeProjectId) return;
      }

      const activeProject = getActiveProject();
      if (!activeProject) return;

      const picks = [
        { label: 'Cross-Source Correlation', value: 'correlation', description: 'Analyze events across multiple sources to find correlations.' },
        { label: 'Onboarding Brief', value: 'onboarding', description: 'Summarize project context for a new team member.' },
        { label: 'Architecture Insight', value: 'architecture', description: 'Deep-dive into component structure and changes.' },
      ];

      const selected = await vscode.window.showQuickPick(picks, {
        placeHolder: 'Select insight kind to generate',
      });
      if (!selected) return;

      const kind = selected.value as 'correlation' | 'onboarding' | 'architecture';
      const body: Record<string, unknown> = {};

      if (kind === 'correlation') {
        const hoursStr = await vscode.window.showInputBox({ prompt: 'Lookback hours', value: '24' });
        if (hoursStr === undefined) return;
        body.lookbackHours = Number(hoursStr) || 24;
      } else if (kind === 'onboarding') {
        const role = await vscode.window.showInputBox({ prompt: 'New member role/focus', value: 'Frontend Developer' });
        if (role === undefined) return;
        body.newMemberRole = role;

        const focusArea = await vscode.window.showInputBox({ prompt: 'Focus repository area / component', value: 'Auth & Pages' });
        if (focusArea === undefined) return;
        body.focusArea = focusArea;

        const daysStr = await vscode.window.showInputBox({ prompt: 'Lookback days', value: '30' });
        if (daysStr === undefined) return;
        body.lookbackDays = Number(daysStr) || 30;
      } else if (kind === 'architecture') {
        const question = await vscode.window.showInputBox({ prompt: 'Specific architectural focus question', value: 'How does the middleware interact with route handlers?' });
        if (question === undefined) return;
        body.focusQuestion = question;

        const daysStr = await vscode.window.showInputBox({ prompt: 'Lookback days', value: '30' });
        if (daysStr === undefined) return;
        body.lookbackDays = Number(daysStr) || 30;
      }

      const available = await loadAvailableFilters(api!, snapshot.activeProjectId!);
      const filterResult = await openFilterPanel(context.extensionUri, available.filters, {
        title: `Generate ${selected.label.toLowerCase()}`,
        figmaGate: available.figma,
        subtitle: activeProject.name,
        generateLabel: 'Generate insight',
      });
      if (!filterResult) return;
      if (filterResult.sources.length) body.sources = filterResult.sources;
      if (Object.keys(filterResult.filters).length) body.filters = filterResult.filters;

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Generating project insight (${selected.label}) for ${activeProject.name}...`,
        },
        async () => {
          try {
            const insight = await runGenerateInsight(api!, snapshot.activeProjectId!, kind, body);
            showInsightDocument(insight);
            await refreshAll();
            vscode.window.showInformationMessage(`Insight generated: ${insight.title}`);
          } catch (err) {
            vscode.window.showErrorMessage(`Failed to generate insight: ${(err as Error).message}`);
          }
        },
      );
    }),
  );

  // Generate Release Notes
  context.subscriptions.push(
    vscode.commands.registerCommand('flowrelay.generateReleaseNotes', async () => {
      if (!(await ensureApi())) return;
      await refreshAll(true);

      if (!snapshot.activeProjectId) {
        const choice = await vscode.window.showWarningMessage(
          'Please select a project context first to generate release notes.',
          'Select Project',
        );
        if (choice === 'Select Project') {
          await vscode.commands.executeCommand('flowrelay.selectProject');
        }
        if (!snapshot.activeProjectId) return;
      }

      const activeProject = getActiveProject();
      if (!activeProject) return;

      const stylePick = await vscode.window.showQuickPick(
        [
          { label: 'Release notes', value: 'release_notes', description: 'Notes for a release, grouped by change class.' },
          { label: 'PR description', value: 'pr_description', description: 'A single pull-request write-up.' },
        ],
        { placeHolder: 'Select the output style' },
      );
      if (!stylePick) return;

      const available = await loadAvailableFilters(api!, snapshot.activeProjectId!);
      const repos = CODE_SOURCES.flatMap((source) =>
        (available.filters[source]?.projects ?? []).map((p) => ({
          label: p.label,
          description: SOURCE_NAMES[source] ?? source,
          source,
          repo: p.id,
        })),
      );

      const body: Record<string, unknown> = { style: stylePick.value };
      if (repos.length > 0) {
        const repoPick = await vscode.window.showQuickPick(
          [{ label: 'All tracked repositories', description: '', source: '', repo: '' }, ...repos],
          { placeHolder: 'Select a repository' },
        );
        if (!repoPick) return;
        if (repoPick.repo) {
          body.source = repoPick.source;
          body.repo = repoPick.repo;
        }
      }

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Generating ${stylePick.label.toLowerCase()} for ${activeProject.name}...`,
        },
        async () => {
          try {
            const insight = await runGenerateInsight(api!, snapshot.activeProjectId!, 'release_notes', body);
            showInsightDocument(insight);
            await refreshAll();
            vscode.window.showInformationMessage(`Release notes generated: ${insight.title}`);
          } catch (err) {
            vscode.window.showErrorMessage(`Failed to generate release notes: ${(err as Error).message}`);
          }
        },
      );
    }),
  );

  // List Insights
  context.subscriptions.push(
    vscode.commands.registerCommand('flowrelay.listInsights', async () => {
      if (!(await ensureApi())) return;
      await refreshAll(true);

      if (!snapshot.activeProjectId) {
        vscode.window.showErrorMessage('Please select a project context first to list insights.');
        return;
      }

      const activeProject = getActiveProject();
      if (!activeProject) return;

      try {
        const insights = await api!.listInsights(snapshot.activeProjectId!);
        if (insights.length === 0) {
          vscode.window.showInformationMessage(`No insights found for project ${activeProject.name}.`);
          return;
        }

        const pick = await vscode.window.showQuickPick(
          insights.map((ins) => ({
            label: ins.title,
            description: `${ins.kind} • ${ins.status}`,
            detail: ins.summary.slice(0, 120) + '...',
            insight: ins,
          })),
          { placeHolder: 'Select an insight to view' },
        );
        if (pick) showInsightDocument(pick.insight);
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to list insights: ${(err as Error).message}`);
      }
    }),
  );

  // Ask this project
  context.subscriptions.push(
    vscode.commands.registerCommand('flowrelay.askProject', async () => {
      if (!(await ensureApi())) return;
      await refreshAll(true);

      if (!snapshot.activeProjectId) {
        vscode.window.showErrorMessage('Please select a project context first to ask a question.');
        return;
      }

      const activeProject = getActiveProject();
      if (!activeProject) return;

      const question = await vscode.window.showInputBox({
        prompt: `Ask a question about ${activeProject.name} (2 credits per question)`,
        placeHolder: 'Why did we move checkout off the legacy queue?',
        validateInput: (value) =>
          value.trim().length === 0
            ? 'A question is required'
            : value.length > 2000
              ? 'Questions are capped at 2000 characters'
              : null,
      });
      if (!question) return;

      try {
        const result = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Flow Relay: answering…' },
          () => api!.askProject(snapshot.activeProjectId!, question.trim()),
        );
        const refs = result.citations.length > 0 ? `\n\n_Evidence: ${result.citations.join(' ')}_` : '';
        const doc = await vscode.workspace.openTextDocument({
          content: `# ${question.trim()}\n\n${result.answer}${refs}\n`,
          language: 'markdown',
        });
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch (err) {
        vscode.window.showErrorMessage(`Could not answer: ${(err as Error).message}`);
      }
    }),
  );

  // Show Digests
  context.subscriptions.push(
    vscode.commands.registerCommand('flowrelay.listDigests', async () => {
      if (!(await ensureApi())) return;
      await refreshAll(true);

      if (!snapshot.activeProjectId) {
        vscode.window.showErrorMessage('Please select a project context first to list digests.');
        return;
      }

      const activeProject = getActiveProject();
      if (!activeProject) return;

      try {
        const digests = await api!.listDigests(snapshot.activeProjectId!);
        if (digests.length === 0) {
          vscode.window.showInformationMessage(
            `No digests for ${activeProject.name} yet. Turn on scheduled digests from the project page.`,
          );
          return;
        }

        const pick = await vscode.window.showQuickPick(
          digests.map((d) => ({
            label: `${d.periodStart.slice(0, 10)} to ${d.periodEnd.slice(0, 10)}`,
            description: activeProject.name,
            digest: d,
          })),
          { placeHolder: 'Select a digest to view' },
        );
        if (!pick) return;
        const doc = await vscode.workspace.openTextDocument({
          content: pick.digest.markdown,
          language: 'markdown',
        });
        await vscode.window.showTextDocument(doc, { preview: false });
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to list digests: ${(err as Error).message}`);
      }
    }),
  );

  // Open Handoff (from sidebar click)
  context.subscriptions.push(
    vscode.commands.registerCommand('flowrelay.openHandoff', (handoff: Handoff) => {
      showHandoffDocument(handoff);
    }),
  );

}

function showHandoffDocument(handoff: Handoff) {
  // Server renders the canonical Markdown (identical to the dashboard copy
  // button); the local build only covers pre-markdown servers.
  let content = handoff.markdown;
  if (!content) {
    content = `# ${handoff.title}\n\n${handoff.summary}\n`;
    if (handoff.key_changes?.length) {
      content += `\n## Key Changes\n${handoff.key_changes.map((c) => `- ${c}`).join('\n')}\n`;
    }
    if (handoff.decisions.length) {
      content += `\n## Decisions\n${handoff.decisions.map((d) => `- ${d}`).join('\n')}\n`;
    }
    if (handoff.open_questions.length) {
      content += `\n## Open Questions\n${handoff.open_questions.map((q) => `- ${q}`).join('\n')}\n`;
    }
    if (handoff.next_steps.length) {
      content += `\n## Next Steps\n${handoff.next_steps.map((s) => `- ${s}`).join('\n')}\n`;
    }
  }

  const uri = vscode.Uri.parse(`untitled:Flow Relay - ${handoff.title}.md`);
  vscode.workspace.openTextDocument(uri).then((doc) => {
    const edit = new vscode.WorkspaceEdit();
    edit.insert(uri, new vscode.Position(0, 0), content);
    vscode.workspace.applyEdit(edit).then(() => {
      vscode.window.showTextDocument(doc, { preview: true });
    });
  });
}

async function runGenerateHandoff(
  api: FlowRelayAPI,
  sources: string[] | undefined,
  filters: Record<string, SourceFilter> | undefined,
  projectId: string,
): Promise<Handoff> {
  const { jobId } = await api.generateHandoff(sources, filters, projectId);
  const { job, result } = await api.waitForJob(jobId);
  if (job.status === 'failed' || !result) {
    throw new Error(job.error ?? 'Handoff generation failed.');
  }
  return result as Handoff;
}

async function runGenerateInsight(
  api: FlowRelayAPI,
  projectId: string,
  kind: 'correlation' | 'onboarding' | 'architecture' | 'release_notes',
  body?: Record<string, unknown>,
): Promise<Insight> {
  const res = await api.generateInsight(projectId, kind, body);
  const { job, result } = await api.waitForJob(res.jobId);
  if (job.status === 'failed' || !result) {
    throw new Error(job.error ?? 'Insight generation failed.');
  }
  return result as Insight;
}

function showInsightDocument(insight: Insight) {
  // Server renders the canonical Markdown (identical to the dashboard copy
  // button); the local build only covers pre-markdown servers.
  const content = insight.markdown ?? `# ${insight.title}\n\n${insight.summary}\n`;

  const uri = vscode.Uri.parse(`untitled:Flow Relay - Insight - ${insight.title}.md`);
  vscode.workspace.openTextDocument(uri).then((doc) => {
    const edit = new vscode.WorkspaceEdit();
    edit.insert(uri, new vscode.Position(0, 0), content);
    vscode.workspace.applyEdit(edit).then(() => {
      vscode.window.showTextDocument(doc, { preview: true });
    });
  });
}

export function deactivate() {}
