/**
 * Session manager — tracks conversation sessions.
 * Mirrors opencan-daemon/internal/daemon/session_manager.go.
 */

import type { SessionInfo } from '../types.js';

let nextSessionId = 1;

export class SessionManager {
  private sessions = new Map<string, SessionInfo>();

  create(command: string, cwd: string = process.cwd()): string {
    const sessionId = `session-${nextSessionId++}-${Date.now().toString(36)}`;
    const now = Date.now();

    const session: SessionInfo = {
      sessionId,
      agentId: '',
      status: 'idle',
      cwd,
      command,
      createdAt: now,
      updatedAt: now,
    };

    this.sessions.set(sessionId, session);
    return sessionId;
  }

  upsert(session: SessionInfo): void {
    const existing = this.sessions.get(session.sessionId);
    this.sessions.set(session.sessionId, {
      ...existing,
      ...session,
      createdAt: existing?.createdAt ?? session.createdAt,
      updatedAt: Date.now(),
    });
  }

  get(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  update(sessionId: string, updates: Partial<SessionInfo>): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    Object.assign(session, updates, { updatedAt: Date.now() });
    return true;
  }

  remove(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  list(): SessionInfo[] {
    return Array.from(this.sessions.values())
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  filterByCwd(cwd: string): SessionInfo[] {
    return this.list().filter((s) => s.cwd === cwd);
  }

  get size(): number {
    return this.sessions.size;
  }

  clear(): void {
    this.sessions.clear();
  }
}
