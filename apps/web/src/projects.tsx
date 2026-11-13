// Projet actif de la barre latérale : liste réelle (/api/projects) + choix mémorisé dans ce navigateur.
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api, errorMessage, type ProjectSummary } from "./api.js";
import { useSession } from "./session.js";

const ACTIVE_KEY = "hifrica:active-project";

interface ProjectsState {
  projects: ProjectSummary[] | null;
  error: string | null;
  active: ProjectSummary | null;
  select: (id: string) => void;
  refresh: () => Promise<void>;
}

const ProjectsContext = createContext<ProjectsState | null>(null);

function readActive(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(readActive);

  const refresh = useCallback(async () => {
    try {
      const r = await api<{ projects: ProjectSummary[] }>("/api/projects");
      setProjects(r.projects);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
      setProjects([]);
    }
  }, []);

  useEffect(() => {
    if (user) void refresh();
    else setProjects(null);
  }, [user, refresh]);

  const select = useCallback((id: string) => {
    setActiveId(id);
    try {
      localStorage.setItem(ACTIVE_KEY, id);
    } catch {
      /* préférence non mémorisée */
    }
  }, []);

  const active = projects?.find((p) => p.id === activeId) ?? projects?.[0] ?? null;

  return <ProjectsContext.Provider value={{ projects, error, active, select, refresh }}>{children}</ProjectsContext.Provider>;
}

export function useProjects(): ProjectsState {
  const ctx = useContext(ProjectsContext);
  if (!ctx) throw new Error("ProjectsProvider manquant");
  return ctx;
}
