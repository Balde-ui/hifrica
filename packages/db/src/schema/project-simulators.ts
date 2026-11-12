import { sql } from "drizzle-orm";
import { check, index, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { projects } from "./projects.js";
import { simulators } from "./simulators.js";
import { timestamps } from "./columns.js";

/**
 * Simulateurs utilisés par un projet et scénario actif de chacun.
 * active_scenario_key : NULL = scénario nominal ; sinon 1 à 60 caractères, sans espaces autour ('' refusé).
 * L'existence de la clé dans le YAML courant est vérifiée par l'API ; le moteur retombe sur le nominal sinon.
 */
export const projectSimulators = pgTable(
  "project_simulators",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    simulatorId: uuid("simulator_id")
      .notNull()
      .references(() => simulators.id, { onDelete: "cascade" }),
    activeScenarioKey: text("active_scenario_key"),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ name: "project_simulators_pk", columns: [t.projectId, t.simulatorId] }),
    index("project_simulators_simulator_id_idx").on(t.simulatorId),
    check(
      "project_simulators_active_scenario_key_chk",
      sql`${t.activeScenarioKey} IS NULL OR (char_length(${t.activeScenarioKey}) BETWEEN 1 AND 60 AND ${t.activeScenarioKey} = btrim(${t.activeScenarioKey}))`,
    ),
  ],
);
