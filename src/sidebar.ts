/**
 * @license
 * Flow Relay Sidebar Tree Providers
 * Copyright (c) 2026 Adriano Sorbello (atrisorb) <https://github.com/atrisorb>
 * Licensed under GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)
 */

import * as vscode from 'vscode';
import { FlowRelayAPI, TenantContext, TenantProject } from './api';
import { SOURCES, SOURCE_NAMES, sourceSlug } from './filter-data';

export interface WorkspaceSnapshot {
  tenant: TenantContext | null;
  activeProjectId: string | null;
}

function getActiveProject(snapshot: WorkspaceSnapshot): TenantProject | null {
  if (!snapshot.tenant || !snapshot.activeProjectId) return null;
  return snapshot.tenant.projects.find((project) => project.id === snapshot.activeProjectId) ?? null;
}

function isBusinessWorkspace(snapshot: WorkspaceSnapshot): boolean {
  if (!snapshot.tenant) return false;
  return snapshot.tenant.account_type === 'business' || snapshot.tenant.organizations.length > 0;
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

  // Head crop, not the full mascot: a tree icon renders at 16px and the artwork
  // is a 24x29 grid, so the single-cell eyes fall below one device pixel and
  // vanish. The 15x15 head+antenna window puts them back above 1px while
  // keeping the silhouette – cropping tighter to the face plate reads as an
  // anonymous square instead of the mascot.
  private mascotIcon() {
    return {
      light: vscode.Uri.joinPath(this.extensionUri, 'media', 'mascotte-icon.svg'),
      dark: vscode.Uri.joinPath(this.extensionUri, 'media', 'mascotte-icon-dark-theme.svg'),
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
    const businessWorkspace = isBusinessWorkspace(snapshot);
    const items: vscode.TreeItem[] = [];

    const header = new vscode.TreeItem('Flow Relay', vscode.TreeItemCollapsibleState.None);
    header.description = businessWorkspace ? 'Business account' : 'Personal account';
    header.tooltip = 'Account type detected from your Flow Relay tenant context.';
    header.iconPath = this.mascotIcon();
    items.push(header);

    items.push(makeInfoItem(
      `Projects available: ${tenant.projects.length}`,
      'layers',
      'Projects you can access with your current API key.',
    ));

    if (activeProject) {
      const scopeLabel = activeProject.project_type === 'organization'
        ? 'Organization project'
        : 'Personal project';

      items.push(makeInfoItem(`Scope: ${scopeLabel}`, 'symbol-class'));
      items.push(makeInfoItem(`Project: ${activeProject.name}`, 'folder'));

      if (activeProject.project_type === 'organization') {
        items.push(makeInfoItem(
          `Organization: ${activeProject.organization_name ?? 'Unknown'}`,
          'organization',
        ));
      }

      const roleLabel = activeProject.access_role === 'owner'
        ? 'Owner'
        : activeProject.access_role === 'admin'
          ? 'Admin'
          : 'Member';

      items.push(makeInfoItem(`Role: ${roleLabel}`, 'shield'));

      if (activeProject.access_role === 'owner' || activeProject.access_role === 'admin') {
        items.push(makeInfoItem('Mode: Admin controls enabled', 'unlock', 'You can run privileged project operations in dashboard APIs.'));
      } else {
        items.push(makeInfoItem('Mode: Member access', 'lock', 'Project scope is active with member permissions.'));
      }
    } else if (businessWorkspace && tenant.projects.length > 0) {
      items.push(makeInfoItem('Scope: No project selected', 'warning'));
      items.push(makeInfoItem(
        'Select project context...',
        'target',
        'Choose personal or organization project scope for this workspace.',
        {
          command: 'flowrelay.selectProject',
          title: 'Select Project',
        },
      ));
    } else {
      items.push(makeInfoItem('Scope: No project selected', 'person'));

      if (businessWorkspace && tenant.projects.length === 0) {
        items.push(makeInfoItem('No accessible projects found', 'info', 'You are in business mode but no project is currently assigned.'));
      }
    }

    items.push(makeInfoItem(
      'Change project context...',
      'sync',
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
        'Set API key first. Open the command palette and run Flow Relay: Set API Key',
        'key',
      )];
    }

    const snapshot = this.getWorkspaceSnapshot();
    if (!snapshot.tenant) {
      return [makeInfoItem('Loading workspace context...', 'sync~spin')];
    }

    const activeProject = getActiveProject(snapshot);
    const businessWorkspace = isBusinessWorkspace(snapshot);

    if (businessWorkspace && snapshot.tenant.projects.length > 0 && !activeProject) {
      return [
        makeInfoItem('No project selected (business workspace)', 'warning'),
        makeInfoItem(
          'Select project context...',
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
          ? `${sourceList} • ${projectLabel}`
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
      return [makeInfoItem('Set API key to load integrations', 'key')];
    }

    const snapshot = this.getWorkspaceSnapshot();
    if (!snapshot.tenant) {
      return [makeInfoItem('Loading workspace context...', 'sync~spin')];
    }

    const activeProject = getActiveProject(snapshot);
    const businessWorkspace = isBusinessWorkspace(snapshot);

    if (businessWorkspace && snapshot.tenant.projects.length > 0 && !activeProject) {
      return [
        makeInfoItem('Select a project to view scoped integrations', 'warning'),
        makeInfoItem(
          'Select project context...',
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
          item.description = descriptionParts.join(' • ');
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


