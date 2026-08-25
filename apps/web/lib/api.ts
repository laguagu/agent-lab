/** The orchestrator's REST surface. WebSockets are handled in runner-client. */

const BASE = process.env.NEXT_PUBLIC_ORCHESTRATOR_HTTP ?? "http://localhost:8080";

export type SessionSummary = {
  id: string;
  title: string;
  state: "starting" | "ready" | "stopped" | "error";
  createdAt: number;
  model: string;
  repoUrl?: string;
  skillCount: number;
  totalCostUsd: number;
};

export type SkillSummary = { name: string; description: string };

export async function listSessions(): Promise<SessionSummary[]> {
  const r = await fetch(`${BASE}/api/sessions`, { cache: "no-store" });
  if (!r.ok) return [];
  return (await r.json()).sessions ?? [];
}

export async function listSkills(): Promise<SkillSummary[]> {
  const r = await fetch(`${BASE}/api/skills`, { cache: "no-store" });
  if (!r.ok) return [];
  return (await r.json()).skills ?? [];
}

export async function createSession(body: Record<string, unknown> = {}) {
  const r = await fetch(`${BASE}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(json.error ?? "session creation failed");
  return json as { sessionId: string };
}

export async function deleteSession(id: string, purge = false) {
  await fetch(`${BASE}/api/sessions/${id}${purge ? "?purge=1" : ""}`, {
    method: "DELETE",
  });
}

export async function health(): Promise<{
  status: string;
  docker: boolean;
  gateway: boolean;
} | null> {
  try {
    const r = await fetch(`${BASE}/health`, { cache: "no-store" });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}
