/**
 * @license
 * Flow Relay Ask thread store
 * Copyright (c) 2026 Adriano Sorbello (atrisorb) <https://github.com/atrisorb>
 * Licensed under GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later)
 */

import type { AskCitationRef } from './ask-stream';

export interface StoredTurn {
  question: string;
  answer: string;
  citations: AskCitationRef[];
  tier: string | null;
  at: string;
}

export interface StoredThread {
  id: string;
  projectId: string;
  title: string;
  updatedAt: string;
  turns: StoredTurn[];
}

export interface MementoLike {
  get<T>(key: string, defaultValue: T): T;
  update(key: string, value: unknown): PromiseLike<void>;
}

const STORE_KEY = 'flowrelay.askThreads';
export const MAX_THREADS = 40;
export const MAX_TURNS = 30;
export const MAX_ANSWER = 30_000;

export class AskStore {
  constructor(private readonly memento: MementoLike) {}

  private all(): StoredThread[] {
    return this.memento.get<StoredThread[]>(STORE_KEY, []);
  }

  list(projectId: string): StoredThread[] {
    return this.all()
      .filter((t) => t.projectId === projectId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(id: string): StoredThread | undefined {
    return this.all().find((t) => t.id === id);
  }

  async record(projectId: string, threadId: string, turn: StoredTurn): Promise<void> {
    const threads = this.all();
    const kept: StoredTurn = { ...turn, answer: turn.answer.slice(0, MAX_ANSWER) };
    const existing = threads.find((t) => t.id === threadId && t.projectId === projectId);
    if (existing) {
      existing.turns = [...existing.turns, kept].slice(-MAX_TURNS);
      existing.updatedAt = turn.at;
    } else {
      threads.push({
        id: threadId,
        projectId,
        title: turn.question.replace(/\s+/g, ' ').trim().slice(0, 80),
        updatedAt: turn.at,
        turns: [kept],
      });
    }
    const trimmed = threads.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, MAX_THREADS);
    await this.memento.update(STORE_KEY, trimmed);
  }

  async remove(id: string): Promise<void> {
    await this.memento.update(
      STORE_KEY,
      this.all().filter((t) => t.id !== id),
    );
  }
}
