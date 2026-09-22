/**
 * @license
 * Flow Relay VS Code Extension API Client
 * Copyright (c) 2026 Adriano Sorbello (atrisorb) <https://github.com/atrisorb>
 * Licensed under GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)
 */

import * as https from 'https';
import * as http from 'http';

export type AccountType = 'personal' | 'business';
export type AccessRole = 'owner' | 'admin' | 'member';

export interface TenantOrganization {
  id: string;
  name: string;
  slug: string;
  role: 'admin' | 'member';
  is_temporary_admin: boolean;
}

export interface TenantProject {
  id: string;
  name: string;
  slug: string;
  description: string;
  organization_id: string | null;
  organization_name: string | null;
  organization_slug: string | null;
  project_type: 'personal' | 'organization';
  access_role: AccessRole;
  created_at: string;
  updated_at: string;
}

export interface TenantContext {
  account_type: AccountType;
  organizations: TenantOrganization[];
  projects: TenantProject[];
}

export interface Handoff {
  id: string;
  user_id: string;
  project_id: string | null;
  project_name?: string | null;
  scope_type?: 'personal' | 'project';
  title: string;
  summary: string;
  status: string;
  sources: string[];
  key_changes?: string[];
  decisions: string[];
  open_questions: string[];
  next_steps: string[];
  created_at: string;
  updated_at: string;
  /** Canonical Markdown rendered server-side – identical to the dashboard copy button. */
  markdown?: string;
}

export interface Integration {
  source: string;
  workspace_id: string | null;
  workspace_name: string | null;
  connected_at: string;
  scope?: 'personal' | 'project';
  resource_type?: string | null;
  connection_status?: string | null;
  providers_connected?: number;
  last_validated_at?: string | null;
}

export interface ContextEvent {
  id: string;
  user_id?: string;
  source: string;
  event_type: string;
  title: string;
  content: string;
  created_at: string;
}

export type AiJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface AiJob {
  id: string;
  project_id: string;
  kind: string;
  status: AiJobStatus;
  result_kind: 'handoff' | 'insight' | null;
  result_id: string | null;
  error: string | null;
  error_code: string | null;
  error_meta: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Digest {
  id: string;
  periodStart: string;
  periodEnd: string;
  markdown: string;
  createdAt: string;
}

export interface Insight {
  id: string;
  project_id: string;
  requested_by: string;
  kind: 'onboarding_brief' | 'cross_source_correlation' | 'architecture_insight' | 'release_notes';
  title: string;
  summary: string;
  data: Record<string, unknown>;
  model_used: string;
  token_usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  status: string;
  related_event_ids: string[];
  created_at: string;
  updated_at?: string;
  /** Canonical Markdown rendered server-side – identical to the dashboard copy button. */
  markdown?: string;
}

export interface UntrackedResource {
  source: string;
  resource_id: string;
  resource_name: string;
  resource_type: string;
}

export interface SourceFilter {
  projects?: string[];
  eventTypes?: string[];
  branches?: string[];
  priorities?: string[];
}

export interface AvailableSourceFilter {
  projects: { id: string; label: string }[];
  eventTypes: { value: string; label: string }[];
  branches?: { value: string; label: string }[];
  branchesByProject?: Record<string, { value: string; label: string }[]>;
  defaultBranchByProject?: Record<string, string>;
  priorities: { value: string; label: string }[];
}

export type AvailableFilters = Record<string, AvailableSourceFilter>;

export interface FigmaGateInfo {
  selectable: boolean;
  region: string;
  scope: string;
  canManageResidency: boolean;
  residencyHref: string | null;
}

export type GenerateInsightResponse = {
  jobId: string;
  status: AiJobStatus;
};

export type GenerateHandoffResponse = {
  jobId: string;
  status: AiJobStatus;
};

export class FlowRelayAPI {
  constructor(
    private apiKey: string,
    private baseUrl: string,
  ) {}

  private request<T>(method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
    return new Promise((resolve, reject) => {
      const url = new URL(`/api/v1${path}`, this.baseUrl);
      const isHttps = url.protocol === 'https:';
      const mod = isHttps ? https : http;

      const payload = body ? JSON.stringify(body) : undefined;

      const req = mod.request(
        url,
        {
          method,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
            ...(payload ? { 'Content-Length': Buffer.byteLength(payload).toString() } : {}),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => {
            const status = res.statusCode ?? 0;
            if (!data.trim()) {
              if (status >= 400) {
                reject(new Error(`API error ${status}`));
              } else {
                resolve({ status, data: {} as T });
              }
              return;
            }

            try {
              const json = JSON.parse(data);
              if (status >= 400) {
                reject(new Error(json.error ?? `API error ${status}`));
              } else {
                resolve({ status, data: json as T });
              }
            } catch {
              reject(new Error(`Invalid JSON response: ${data.slice(0, 200)}`));
            }
          });
        },
      );

      req.on('error', reject);
      req.setTimeout(30_000, () => {
        req.destroy(new Error('Request timeout'));
      });
      if (payload) req.write(payload);
      req.end();
    });
  }

  async listProjects(): Promise<TenantContext> {
    const res = await this.request<TenantContext>('GET', '/projects');
    return res.data;
  }

  async listHandoffs(status = 'active', limit = 10, projectId?: string | null): Promise<Handoff[]> {
    const params = new URLSearchParams();
    params.set('status', status);
    params.set('limit', String(limit));
    if (projectId) params.set('project_id', projectId);

    const res = await this.request<{ handoffs: Handoff[] }>(
      'GET',
      `/handoffs?${params.toString()}`,
    );
    return res.data.handoffs;
  }

  async generateHandoff(
    sources: string[] | undefined,
    filters: Record<string, SourceFilter> | undefined,
    projectId: string,
  ): Promise<GenerateHandoffResponse> {
    const body: Record<string, unknown> = {};
    if (sources?.length) body.sources = sources;
    if (filters && Object.keys(filters).length > 0) body.filters = filters;
    body.project_id = projectId;

    const res = await this.request<GenerateHandoffResponse>(
      'POST',
      '/handoffs',
      body,
    );
    return res.data;
  }

  async listIntegrations(projectId?: string | null): Promise<Integration[]> {
    const params = new URLSearchParams();
    if (projectId) params.set('project_id', projectId);
    const suffix = params.toString();

    const res = await this.request<{ integrations: Integration[] }>(
      'GET',
      `/integrations${suffix ? `?${suffix}` : ''}`,
    );
    return res.data.integrations;
  }

  async getHandoffFilters(
    projectId: string,
  ): Promise<{ filters: AvailableFilters; figma: FigmaGateInfo | null }> {
    const res = await this.request<{ filters: AvailableFilters; figma?: FigmaGateInfo }>(
      'GET',
      `/handoffs/filters?project_id=${encodeURIComponent(projectId)}`,
    );
    return { filters: res.data.filters ?? {}, figma: res.data.figma ?? null };
  }

  async listEvents(source?: string, limit = 20, projectId?: string | null): Promise<ContextEvent[]> {
    const params = new URLSearchParams();
    if (source) params.set('source', source);
    params.set('limit', String(limit));
    if (projectId) params.set('project_id', projectId);
    const res = await this.request<{ events: ContextEvent[] }>('GET', `/events?${params}`);
    return res.data.events;
  }

  async getJob(jobId: string): Promise<{ job: AiJob; result: Handoff | Insight | null }> {
    const res = await this.request<{ job: AiJob; result: Handoff | Insight | null }>('GET', `/jobs/${jobId}`);
    return res.data;
  }

  async waitForJob(
    jobId: string,
    opts: { intervalMs?: number; timeoutMs?: number } = {},
  ): Promise<{ job: AiJob; result: Handoff | Insight | null }> {
    const intervalMs = opts.intervalMs ?? 2500;
    const timeoutMs = opts.timeoutMs ?? 180_000; // 3 min hard cap
    const deadline = Date.now() + timeoutMs;

    while (true) {
      const res = await this.getJob(jobId);
      if (res.job.status === 'completed' || res.job.status === 'failed') {
        return res;
      }
      if (Date.now() > deadline) {
        throw new Error(`AI Job timed out after ${Math.round(timeoutMs / 1000)}s (job ${jobId} still ${res.job.status}).`);
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  }

  async listInsights(projectId: string, kind?: string, status = 'active', limit = 20): Promise<Insight[]> {
    const params = new URLSearchParams();
    if (kind) params.set('kind', kind);
    params.set('status', status);
    params.set('limit', String(limit));
    const res = await this.request<{ insights: Insight[] }>('GET', `/projects/${projectId}/insights?${params.toString()}`);
    return res.data.insights;
  }

  async askProject(projectId: string, question: string): Promise<{ answer: string; citations: string[] }> {
    const res = await this.request<{ answer: string; citations: string[] }>(
      'POST',
      `/projects/${projectId}/qa`,
      { question },
    );
    return res.data;
  }

  async listDigests(projectId: string, limit = 10): Promise<Digest[]> {
    const res = await this.request<{ digests: Digest[] }>(
      'GET',
      `/projects/${projectId}/digests?limit=${limit}`,
    );
    return res.data.digests;
  }

  async generateInsight(
    projectId: string,
    kind: 'correlation' | 'onboarding' | 'architecture' | 'release_notes',
    body?: Record<string, unknown>,
  ): Promise<GenerateInsightResponse> {
    const res = await this.request<GenerateInsightResponse>('POST', `/projects/${projectId}/insights/${kind}`, body);
    return res.data;
  }

  async discordListChannels(): Promise<Array<{ id: string; name: string; topic: string }>> {
    const res = await this.request<{
      channels: Array<{ id: string; name: string; topic: string }>;
    }>('GET', '/discord/channels');
    return res.data.channels;
  }

  async discordSendMessage(
    channelId: string,
    payload: {
      content?: string;
      handoff_id?: string;
      insight_id?: string;
      artifact?:
        | 'last_handoff'
        | 'last_correlation'
        | 'last_onboarding'
        | 'last_architecture'
        | 'last_release_notes';
      project_id?: string;
    },
  ): Promise<{ ok: boolean; message_id: string }> {
    const res = await this.request<{ ok: boolean; message_id: string }>('POST', '/discord/send', {
      channel_id: channelId,
      ...payload,
    });
    return res.data;
  }

  async listUntrackedResources(): Promise<UntrackedResource[]> {
    const res = await this.request<UntrackedResource[]>('GET', '/integrations/untracked');
    return res.data;
  }
}
