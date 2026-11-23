/**
 * @license
 * Flow Relay Ask turn runner
 * Copyright (c) 2026 Adriano Sorbello (atrisorb) <https://github.com/atrisorb>
 * Licensed under GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)
 */

import type { AskCitationRef, AskEvent, AskTier, AskTierChoice } from './ask-stream';

export interface AskStreamApi {
  askStream(
    projectId: string,
    question: string,
    options: { tier?: AskTierChoice; threadId?: string | null; signal?: AbortSignal },
    onEvent: (event: AskEvent) => void,
  ): Promise<void>;
}

export interface AskTurnResult {
  status: 'completed' | 'failed' | 'cancelled' | 'aborted';
  threadId: string | null;
  tier: AskTier | null;
  content: string;
  citations: AskCitationRef[];
  error: { code: string; message: string; retryable: boolean } | null;
}

export async function runAskTurn(
  api: AskStreamApi,
  input: { projectId: string; question: string; tier: AskTierChoice; threadId: string | null; signal: AbortSignal },
  onEvent: (event: AskEvent) => void,
): Promise<AskTurnResult> {
  const result: AskTurnResult = {
    status: 'failed',
    threadId: input.threadId,
    tier: null,
    content: '',
    citations: [],
    error: null,
  };
  let streamed = '';
  let ended = false;
  const handle = (event: AskEvent) => {
    if (event.type === 'turn.start') {
      result.threadId = event.threadId;
      result.tier = event.tier;
    } else if (event.type === 'text.delta') {
      streamed += event.text;
    } else if (event.type === 'turn.end') {
      ended = true;
      result.status = event.status;
      result.content = event.content || streamed;
      result.citations = event.citations;
    } else if (event.type === 'error') {
      ended = true;
      result.status = 'failed';
      result.error = { code: event.errorCode, message: event.error, retryable: event.retryable };
    }
    onEvent(event);
  };
  try {
    await api.askStream(
      input.projectId,
      input.question,
      { tier: input.tier, threadId: input.threadId, signal: input.signal },
      handle,
    );
  } catch (err) {
    result.status = 'failed';
    result.error = { code: 'transport', message: (err as Error).message, retryable: true };
    return result;
  }
  if (input.signal.aborted) {
    result.status = 'aborted';
    if (!result.content) result.content = streamed;
    return result;
  }
  if (!ended) {
    result.status = 'failed';
    result.content = streamed;
    result.error = {
      code: 'interrupted',
      message: 'The connection to Flow Relay closed before the answer finished. Ask again to retry.',
      retryable: true,
    };
  }
  return result;
}

export interface WebProject {
  id: string;
  slug: string;
  project_type: 'personal' | 'organization';
  organization_slug: string | null;
}

export function projectWebUrl(project: WebProject, baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  if (project.project_type === 'organization' && project.organization_slug) {
    return `${base}/business/organizations/${project.organization_slug}/projects/${project.slug}`;
  }
  return `${base}/projects/${project.id}`;
}
