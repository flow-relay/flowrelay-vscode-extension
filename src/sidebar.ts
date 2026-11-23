/**
 * @license
 * Flow Relay Sidebar Tree Providers
 * Copyright (c) 2026 Adriano Sorbello (atrisorb) <https://github.com/atrisorb>
 * Licensed under GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)
 */

import * as vscode from 'vscode';
import { FlowRelayAPI, MyWorkItem, TenantContext, TenantProject, WorkStatus } from './api';
import { SOURCES, SOURCE_NAMES, sourceSlug } from './filter-data';

export interface WorkspaceSnapshot {
  tenant: TenantContext | null;
  activeProjectId: string | null;
}

function getActiveProject(snapshot: WorkspaceSnapshot): TenantProject | null {
  if (!snapshot.tenant || !snapshot.activeProjectId) return null;
  return snapshot.tenant.projects.find((project) => project.id === snapshot.activeProjectId) ?? null;
}

function needsProjectChoice(snapshot: WorkspaceSnapshot): boolean {
  if (!snapshot.tenant) return false;
  return snapshot.tenant.organizations.length > 0 && snapshot.tenant.projects.length > 0 && !getActiveProject(snapshot);
}

function makeInfoItem(
  label: string,
  icon: string,
  tooltip?: string,
  command?: vscode.Command,
): vscode.TreeItem {
  const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
  item.iconPath = new vscode.ThemeIcon(icon);
  if (tooltip) item.tooltip = tooltip;
  if (command) item.command = command;
  return item;
}

// ── Workspace Tree ───────────────────────────────────────────────────

export class WorkspaceProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(
    private getApi: () => FlowRelayAPI | null,
    private extensionUri: vscode.Uri,
    private getWorkspaceSnapshot: () => WorkspaceSnapshot,
  ) {}

  refresh() { this._onDidChange.fire(); }

  getTreeItem(element: vscode.TreeItem) { return element; }

  private markIcon() {
    return {
      light: vscode.Uri.joinPath(this.extensionUri, 'media', 'icon.svg'),
      dark: vscode.Uri.joinPath(this.extensionUri, 'media', 'icon-dark-theme.svg'),
    };
  }

  async getChildren(): Promise<vscode.TreeItem[]> {
    const api = this.getApi();
    if (!api) {
      return [makeInfoItem(
        'Set API key to load workspace context',
        'key',
        undefined,
        {
          command: 'flowrelay.setApiKey',
          title: 'Set API Key',
        },
      )];
    }

    const snapshot = this.getWorkspaceSnapshot();
    if (!snapshot.tenant) {
      return [makeInfoItem('Loading workspace context...', 'sync~spin')];
    }

    const tenant = snapshot.tenant;
    const activeProject = getActiveProject(snapshot);
    const items: vscode.TreeItem[] = [];
    const orgCount = tenant.organizations.length;

    const header = new vscode.TreeItem('Flow Relay', vscode.TreeItemCollapsibleState.None);
    header.description = orgCount === 0
      ? 'Personal projects'
      : `Personal projects and ${orgCount} ${orgCount === 1 ? 'organization' : 'organizations'}`;
    header.tooltip = orgCount === 0
      ? 'Your API key reaches your personal projects.'
      : `Your API key reaches your personal projects and ${tenant.organizations.map((org) => org.name).join(', ')}.`;
    header.iconPath = this.markIcon();
    items.push(header);

    items.push(makeInfoItem(
      `Projects you can open: ${tenant.projects.length}`,
      'layers',
      'Personal projects plus the organization projects of your teams.',
    ));

    if (activeProject) {
      const workspace = activeProject.project_type === 'organization'
        ? activeProject.organization_name ?? 'Organization'
        : 'Personal';
      const roleLabel = activeProject.access_role === 'owner'
        ? 'Owner'
        : activeProject.access_role === 'admin'
          ? 'Admin'
          : 'Member';

      items.push(makeInfoItem(`Project: ${activeProject.name}`, 'folder'));
      items.push(makeInfoItem(
        `Workspace: ${workspace}`,
        activeProject.project_type === 'organization' ? 'organization' : 'person',
      ));
      items.push(makeInfoItem(
        `Role: ${roleLabel}`,
        'shield',
        roleLabel === 'Member'
          ? 'You can read and generate. Project settings stay with its admins.'
          : 'You can also change the settings of this project in Flow Relay.',
      ));
    } else if (tenant.projects.length > 0) {
      items.push(makeInfoItem('No project selected', 'warning', 'Handoffs, insights and work items need a project.'));
    } else {
      items.push(makeInfoItem(
        'No projects yet',
        'info',
        orgCount > 0
          ? 'Create a personal project in Flow Relay or ask an organization admin to add you to a team.'
          : 'Create a project in Flow Relay to start.',
      ));
    }

    items.push(makeInfoItem(
      activeProject ? 'Switch project...' : 'Choose a project...',
      activeProject ? 'sync' : 'target',
      undefined,
      {
        command: 'flowrelay.selectProject',
        title: 'Select Project',
      },
    ));

    return items;
  }
}

// ── Handoffs Tree ────────────────────────────────────────────────────

export class HandoffsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(
    private getApi: () => FlowRelayAPI | null,
    private getWorkspaceSnapshot: () => WorkspaceSnapshot,
  ) {}

  refresh() { this._onDidChange.fire(); }

  getTreeItem(element: vscode.TreeItem) { return element; }

  async getChildren(): Promise<vscode.TreeItem[]> {
    const api = this.getApi();
    if (!api) {
      return [makeInfoItem(
        'Set API key to load handoffs',
        'key',
        undefined,
        {
          command: 'flowrelay.setApiKey',
          title: 'Set API Key',
        },
      )];
    }

    const snapshot = this.getWorkspaceSnapshot();
    if (!snapshot.tenant) {
      return [makeInfoItem('Loading workspace context...', 'sync~spin')];
    }

    const activeProject = getActiveProject(snapshot);

    if (needsProjectChoice(snapshot)) {
      return [
        makeInfoItem('Choose a project to see its handoffs', 'warning'),
        makeInfoItem(
          'Choose a project...',
          'target',
          undefined,
          {
            command: 'flowrelay.selectProject',
            title: 'Select Project',
          },
        ),
      ];
    }

    try {
      const handoffs = await api.listHandoffs('active', 10, activeProject?.id ?? null);
      if (handoffs.length === 0) {
        return [makeInfoItem(
          activeProject
            ? `No active handoffs for ${activeProject.name}`
            : 'No active handoffs',
          'info',
        )];
      }

      return handoffs.map((handoff) => {
        const sourceList = handoff.sources.map((source) => SOURCE_NAMES[source] ?? source).join(', ');
        const projectLabel = handoff.project_name ?? activeProject?.name;

        const item = new vscode.TreeItem(handoff.title, vscode.TreeItemCollapsibleState.None);
        item.description = projectLabel
          ? `${sourceList} · ${projectLabel}`
          : sourceList;
        item.iconPath = new vscode.ThemeIcon('briefcase');

        const tooltip = new vscode.MarkdownString();
        tooltip.appendMarkdown(`**${handoff.title}**\n\n`);
        if (projectLabel) {
          tooltip.appendMarkdown(`**Project:** ${projectLabel}\n\n`);
        }
        tooltip.appendMarkdown(`${handoff.summary}\n\n`);
        if (handoff.decisions.length) {
          tooltip.appendMarkdown(`**Decisions:**\n${handoff.decisions.map((d) => `- ${d}`).join('\n')}\n\n`);
        }
        if (handoff.next_steps.length) {
          tooltip.appendMarkdown(`**Next steps:**\n${handoff.next_steps.map((step) => `- ${step}`).join('\n')}`);
        }
        item.tooltip = tooltip;

        item.command = {
          command: 'flowrelay.openHandoff',
          title: 'Open Handoff',
          arguments: [handoff],
        };

        return item;
      });
    } catch (err) {
      return [makeInfoItem(`Error: ${(err as Error).message}`, 'error')];
    }
  }
}

// ── Integrations Tree ────────────────────────────────────────────────

export class IntegrationsProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(
    private getApi: () => FlowRelayAPI | null,
    private extensionUri: vscode.Uri,
    private getWorkspaceSnapshot: () => WorkspaceSnapshot,
  ) {}

  refresh() { this._onDidChange.fire(); }

  getTreeItem(element: vscode.TreeItem) { return element; }

  async getChildren(): Promise<vscode.TreeItem[]> {
    const api = this.getApi();
    if (!api) {
      return [makeInfoItem(
        'Set API key to load integrations',
        'key',
        undefined,
        {
          command: 'flowrelay.setApiKey',
          title: 'Set API Key',
        },
      )];
    }

    const snapshot = this.getWorkspaceSnapshot();
    if (!snapshot.tenant) {
      return [makeInfoItem('Loading workspace context...', 'sync~spin')];
    }

    const activeProject = getActiveProject(snapshot);

    if (needsProjectChoice(snapshot)) {
      return [
        makeInfoItem('Choose a project to see its integrations', 'warning'),
        makeInfoItem(
          'Choose a project...',
          'target',
          undefined,
          {
            command: 'flowrelay.selectProject',
            title: 'Select Project',
          },
        ),
      ];
    }

    try {
      const integrations = await api.listIntegrations(activeProject?.id ?? null);
      if (integrations.length === 0) {
        return [makeInfoItem(
          activeProject
            ? `No integrations configured for ${activeProject.name}`
            : 'No integrations connected',
          'info',
        )];
      }

      return integrations.map((integration) => {
        const label = SOURCE_NAMES[integration.source] ?? integration.source;
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);

        if ((SOURCES as readonly string[]).includes(integration.source)) {
          item.iconPath = {
            light: vscode.Uri.joinPath(this.extensionUri, 'media', 'integrations', 'light', `${sourceSlug(integration.source)}.svg`),
            dark: vscode.Uri.joinPath(this.extensionUri, 'media', 'integrations', 'dark', `${sourceSlug(integration.source)}.svg`),
          };
        } else {
          item.iconPath = new vscode.ThemeIcon('plug');
        }

        if (integration.scope === 'project') {
          const descriptionParts: string[] = [];
          if (integration.workspace_name) descriptionParts.push(integration.workspace_name);
          if (integration.connection_status) descriptionParts.push(integration.connection_status);
          if (typeof integration.providers_connected === 'number') {
            descriptionParts.push(`${integration.providers_connected} provider${integration.providers_connected === 1 ? '' : 's'}`);
          }
          item.description = descriptionParts.join(' · ');
        } else {
          item.description = integration.workspace_name ?? '';
        }

        const tooltipParts: string[] = [];
        if (integration.workspace_name) tooltipParts.push(integration.workspace_name);
        if (integration.connection_status) tooltipParts.push(`Status: ${integration.connection_status}`);
        if (integration.last_validated_at) {
          tooltipParts.push(`Validated: ${new Date(integration.last_validated_at).toLocaleString()}`);
        }
        tooltipParts.push(`Connected: ${new Date(integration.connected_at).toLocaleDateString()}`);
        item.tooltip = tooltipParts.join('\n');

        return item;
      });
    } catch (err) {
      return [makeInfoItem(`Error: ${(err as Error).message}`, 'error')];
    }
  }
}

// ── My Work Tree ─────────────────────────────────────────────────────

export const WORK_STATUS_LABEL: Record<WorkStatus, string> = {
  backlog: 'Backlog',
  todo: 'To do',
  in_progress: 'In progress',
  in_review: 'In review',
  done: 'Done',
  cancelled: 'Cancelled',
};

const WORK_STATUS_ICON: Record<WorkStatus, string> = {
  backlog: 'inbox',
  todo: 'circle-large-outline',
  in_progress: 'play-circle',
  in_review: 'eye',
  done: 'pass',
  cancelled: 'circle-slash',
};

export class WorkItemTreeItem extends vscode.TreeItem {
  constructor(readonly workItem: MyWorkItem) {
    super(`${workItem.key} ${workItem.title}`, vscode.TreeItemCollapsibleState.None);
    const when = workItem.finish ? `finish ${workItem.finish.replace('T', ' ')}` : 'no date';
    this.description = `${WORK_STATUS_LABEL[workItem.status]} · ${when} · ${workItem.project.name}`;
    this.iconPath = new vscode.ThemeIcon(workItem.blocked ? 'warning' : WORK_STATUS_ICON[workItem.status]);
    this.contextValue = 'workItem';
    this.tooltip = new vscode.MarkdownString(
      `**${workItem.key}** ${workItem.title}

` +
        `**Status:** ${WORK_STATUS_LABEL[workItem.status]}${workItem.blocked ? ' (blocked)' : ''} · **Progress:** ${workItem.percentComplete}%

` +
        `**Project:** ${workItem.project.name} (${workItem.project.timezone})`,
    );
    this.command = { command: 'flowrelay.openWorkItem', title: 'Open Work Item', arguments: [workItem] };
  }
}

export class MyWorkProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;

  constructor(private getApi: () => FlowRelayAPI | null) {}

  refresh() { this._onDidChange.fire(); }

  getTreeItem(element: vscode.TreeItem) { return element; }

  async getChildren(): Promise<vscode.TreeItem[]> {
    const api = this.getApi();
    if (!api) {
      return [makeInfoItem(
        'Set API key to load your work',
        'key',
        undefined,
        {
          command: 'flowrelay.setApiKey',
          title: 'Set API Key',
        },
      )];
    }
    try {
      const items = await api.listMyWork();
      if (items.length === 0) return [makeInfoItem('Nothing is assigned to you right now', 'check')];
      return items.map((item) => new WorkItemTreeItem(item));
    } catch (err) {
      return [makeInfoItem(`Error: ${(err as Error).message}`, 'error')];
    }
  }
}
