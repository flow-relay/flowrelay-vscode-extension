/**
 * @license
 * Flow Relay VS Code host API shims
 * Copyright (c) 2026 Adriano Sorbello (atrisorb) <https://github.com/atrisorb>
 * Licensed under GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)
 */

export interface DisposableLike {
  dispose(): unknown;
}

export interface CancellationTokenLike {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): DisposableLike;
}

export interface CommandLike {
  command: string;
  title: string;
  arguments?: unknown[];
}

export interface ChatResponseStreamLike {
  markdown(value: string): void;
  progress(value: string): void;
  reference(value: unknown): void;
  button(command: CommandLike): void;
}

export interface ChatRequestLike {
  readonly prompt: string;
  readonly command?: string;
}

export interface ChatHistoryTurnLike {
  readonly participant?: string;
  readonly result?: { readonly metadata?: Record<string, unknown> };
}

export interface ChatContextLike {
  readonly history: readonly ChatHistoryTurnLike[];
}

export interface ChatResultLike {
  metadata?: Record<string, unknown>;
  errorDetails?: { message: string };
}

export interface ChatFollowupLike {
  prompt: string;
  label?: string;
  command?: string;
}

export interface ChatParticipantLike extends DisposableLike {
  iconPath?: unknown;
  followupProvider?: {
    provideFollowups(result: ChatResultLike, context: unknown, token: CancellationTokenLike): ChatFollowupLike[];
  };
}

export type ChatRequestHandlerLike = (
  request: ChatRequestLike,
  context: ChatContextLike,
  stream: ChatResponseStreamLike,
  token: CancellationTokenLike,
) => Promise<ChatResultLike | void>;

export interface ChatApiLike {
  createChatParticipant(id: string, handler: ChatRequestHandlerLike): ChatParticipantLike;
}

export interface McpDefinitionLike {
  label: string;
}

export interface McpProviderLike {
  onDidChangeMcpServerDefinitions?: unknown;
  provideMcpServerDefinitions(token: CancellationTokenLike): McpDefinitionLike[] | Promise<McpDefinitionLike[]>;
  resolveMcpServerDefinition?(server: McpDefinitionLike, token: CancellationTokenLike): McpDefinitionLike | undefined | Promise<McpDefinitionLike | undefined>;
}

export interface LmApiLike {
  registerMcpServerDefinitionProvider(id: string, provider: McpProviderLike): DisposableLike;
}

export function chatApiOf(host: unknown): ChatApiLike | null {
  const chat = (host as { chat?: Partial<ChatApiLike> }).chat;
  return chat && typeof chat.createChatParticipant === 'function' ? (chat as ChatApiLike) : null;
}

export function lmApiOf(host: unknown): LmApiLike | null {
  const lm = (host as { lm?: Partial<LmApiLike> }).lm;
  return lm && typeof lm.registerMcpServerDefinitionProvider === 'function' ? (lm as LmApiLike) : null;
}
