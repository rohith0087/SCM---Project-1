import type { ResearchSession } from "@shared/types";

const KEY = "frontier-model-lab:sessions:v1";

export function loadSessions(): ResearchSession[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSessions(sessions: ResearchSession[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(sessions.slice(0, 30)));
  } catch (error) {
    console.warn("Could not save research sessions to localStorage", error);
  }
}
