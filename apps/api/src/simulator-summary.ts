// Propriétaire : Dev C (C5 catalogue)
// Résumé d'un simulateur renvoyé par le catalogue (GET /api/simulators et /api/simulators/:slug).
// `executable` reprend exactement les conditions du moteur (#28 : apps/engine/src/catalog.ts et
// getExecutableSimulator dans packages/db) : statut exécutable, publié, version courante, YAML valide
// selon le schéma partagé et `name` égal au slug. Les autres champs sont inchangés.
import { isExecutableStatus } from "@hifrica/db";
import { validateSimulatorYaml } from "@hifrica/shared";

export interface SimulatorSummary {
  slug: string;
  kind: "http" | "ussd";
  description: string | null;
  origin: "manual" | "ai";
  status: string;
  version: string | null;
  endpoints: { id: string; method: string; path: string }[];
  scenarios: string[];
  menus: number;
  code: string | null;
  publishedAt: Date | null;
  forkedFrom: string | null;
  /** Le moteur exécute ce simulateur (sim.hifrica.site/<slug>/…) avec une clé de test. */
  executable: boolean;
}

export interface SimulatorRow {
  slug: string;
  kind: "http" | "ussd";
  description: string | null;
  origin: "manual" | "ai";
  status: string;
  publishedAt: Date | null;
  /** Version courante (is_current), null s'il n'y en a pas. */
  version: string | null;
  /** YAML de la version courante. */
  yaml: string | null;
  forkedFrom?: string | null;
}

export function summarize(row: SimulatorRow): SimulatorSummary {
  const parsed = row.yaml ? validateSimulatorYaml(row.yaml) : null;
  const sim = (parsed?.valid ? parsed.simulator : {}) as {
    name?: string;
    endpoints?: { id: string; method: string; path: string }[];
    scenarios?: Record<string, unknown>;
    menus?: Record<string, unknown>;
    code?: string;
  };
  const executable =
    isExecutableStatus(row.status) &&
    row.publishedAt !== null &&
    row.version !== null &&
    parsed?.valid === true &&
    sim.name === row.slug;
  return {
    slug: row.slug,
    kind: row.kind,
    description: row.description,
    origin: row.origin,
    status: row.status,
    version: row.version,
    endpoints: (sim.endpoints ?? []).map((e) => ({ id: e.id, method: e.method, path: e.path })),
    scenarios: Object.keys(sim.scenarios ?? {}),
    menus: Object.keys(sim.menus ?? {}).length,
    code: sim.code ?? null,
    publishedAt: row.publishedAt,
    forkedFrom: row.forkedFrom ?? null,
    executable,
  };
}
