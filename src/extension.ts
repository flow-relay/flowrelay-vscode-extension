/**
 * @license
 * Flow Relay VS Code Extension
 * Copyright (c) 2026 Adriano Sorbello (atrisorb) <https://github.com/atrisorb>
 * Licensed under GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)
 */

import * as vscode from 'vscode';
import { FlowRelayAPI, Handoff, TenantProject, Insight, SourceFilter, AvailableFilters, FigmaGateInfo, MyWorkItem, SuggestionSummary, WorkItemRef, WorkStatus } from './api';
import {
  HandoffsProvider,
  IntegrationsProvider,
  MyWorkProvider,
  WORK_STATUS_LABEL,
  WorkItemTreeItem,
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

interface GitRepository {
  rootUri: vscode.Uri;
  state: { HEAD?: { name?: string }; onDidChange: vscode.Event<void> };
  createBranch(name: string, checkout: boolean): Promise<void>;
  checkout(treeish: string): Promise<void>;
}

interface GitApi {
  repositories: GitRepository[];
  onDidOpenRepository: vscode.Event<GitRepository>;
}

interface GitExtension {
  getAPI(version: 1): GitApi;
}

async function gitApi(): Promise<GitApi | null> {
  const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
  if (!extension) return null;
  const git = extension.isActive ? extension.exports : await extension.activate();
  return git.getAPI(1);
}

async function pickGitRepository(): Promise<GitRepository | null> {
  const repositories = (await gitApi())?.repositories ?? [];
  if (repositories.length <= 1) return repositories[0] ?? null;
  const pick = await vscode.window.showQuickPick(
    repositories.map((repository) => ({ label: vscode.workspace.asRelativePath(repository.rootUri), repository })),
    { placeHolder: 'Create the branch in which repository?' },
  );
  return pick?.repository ?? null;
}

function suggestionLabel(s: SuggestionSummary): string {
  const text = (value: unknown, fallback: string) => (typeof value === 'string' && value.length > 0 ? value : fallback);
  const p = s.payload;
  switch (s.type) {
    case 'status_change':
      return `${s.item ?? 'An item'}: move to ${text(p.to, 'a new status')}`;
    case 'create_item':
      return `New item: ${text(p.title, 'Untitled')}`;
    case 'dependency':
      return `${text(p.predecessor, 'An item')} should finish before ${text(p.successor, 'another item')} starts`;
    case 'evidence':
      return `${s.item ?? 'An item'}: "${text(p.title, 'Untitled')}" as evidence`;
  }
}

function branchNameFor(item: MyWorkItem): string {
  const slug = item.title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  const key = item.key.toLowerCase();
  return slug ? `${key}-${slug}` : key;
}

export function branchItemRefs(branch: string): string[] {
  return [...branch.matchAll(/(?:^|[/_-])([a-z][a-z0-9]{1,9})-(\d{1,7})(?![0-9])/gi)].map(
    (match) => `${match[1].toUpperCase()}-${Number(match[2])}`,
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
  const myWorkProvider = new MyWorkProvider(() => api);

  vscode.window.registerTreeDataProvider('flowrelay.workspace', workspaceProvider);
  vscode.window.registerTreeDataProvider('flowrelay.myWork', myWorkProvider);
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

  const branchItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  branchItem.command = 'flowrelay.showBranchWorkItem';
  context.subscriptions.push(branchItem);
  let branchWorkItem: { item: WorkItemRef; project: TenantProject } | null = null;
  let branchLookup = 0;

  const findBranchWorkItem = async () => {
    const git = await gitApi();
    if (!api || !git || !snapshot.tenant) return null;
    const refs = git.repositories.flatMap((repository) => branchItemRefs(repository.state.HEAD?.name ?? ''));
    for (const ref of refs) {
      for (const project of snapshot.tenant.projects.filter((p) => p.key && ref.startsWith(`${p.key}-`))) {
        const item = await api.getWorkItem(project.id, ref).catch(() => null);
        if (item) return { item, project };
      }
    }
    return null;
  };

  const refreshBranchItem = async () => {
    const lookup = ++branchLookup;
    const found = await findBranchWorkItem();
    if (lookup !== branchLookup) return;
    branchWorkItem = found;
    if (!found) {
      branchItem.hide();
      return;
    }
    branchItem.text = `$(tasklist) ${found.item.key} ${WORK_STATUS_LABEL[found.item.status]}${found.item.blocked ? ' (blocked)' : ''}`;
    branchItem.tooltip = `${found.item.key} ${found.item.title}\n${found.project.name} – ${found.item.percentComplete}% complete`;
    branchItem.show();
  };

  let lastHeads = '';
  const watchBranches = (git: GitApi) => {
    const heads = git.repositories.map((repository) => repository.state.HEAD?.name ?? '').join('|');
    if (heads === lastHeads) return;
    lastHeads = heads;
    void refreshBranchItem();
  };

  void gitApi().then((git) => {
    if (!git) return;
    const watch = (repository: GitRepository) => {
      context.subscriptions.push(repository.state.onDidChange(() => watchBranches(git)));
    };
    git.repositories.forEach(watch);
    context.subscriptions.push(
      git.onDidOpenRepository((repository) => {
        watch(repository);
        watchBranches(git);
      }),
    );
    watchBranches(git);
  });

  const refreshAll = async (showErrors = false) => {
    try {
      await refreshWorkspaceContext();
    } catch (err) {
      if (showErrors) {
        vscode.window.showErrorMessage(`Failed to load workspace context: ${(err as Error).message}`);
      }
    }

    workspaceProvider.refresh();
    myWorkProvider.refresh();
    handoffsProvider.refresh();
    integrationsProvider.refresh();
    updateStatusBar();
    void refreshBranchItem();
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

  // Plan review
  context.subscriptions.push(
    vscode.commands.registerCommand('flowrelay.generatePlanReview', async () => {
      if (!(await ensureApi())) return;
      await refreshAll(true);
      if (!snapshot.activeProjectId) {
        vscode.window.showErrorMessage('Please select a project context first to review its plan.');
        return;
      }
      const activeProject = getActiveProject();
      if (!activeProject) return;
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Reviewing the plan of ${activeProject.name}...` },
        async () => {
          try {
            const insight = await runGenerateInsight(api!, snapshot.activeProjectId!, 'plan_review');
            showInsightDocument(insight);
            await refreshAll();
            vscode.window.showInformationMessage(`Plan review ready: ${insight.title}`);
          } catch (err) {
            vscode.window.showErrorMessage(`Failed to review the plan: ${(err as Error).message}`);
          }
        },
      );
    }),
  );

  // Earned value
  context.subscriptions.push(
    vscode.commands.registerCommand('flowrelay.showEarnedValue', async () => {
      if (!(await ensureApi())) return;
      await refreshAll(true);
      if (!snapshot.activeProjectId) {
        vscode.window.showErrorMessage('Please select a project context first to read its earned value.');
        return;
      }
      const activeProject = getActiveProject();
      if (!activeProject) return;
      try {
        const evm = await api!.getEarnedValue(snapshot.activeProjectId!);
        const money = (cents: number | null) => (cents === null ? 'n/a' : new Intl.NumberFormat('en', { style: 'currency', currency: evm.currency }).format(cents / 100));
        const index = (v: number | null) => (v === null ? 'n/a' : v.toFixed(2));
        const e = evm.earnedValue;
        const pick = await vscode.window.showQuickPick(
          [
            { label: `Planned cost ${money(evm.plannedCostCents)}`, description: `Actual cost ${money(evm.actualCostCents)}${evm.budgetCents === null ? '' : ` · Budget ${money(evm.budgetCents)}`}` },
            { label: `Earned value ${money(e.earnedValueCents)}`, description: `Planned value ${money(e.plannedValueCents)} · Budget at completion ${money(e.budgetAtCompletionCents)}` },
            { label: `SPI ${index(e.spi)} · CPI ${index(e.cpi)}`, description: `Schedule variance ${money(e.scheduleVarianceCents)} · Cost variance ${money(e.costVarianceCents)} · TCPI ${index(e.tcpi)}` },
            { label: `Estimate at completion ${money(e.estimateAtCompletionCents.cpi)}`, description: `Budgeted rate ${money(e.estimateAtCompletionCents.budgetRate)} · Cost and schedule ${money(e.estimateAtCompletionCents.cpiSpi)}` },
          ],
          { placeHolder: `Earned value of ${activeProject.name} as of ${evm.statusDate}${evm.baseline === null ? ' (no baseline with costs yet)' : ''}` },
        );
        if (pick) await vscode.env.clipboard.writeText(`${pick.label} – ${pick.description}`);
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to read earned value: ${(err as Error).message}`);
      }
    }),
  );

  // RAID register
  context.subscriptions.push(
    vscode.commands.registerCommand('flowrelay.showRegister', async () => {
      if (!(await ensureApi())) return;
      await refreshAll(true);
      if (!snapshot.activeProjectId) {
        vscode.window.showErrorMessage('Please select a project context first to read its register.');
        return;
      }
      const activeProject = getActiveProject();
      if (!activeProject) return;
      try {
        const entries = (await api!.listRaid(snapshot.activeProjectId!)).filter((e) => e.status !== 'closed');
        if (entries.length === 0) {
          vscode.window.showInformationMessage(`No open register entries in ${activeProject.name}.`);
          return;
        }
        await vscode.window.showQuickPick(
          entries.map((e) => ({
            label: `R-${e.number} ${e.title}`,
            description: `${e.type} · ${e.status}${e.score === null ? '' : ` · score ${e.score}`}${e.dueOn ? ` · due ${e.dueOn}` : ''}${e.item ? ` · ${e.item}` : ''}`,
            detail: e.response || undefined,
          })),
          { placeHolder: `Open register entries of ${activeProject.name}` },
        );
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to read the register: ${(err as Error).message}`);
      }
    }),
  );

  // Forecast
  context.subscriptions.push(
    vscode.commands.registerCommand('flowrelay.showForecast', async () => {
      if (!(await ensureApi())) return;
      await refreshAll(true);
      if (!snapshot.activeProjectId) {
        vscode.window.showErrorMessage('Please select a project context first to forecast its plan.');
        return;
      }
      const activeProject = getActiveProject();
      if (!activeProject) return;
      const mode = await vscode.window.showQuickPick(
        [
          { label: 'From the durations of the plan', mode: 'schedule' as const },
          { label: 'From how fast the team finishes', mode: 'throughput' as const },
        ],
        { placeHolder: `Forecast of ${activeProject.name}` },
      );
      if (!mode) return;
      const day = (v: string | null | undefined) => (v ? v.slice(0, 10) : 'n/a');
      const pct = (v: number | null | undefined) => (v === null || v === undefined ? 'n/a' : `${Math.round(v * 100)}%`);
      try {
        const f = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Simulating the plan...' },
          () => api!.getForecast(snapshot.activeProjectId!, mode.mode),
        );
        if (f.mode === 'throughput') {
          if (!f.available) {
            vscode.window.showInformationMessage(`Not enough history yet: the throughput forecast needs 4 weeks with something finished (${f.weeksOfHistory ?? 0} so far).`);
            return;
          }
          await vscode.window.showQuickPick(
            [
              { label: `Half of the runs: ${day(f.p50)}`, description: `${f.backlog} open items at the recent pace` },
              { label: `Four out of five: ${day(f.p80)}` },
              { label: `Nineteen out of twenty: ${day(f.p95)}`, description: f.chance === null || f.chance === undefined ? undefined : `Chance of the target: ${pct(f.chance)}` },
            ],
            { placeHolder: `Throughput forecast of ${activeProject.name}` },
          );
          return;
        }
        const p = f.project!;
        await vscode.window.showQuickPick(
          [
            { label: `The plan says ${day(p.plan)}`, description: p.target ? `Target ${day(p.target)}, chance ${pct(p.chance)}` : undefined },
            { label: `Half of the runs: ${day(p.p50)}` },
            { label: `Four out of five: ${day(p.p80)}` },
            { label: `Nineteen out of twenty: ${day(p.p95)}` },
            ...(f.milestones ?? []).map((m) => ({ label: `${m.ref} ${m.title}`, description: `plan ${day(m.plan)} · likely by ${day(m.p80)} · ${pct(m.chance)} chance` })),
            ...(f.critical ?? []).slice(0, 3).map((c) => ({ label: `Critical: ${c.ref} ${c.title}`, description: `${Math.round(c.index * 100)}% of runs` })),
          ],
          { placeHolder: `Forecast of ${activeProject.name} (${f.iterations} runs)` },
        );
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to forecast: ${(err as Error).message}`);
      }
    }),
  );

  // Work item from the editor
  context.subscriptions.push(
    vscode.commands.registerCommand('flowrelay.createWorkItemFromSelection', async () => {
      if (!(await ensureApi())) return;
      await refreshAll(true);
      const editor = vscode.window.activeTextEditor;
      const selected = editor && !editor.selection.isEmpty ? editor.document.getText(editor.selection).trim() : '';
      if (!selected) {
        vscode.window.showErrorMessage('Select the text that describes the work first.');
        return;
      }
      if (!snapshot.activeProjectId) {
        vscode.window.showErrorMessage('Please select a project context first to add an item to its plan.');
        return;
      }
      const activeProject = getActiveProject();
      if (!activeProject) return;
      const lines = selected.split(/\r?\n/);
      const title = await vscode.window.showInputBox({
        title: `New item in ${activeProject.name}`,
        prompt: 'Name of the item',
        value: lines[0].slice(0, 200),
        validateInput: (v) => (v.trim() ? undefined : 'A name is required'),
      });
      if (!title) return;
      const file = editor ? vscode.workspace.asRelativePath(editor.document.uri) : '';
      const line = editor ? editor.selection.start.line + 1 : 0;
      const description = `${lines.slice(1).join('\n').trim()}${file ? `\n\nFrom ${file}:${line}` : ''}`.trim();
      try {
        const item = await api!.createWorkItem(snapshot.activeProjectId!, { title: title.trim(), description });
        vscode.window.showInformationMessage(`Created ${item.key}: ${item.title}`);
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to create the item: ${(err as Error).message}`);
      }
    }),
  );

  // What-if
  context.subscriptions.push(
    vscode.commands.registerCommand('flowrelay.planWhatIf', async () => {
      if (!(await ensureApi())) return;
      await refreshAll(true);
      if (!snapshot.activeProjectId) {
        vscode.window.showErrorMessage('Please select a project context first to ask about its plan.');
        return;
      }
      const activeProject = getActiveProject();
      if (!activeProject) return;
      const question = await vscode.window.showInputBox({
        title: `What if... (${activeProject.name})`,
        prompt: 'Ask a what-if question about the plan. It costs 5 credits and changes nothing.',
        placeHolder: 'What if the payment integration takes three weeks longer?',
        validateInput: (v) => (v.trim().length >= 5 ? undefined : 'Write at least a few words'),
      });
      if (!question) return;
      const day = (v: string | null | undefined) => (v ? v.slice(0, 10) : 'n/a');
      try {
        const r = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Trying it on a copy of the plan...' },
          () => api!.planWhatIf(snapshot.activeProjectId!, question.trim()),
        );
        const change = (d: number | null) => (d === null || d === 0 ? 'no change' : `${d > 0 ? '+' : ''}${d} working days`);
        const items: vscode.QuickPickItem[] = [
          ...r.changes.map((c) => ({ label: `Tried: ${c}` })),
          ...(r.left_out.length > 0 ? [{ label: `Left out: ${r.left_out.join('; ')}` }] : []),
          ...(r.comparison
            ? [
                { label: `Finish: ${day(r.comparison.projectFinish.scenario)} instead of ${day(r.comparison.projectFinish.now)}`, description: change(r.comparison.projectFinish.deltaWorkingDays) },
                { label: `${r.comparison.moved} items move`, description: `${r.comparison.criticalBecame} become critical, ${r.comparison.criticalLeft} stop being critical` },
                ...r.comparison.milestones.map((m) => ({ label: `${m.ref} ${m.title}`, description: `${day(m.now)} to ${day(m.scenario)} (${change(m.deltaWorkingDays)})` })),
              ]
            : [{ label: 'Nothing could be compared', description: r.errors.join('; ') }]),
        ];
        await vscode.window.showQuickPick(items, { placeHolder: r.explanation || 'What-if result. Nothing was saved.' });
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to answer the what-if: ${(err as Error).message}`);
      }
    }),
  );

  // Templates
  context.subscriptions.push(
    vscode.commands.registerCommand('flowrelay.applyTemplate', async () => {
      if (!(await ensureApi())) return;
      await refreshAll(true);
      if (!snapshot.activeProjectId) {
        vscode.window.showErrorMessage('Please select a project context first to add a template to its plan.');
        return;
      }
      const activeProject = getActiveProject();
      if (!activeProject) return;
      try {
        const templates = await api!.listTemplates(snapshot.activeProjectId!);
        if (templates.length === 0) {
          vscode.window.showInformationMessage(`No templates are saved for ${activeProject.name}.`);
          return;
        }
        const pick = await vscode.window.showQuickPick(
          templates.map((t) => ({ label: t.name, description: `${t.itemCount} item${t.itemCount === 1 ? '' : 's'}`, detail: t.description || undefined, id: t.id })),
          { placeHolder: `Add a template to ${activeProject.name}` },
        );
        if (!pick) return;
        const parent = await vscode.window.showInputBox({ prompt: 'Item key to add it under, for example FR-12. Leave empty for the top level.', placeHolder: 'FR-12' });
        if (parent === undefined) return;
        const created = await api!.applyTemplate(snapshot.activeProjectId!, pick.id, parent.trim() || undefined);
        vscode.window.showInformationMessage(`Added ${created} item${created === 1 ? '' : 's'} from ${pick.label}.`);
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to apply the template: ${(err as Error).message}`);
      }
    }),
  );

  // Change requests
  context.subscriptions.push(
    vscode.commands.registerCommand('flowrelay.showApprovals', async () => {
      if (!(await ensureApi())) return;
      await refreshAll(true);
      if (!snapshot.activeProjectId) {
        vscode.window.showErrorMessage('Please select a project context first to read its change requests.');
        return;
      }
      const activeProject = getActiveProject();
      if (!activeProject) return;
      try {
        const approvals = await api!.listApprovals(snapshot.activeProjectId!);
        if (approvals.length === 0) {
          vscode.window.showInformationMessage(`${activeProject.name} has no change requests.`);
          return;
        }
        await vscode.window.showQuickPick(
          approvals.map((a) => ({
            label: a.title,
            description: `${a.kind === 'scope' ? 'plan change' : 'baseline'} · ${a.status === 'pending' ? 'waiting for a decision' : a.status === 'failed' ? 'approved, not applied' : a.status}${a.requestedBy ? ` · asked by ${a.requestedBy}` : ''}`,
            detail: [...a.summary, ...(a.decisionNote ? [`${a.decidedBy ?? 'A reviewer'}: ${a.decisionNote}`] : [])].join('; ') || undefined,
          })),
          { placeHolder: `Change requests of ${activeProject.name}`, matchOnDescription: true },
        );
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to read the change requests: ${(err as Error).message}`);
      }
    }),
    vscode.commands.registerCommand('flowrelay.requestChange', async () => {
      if (!(await ensureApi())) return;
      await refreshAll(true);
      if (!snapshot.activeProjectId) {
        vscode.window.showErrorMessage('Please select a project context first to ask for a change to its plan.');
        return;
      }
      const activeProject = getActiveProject();
      if (!activeProject) return;
      const item = await vscode.window.showInputBox({ prompt: 'Item key, for example FR-12', placeHolder: 'FR-12', ignoreFocusOut: true });
      if (!item?.trim()) return;
      const field = await vscode.window.showQuickPick(
        [
          { label: 'Status', key: 'status' },
          { label: 'Progress', key: 'percentComplete' },
          { label: 'Duration', key: 'duration' },
          { label: 'Deadline', key: 'deadline' },
        ],
        { placeHolder: 'What should change?' },
      );
      if (!field) return;
      let value: unknown;
      if (field.key === 'status') {
        const status = await vscode.window.showQuickPick(
          (Object.keys(WORK_STATUS_LABEL) as WorkStatus[]).map((s) => ({ label: WORK_STATUS_LABEL[s], status: s })),
          { placeHolder: 'New status' },
        );
        if (!status) return;
        value = status.status;
      } else {
        const text = await vscode.window.showInputBox({
          prompt:
            field.key === 'percentComplete'
              ? 'Progress from 0 to 100'
              : field.key === 'duration'
                ? 'Duration such as 4h, 3d, 2w or 3ed'
                : 'Deadline as YYYY-MM-DD, or empty to clear it',
          ignoreFocusOut: true,
        });
        if (text === undefined) return;
        if (field.key === 'percentComplete') {
          const n = Number(text);
          if (!Number.isInteger(n) || n < 0 || n > 100) {
            vscode.window.showErrorMessage('Progress must be a whole number from 0 to 100.');
            return;
          }
          value = n;
        } else {
          value = field.key === 'deadline' && !text.trim() ? null : text.trim();
        }
      }
      const title = await vscode.window.showInputBox({ prompt: 'What do you want changed, in a few words?', ignoreFocusOut: true });
      if (!title?.trim()) return;
      const note = await vscode.window.showInputBox({ prompt: 'Why? Optional.', ignoreFocusOut: true });
      if (note === undefined) return;
      try {
        await api!.requestChange(snapshot.activeProjectId!, { item: item.trim(), title: title.trim(), note: note.trim() || undefined, changes: { [field.key]: value } });
        vscode.window.showInformationMessage(`Change request sent to the approvers of ${activeProject.name}. Nothing changes until someone else approves it.`);
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to send the change request: ${(err as Error).message}`);
      }
    }),
  );

  // Suggestions, register entries, deletions and decisions
  context.subscriptions.push(
    vscode.commands.registerCommand('flowrelay.resolveSuggestion', async () => {
      if (!(await ensureApi())) return;
      await refreshAll(true);
      if (!snapshot.activeProjectId) {
        vscode.window.showErrorMessage('Please select a project context first to read its suggestions.');
        return;
      }
      const activeProject = getActiveProject();
      if (!activeProject) return;
      try {
        const suggestions = await api!.listSuggestions(snapshot.activeProjectId!);
        if (suggestions.length === 0) {
          vscode.window.showInformationMessage(`${activeProject.name} has no pending suggestions.`);
          return;
        }
        const picked = await vscode.window.showQuickPick(
          suggestions.map((s) => ({
            label: suggestionLabel(s),
            description: s.forYou ? 'for you' : undefined,
            detail: typeof s.payload.reason === 'string' ? s.payload.reason : undefined,
            id: s.id,
          })),
          { placeHolder: `Suggestions of ${activeProject.name}` },
        );
        if (!picked) return;
        const action = await vscode.window.showQuickPick(
          [
            { label: 'Accept', description: 'Apply it to the plan', action: 'accept' as const },
            { label: 'Dismiss', description: 'Hide it', action: 'dismiss' as const },
          ],
          { placeHolder: picked.label },
        );
        if (!action) return;
        const status = await api!.resolveSuggestion(snapshot.activeProjectId!, picked.id, action.action);
        vscode.window.showInformationMessage(`Suggestion ${status}.`);
        await refreshAll(true);
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to resolve the suggestion: ${(err as Error).message}`);
      }
    }),
    vscode.commands.registerCommand('flowrelay.createRaidEntry', async () => {
      if (!(await ensureApi())) return;
      await refreshAll(true);
      if (!snapshot.activeProjectId) {
        vscode.window.showErrorMessage('Please select a project context first to add to its register.');
        return;
      }
      const activeProject = getActiveProject();
      if (!activeProject) return;
      const kind = await vscode.window.showQuickPick(
        (['risk', 'assumption', 'issue', 'decision', 'dependency'] as const).map((k) => ({ label: k, entry: k })),
        { placeHolder: 'What kind of entry?' },
      );
      if (!kind) return;
      const title = await vscode.window.showInputBox({ prompt: 'Title of the entry', ignoreFocusOut: true });
      if (!title?.trim()) return;
      const score = async (what: string): Promise<number | null | undefined> => {
        const choice = await vscode.window.showQuickPick(
          [{ label: 'Skip', value: null }, ...[1, 2, 3, 4, 5].map((n) => ({ label: String(n), value: n }))],
          { placeHolder: `${what} from 1 to 5, or skip` },
        );
        return choice ? choice.value : undefined;
      };
      const probability = kind.entry === 'risk' ? await score('Probability') : null;
      if (probability === undefined) return;
      const impact = kind.entry === 'risk' ? await score('Impact') : null;
      if (impact === undefined) return;
      try {
        const number = await api!.createRaidEntry(snapshot.activeProjectId!, {
          kind: kind.entry,
          title: title.trim(),
          ...(probability ? { probability } : {}),
          ...(impact ? { impact } : {}),
        });
        vscode.window.showInformationMessage(`Added ${kind.entry} #${number} to the register of ${activeProject.name}.`);
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to add the register entry: ${(err as Error).message}`);
      }
    }),
    vscode.commands.registerCommand('flowrelay.deleteWorkItem', async () => {
      if (!(await ensureApi())) return;
      await refreshAll(true);
      if (!snapshot.activeProjectId) {
        vscode.window.showErrorMessage('Please select a project context first to delete one of its items.');
        return;
      }
      const activeProject = getActiveProject();
      if (!activeProject) return;
      const ref = await vscode.window.showInputBox({ prompt: 'Key of the item to delete, for example FR-12', placeHolder: 'FR-12', ignoreFocusOut: true });
      if (!ref?.trim()) return;
      const confirmed = await vscode.window.showWarningMessage(
        `Delete ${ref.trim()} and everything under it from ${activeProject.name}? A project manager can restore it from the change history.`,
        { modal: true },
        'Delete',
      );
      if (confirmed !== 'Delete') return;
      try {
        await api!.deleteWorkItem(snapshot.activeProjectId!, ref.trim());
        vscode.window.showInformationMessage(`Deleted ${ref.trim()} from ${activeProject.name}.`);
        await refreshAll(true);
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to delete the item: ${(err as Error).message}`);
      }
    }),
    vscode.commands.registerCommand('flowrelay.decideApproval', async () => {
      if (!(await ensureApi())) return;
      await refreshAll(true);
      if (!snapshot.activeProjectId) {
        vscode.window.showErrorMessage('Please select a project context first to decide its change requests.');
        return;
      }
      const activeProject = getActiveProject();
      if (!activeProject) return;
      try {
        const pending = (await api!.listApprovals(snapshot.activeProjectId!)).filter((a) => a.status === 'pending');
        if (pending.length === 0) {
          vscode.window.showInformationMessage(`${activeProject.name} has no change requests waiting for a decision.`);
          return;
        }
        const request = await vscode.window.showQuickPick(
          pending.map((a) => ({
            label: a.title,
            description: a.requestedBy ? `asked by ${a.requestedBy}` : undefined,
            detail: a.summary.join('; ') || undefined,
            id: a.id,
          })),
          { placeHolder: `Change requests of ${activeProject.name}` },
        );
        if (!request) return;
        const decision = await vscode.window.showQuickPick(
          [
            { label: 'Approve', description: 'Apply the change to the plan', decision: 'approve' as const },
            { label: 'Reject', description: 'Refuse the change', decision: 'reject' as const },
            { label: 'Withdraw', description: 'Cancel a request you made', decision: 'withdraw' as const },
          ],
          { placeHolder: request.label },
        );
        if (!decision) return;
        const note = await vscode.window.showInputBox({ prompt: 'Why? Optional.', ignoreFocusOut: true });
        if (note === undefined) return;
        const status = await api!.decideApproval(snapshot.activeProjectId!, request.id, decision.decision, note.trim() || undefined);
        vscode.window.showInformationMessage(`Change request ${status}.`);
        await refreshAll(true);
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to decide the change request: ${(err as Error).message}`);
      }
    }),
  );

  // Portfolio
  context.subscriptions.push(
    vscode.commands.registerCommand('flowrelay.showPortfolio', async () => {
      if (!(await ensureApi())) return;
      await refreshAll(true);
      const organizations = new Map<string, string>();
      for (const project of snapshot.tenant?.projects ?? []) {
        if (project.organization_id) organizations.set(project.organization_id, project.organization_name ?? 'Organization');
      }
      if (organizations.size === 0) {
        vscode.window.showInformationMessage('The portfolio covers the projects of an organization: you have none yet.');
        return;
      }
      let organizationId = [...organizations.keys()][0];
      if (organizations.size > 1) {
        const chosen = await vscode.window.showQuickPick(
          [...organizations].map(([id, name]) => ({ label: name, id })),
          { placeHolder: 'Which organization?' },
        );
        if (!chosen) return;
        organizationId = chosen.id;
      }
      try {
        const portfolio = await api!.getPortfolio(organizationId);
        if (portfolio.projects.length === 0) {
          vscode.window.showInformationMessage('No project in this portfolio that you can open.');
          return;
        }
        const verdict = { green: 'On track', amber: 'At risk', red: 'Off track' } as const;
        const programs = new Map(portfolio.programs.map((p) => [p.id, p.name]));
        await vscode.window.showQuickPick(
          portfolio.projects.map((p) => {
            const h = p.health;
            const slip = h?.slipWorkingDays ?? null;
            const facts = [
              h ? `${verdict[h.verdict]}${h.overridden ? ' (set by hand)' : ''}` : 'Health not computed yet',
              p.percentComplete === null ? null : `${Math.round(p.percentComplete)}% complete`,
              p.scheduledFinish ? `forecast ${p.scheduledFinish.slice(0, 10)}` : null,
              slip === null ? null : slip > 0 ? `${slip} working days late` : slip < 0 ? `${-slip} working days ahead` : 'on schedule',
            ].filter((f): f is string => f !== null);
            const detail = [
              p.nextMilestone ? `Next: ${p.nextMilestone.ref} ${p.nextMilestone.title} on ${p.nextMilestone.finish.slice(0, 10)}` : null,
              p.openRisks > 0 ? `${p.openRisks} open risks` : null,
              h?.overdueItems ? `${h.overdueItems} overdue items` : null,
              p.programId ? `Program ${programs.get(p.programId) ?? 'unknown'}` : null,
              h?.comment ?? null,
            ].filter((f): f is string => f !== null);
            return { label: `${p.key} ${p.name}`, description: facts.join(' · '), detail: detail.join(' · ') || undefined };
          }),
          { placeHolder: `Portfolio of ${organizations.get(organizationId)}` },
        );
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to read the portfolio: ${(err as Error).message}`);
      }
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

  const pickMyWorkItem = async (placeHolder: string): Promise<MyWorkItem | undefined> => {
    const items = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Flow Relay: loading your work...' },
      () => api!.listMyWork(),
    );
    if (items.length === 0) {
      vscode.window.showInformationMessage('Nothing is assigned to you right now.');
      return undefined;
    }
    const pick = await vscode.window.showQuickPick(
      items.map((item) => ({
        label: `${item.key} ${item.title}`,
        description: `${WORK_STATUS_LABEL[item.status]} • ${item.project.name}`,
        detail: item.finish ? `Finish ${item.finish.replace('T', ' ')} (${item.project.timezone})` : undefined,
        item,
      })),
      { placeHolder, matchOnDescription: true },
    );
    return pick?.item;
  };

  const changeWorkItemStatus = async (item: Pick<MyWorkItem, 'id' | 'key' | 'status'> & { project: { id: string } }) => {
    const pick = await vscode.window.showQuickPick(
      (Object.keys(WORK_STATUS_LABEL) as WorkStatus[])
        .filter((status) => status !== item.status)
        .map((status) => ({ label: WORK_STATUS_LABEL[status], status })),
      { placeHolder: `${item.key} is ${WORK_STATUS_LABEL[item.status]}. Move it to...` },
    );
    if (!pick) return;
    const updated = await api!.updateWorkItemStatus(item.project.id, item.id, pick.status);
    vscode.window.showInformationMessage(`${updated.key} is now ${WORK_STATUS_LABEL[updated.status]}.`);
    myWorkProvider.refresh();
    void refreshBranchItem();
  };

  const startWorkItem = async (item: MyWorkItem) => {
    const branch = branchNameFor(item);
    const repository = await pickGitRepository();
    if (repository) {
      try {
        await repository.createBranch(branch, true);
      } catch {
        await repository.checkout(branch);
      }
      vscode.window.showInformationMessage(`Switched to ${branch}. Commits and pull requests on it link to ${item.key}.`);
    } else {
      await vscode.env.clipboard.writeText(branch);
      vscode.window.showInformationMessage(`Branch name ${branch} copied to the clipboard – create it in your repository.`);
    }
    if (item.status === 'backlog' || item.status === 'todo') {
      await api!.updateWorkItemStatus(item.project.id, item.id, 'in_progress');
    }
    myWorkProvider.refresh();
  };

  const workItemFrom = (arg: unknown) => (arg instanceof WorkItemTreeItem ? arg.workItem : undefined);

  // My Work
  context.subscriptions.push(
    vscode.commands.registerCommand('flowrelay.listMyWork', async () => {
      if (!(await ensureApi())) return;
      try {
        const item = await pickMyWorkItem('Select a work item');
        if (!item) return;
        const action = await vscode.window.showQuickPick(
          [
            { label: 'Start work', description: 'Create a branch named after the item and mark it in progress', id: 'start' },
            { label: 'Change status...', id: 'status' },
            { label: 'Open in Flow Relay', id: 'open' },
          ],
          { placeHolder: `${item.key} ${item.title}` },
        );
        if (action?.id === 'start') await startWorkItem(item);
        if (action?.id === 'status') await changeWorkItemStatus(item);
        if (action?.id === 'open') await vscode.env.openExternal(vscode.Uri.parse(item.url));
      } catch (err) {
        vscode.window.showErrorMessage(`Failed to load your work: ${(err as Error).message}`);
      }
    }),
    vscode.commands.registerCommand('flowrelay.updateWorkItemStatus', async (arg?: unknown) => {
      if (!(await ensureApi())) return;
      try {
        const item = workItemFrom(arg) ?? (await pickMyWorkItem('Select the item to update'));
        if (item) await changeWorkItemStatus(item);
      } catch (err) {
        vscode.window.showErrorMessage(`Could not update the item: ${(err as Error).message}`);
      }
    }),
    vscode.commands.registerCommand('flowrelay.startWorkItem', async (arg?: unknown) => {
      if (!(await ensureApi())) return;
      try {
        const item = workItemFrom(arg) ?? (await pickMyWorkItem('Select the item to start'));
        if (item) await startWorkItem(item);
      } catch (err) {
        vscode.window.showErrorMessage(`Could not start the item: ${(err as Error).message}`);
      }
    }),
    vscode.commands.registerCommand('flowrelay.openWorkItem', (item: MyWorkItem) => {
      void vscode.env.openExternal(vscode.Uri.parse(item.url));
    }),
    vscode.commands.registerCommand('flowrelay.showBranchWorkItem', async () => {
      if (!(await ensureApi())) return;
      try {
        await refreshBranchItem();
        if (!branchWorkItem) {
          vscode.window.showInformationMessage('The current branch names no work item. Branch names such as fr-12-refund-flow link to FR-12.');
          return;
        }
        const { item, project } = branchWorkItem;
        const action = await vscode.window.showQuickPick(
          [
            { label: 'Change status...', id: 'status' },
            { label: 'Open in Flow Relay', id: 'open' },
          ],
          { placeHolder: `${item.key} ${item.title} – ${WORK_STATUS_LABEL[item.status]}, ${item.percentComplete}% complete` },
        );
        if (action?.id === 'status') await changeWorkItemStatus({ ...item, project });
        if (action?.id === 'open') await vscode.env.openExternal(vscode.Uri.parse(item.url));
      } catch (err) {
        vscode.window.showErrorMessage(`Could not load the work item: ${(err as Error).message}`);
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
  kind: 'correlation' | 'onboarding' | 'architecture' | 'release_notes' | 'plan_review',
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
