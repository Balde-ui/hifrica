// Simulateurs publiés que le moteur peut exécuter (contrat Dev A / Dev C).
// Le moteur sert d'abord les fichiers de simulators/ ; à défaut, il lit ici la version courante d'un
// simulateur publié depuis l'éditeur, puis la revalide avec le schéma partagé avant de l'exécuter.
import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "./client.js";
import { safeDbCall } from "./errors.js";
import { SIMULATOR_KINDS, SIMULATOR_STATUSES, simulators, simulatorVersions } from "./schema/simulators.js";
import { isSlug } from "./validate.js";

/** Statuts exécutables : tout ce qui est publié. `unpublished` (dépublié) ne répond plus. */
export const EXECUTABLE_SIMULATOR_STATUSES = ["draft", "to_verify", "verified"] as const satisfies readonly (typeof SIMULATOR_STATUSES)[number][];
export type ExecutableSimulatorStatus = (typeof EXECUTABLE_SIMULATOR_STATUSES)[number];

const EXECUTABLE_SET: ReadonlySet<string> = new Set(EXECUTABLE_SIMULATOR_STATUSES);

export function isExecutableStatus(status: string): boolean {
  return EXECUTABLE_SET.has(status);
}

export interface ExecutableSimulator {
  slug: string;
  kind: (typeof SIMULATOR_KINDS)[number];
  status: ExecutableSimulatorStatus;
  /** Version courante (is_current = true). */
  version: string;
  yaml: string;
}

/**
 * Version courante d'un simulateur publié exécutable, ou null (inconnu, dépublié, sans version courante).
 * Slug invalide → null sans requête SQL. Erreur de base → DbOperationError ("get_executable_simulator").
 */
export async function getExecutableSimulator(db: Database, slug: string): Promise<ExecutableSimulator | null> {
  if (!isSlug(slug)) return null;
  const [row] = await safeDbCall("get_executable_simulator", () =>
    db
      .select({
        slug: simulators.slug,
        kind: simulators.kind,
        status: simulators.status,
        version: simulatorVersions.version,
        yaml: simulatorVersions.yaml,
      })
      .from(simulators)
      .innerJoin(simulatorVersions, and(eq(simulatorVersions.simulatorId, simulators.id), eq(simulatorVersions.isCurrent, true)))
      .where(and(eq(simulators.slug, slug), inArray(simulators.status, [...EXECUTABLE_SIMULATOR_STATUSES])))
      .limit(1),
  );
  if (!row || !isExecutableStatus(row.status)) return null;
  return { ...row, status: row.status as ExecutableSimulatorStatus };
}
