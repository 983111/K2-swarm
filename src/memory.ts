import type { Session, Message, AgentResult } from "./types";

// ─── In-memory store ──────────────────────────────────────────────────────────
// Cloudflare Workers are stateless across requests, but within a single
// streaming request the store holds the whole conversation in RAM.
// For true persistence across requests, swap this for Cloudflare KV / D1.

const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const store = new Map<string, Session>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function now(): number {
  return Date.now();
}

function evictExpired(): void {
  const cutoff = now() - SESSION_TTL_MS;
  for (const [id, session] of store.entries()) {
    if (session.lastActiveAt < cutoff) {
      store.delete(id);
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function createSession(id?: string): Session {
  evictExpired();
  const session: Session = {
    id: id ?? crypto.randomUUID(),
    history: [],
    agentResults: [],
    createdAt: now(),
    lastActiveAt: now(),
  };
  store.set(session.id, session);
  return session;
}

export function getSession(id: string): Session | undefined {
  const session = store.get(id);
  if (session) {
    session.lastActiveAt = now();
  }
  return session;
}

export function getOrCreateSession(id: string): Session {
  return getSession(id) ?? createSession(id);
}

export function addMessage(sessionId: string, message: Message): void {
  const session = getOrCreateSession(sessionId);
  session.history.push(message);
  session.lastActiveAt = now();
}

export function addAgentResult(sessionId: string, result: AgentResult): void {
  const session = getOrCreateSession(sessionId);
  session.agentResults.push(result);
  session.lastActiveAt = now();
}

export function getHistory(sessionId: string): Message[] {
  return getOrCreateSession(sessionId).history;
}

export function getAgentResults(sessionId: string): AgentResult[] {
  return getOrCreateSession(sessionId).agentResults;
}

export function clearSession(sessionId: string): void {
  store.delete(sessionId);
}

export function sessionCount(): number {
  evictExpired();
  return store.size;
}
