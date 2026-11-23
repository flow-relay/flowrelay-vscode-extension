/**
 * @license
 * Flow Relay MCP server definition provider
 * Copyright (c) 2026 Adriano Sorbello (atrisorb) <https://github.com/atrisorb>
 * Licensed under GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)
 */

import type { McpDefinitionLike, McpProviderLike } from './vscode-compat';

export const MCP_PROVIDER_ID = 'flowrelay.mcp';
export const MCP_LABEL = 'Flow Relay';

export function mcpUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/mcp`;
}

interface HttpDefinitionLike extends McpDefinitionLike {
  headers: Record<string, string>;
}

export interface McpHostLike {
  Uri: { parse(value: string): unknown };
  McpHttpServerDefinition?: new (label: string, uri: unknown, headers?: Record<string, string>, version?: string) => HttpDefinitionLike;
}

export function hasMcpDefinitions(host: McpHostLike): boolean {
  return typeof host.McpHttpServerDefinition === 'function';
}

export function createMcpProvider(
  host: McpHostLike,
  deps: {
    baseUrl(): string;
    version: string;
    getKey(): Promise<string | undefined>;
    askForKey(): Promise<string | undefined>;
  },
): McpProviderLike {
  const Definition = host.McpHttpServerDefinition;
  return {
    provideMcpServerDefinitions() {
      if (!Definition) return [];
      return [new Definition(MCP_LABEL, host.Uri.parse(mcpUrl(deps.baseUrl())), {}, deps.version)];
    },
    async resolveMcpServerDefinition(server) {
      const key = (await deps.getKey()) ?? (await deps.askForKey());
      if (!key) return undefined;
      (server as HttpDefinitionLike).headers = { Authorization: `Bearer ${key}` };
      return server;
    },
  };
}
