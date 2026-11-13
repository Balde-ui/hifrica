// Propriétaire : Dev B
// Moteur USSD : une requête HTTP par saisie de l'utilisateur, une session par appel.
//
// Contrat de la route POST /:simulator/ussd :
//   Requête  : { sessionId?: string, text?: string }  — sessionId absent/inconnu = nouvel appel ;
//              text = saisie de l'utilisateur pour le menu actuellement affiché (vide au premier appel).
//   Réponse  : { sessionId: string, text: string, end: boolean }
//
// Comme pour les simulateurs HTTP, une clé sk_test_ est exigée : chaque appel doit être rattaché à un
// projet (journal, isolation), même si le schéma YAML ne déclare pas `auth` pour les simulateurs USSD.
import { randomUUID } from "node:crypto";
import type { UssdEndEvent, UssdInputEvent, UssdScreenEvent } from "@hifrica/shared";
import type { FastifyInstance } from "fastify";
import { authenticate } from "./auth.js";
import type { HifricaRequestContext } from "./context.js";
import { publishEvent } from "./events.js";
import type { Simulator, UssdMenu } from "./simulators.js";
import { runCommand } from "./valkey.js";

/** Au-delà, une session abandonnée expire dans Valkey (comportement réel d'un appel USSD raccroché). */
const USSD_SESSION_TTL_SEC = 180;
/** Limite réelle d'un écran/d'une saisie USSD (contrainte du schéma YAML partagé, appliquée ici aussi
 * côté saisie utilisateur et côté texte rendu, qu'un gabarit peut faire dépasser). */
const USSD_MAX_LENGTH = 182;

interface UssdSessionState {
  projectId: string;
  simulator: string;
  menu: string;
  vars: Record<string, string>;
}

function sessionKey(sessionId: string): string {
  return `ussd-session:${sessionId}`;
}

/** Remplace {{var}} par la valeur stockée ; vide si absente. Jamais de retour au prototype ({{constructor}} etc.). */
function renderVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, name: string) =>
    Object.hasOwn(vars, name) ? vars[name] : "",
  );
}

/** Menu suivant : correspondance exacte dans `on`, sinon `next`, sinon on redemande le même menu. */
function resolveNextMenuKey(current: UssdMenu, currentKey: string, input: string): string {
  if (current.on && Object.hasOwn(current.on, input)) return current.on[input];
  if (current.next) return current.next;
  return currentKey;
}

export function registerUssd(app: FastifyInstance, simulators: Map<string, Simulator>): void {
  app.post<{ Params: { simulator: string }; Body: { sessionId?: string; text?: string } }>(
    "/:simulator/ussd",
    async (req, reply) => {
      const sim = simulators.get(req.params.simulator);
      if (!sim || sim.kind !== "ussd" || !sim.menus?.start) {
        return reply.code(404).send({ error: "simulator_not_found" });
      }

      const auth = await authenticate(req);
      if (!auth.ok) return reply.code(401).send({ error: "invalid_test_key" });
      const { projectId } = auth;

      // Visible dans la console (C4) : même mécanisme que les simulateurs HTTP, channel: "ussd".
      const hifrica: HifricaRequestContext = { simulator: sim.name, channel: "ussd", projectId };
      if (auth.apiKeyId !== undefined) hifrica.apiKeyId = auth.apiKeyId;
      req.hifrica = hifrica;

      const requestedSessionId = req.body?.sessionId;
      const text = typeof req.body?.text === "string" ? req.body.text : "";
      // Limite réelle d'un réseau USSD : une saisie plus longue n'existerait jamais en pratique.
      if (text.length > USSD_MAX_LENGTH) return reply.code(400).send({ error: "input_too_long" });

      let state: UssdSessionState | undefined;
      let sessionId = typeof requestedSessionId === "string" && requestedSessionId !== "" ? requestedSessionId : randomUUID();

      if (typeof requestedSessionId === "string" && requestedSessionId !== "") {
        try {
          const raw = await runCommand((c) => c.get(sessionKey(sessionId)));
          if (raw !== null) state = JSON.parse(raw) as UssdSessionState;
        } catch (err) {
          req.log.error({ err }, "lecture de la session USSD impossible");
          return reply.code(503).send({ error: "stream_unavailable" });
        }
        // Session inconnue, expirée, ou d'un autre projet : traitée comme un nouvel appel sous un id neuf.
        if (!state || state.projectId !== projectId) {
          state = undefined;
          sessionId = randomUUID();
        }
      }

      const now = new Date().toISOString();
      let menuKey: string;
      let vars: Record<string, string>;

      if (!state) {
        menuKey = "start";
        vars = {};
      } else {
        const currentMenu = sim.menus[state.menu];
        // Un menu "end" ne doit plus recevoir de saisie : la session est considérée terminée.
        if (!currentMenu || currentMenu.end) return reply.code(404).send({ error: "session_not_found" });

        vars = { ...state.vars };
        if (!currentMenu.sensitive) {
          const inputEvent: UssdInputEvent = { type: "ussd.input", sessionId, projectId, input: text, createdAt: now };
          await publishEvent(inputEvent, req.log).catch((err: unknown) =>
            req.log.error({ err }, "publishEvent (ussd.input) a échoué"),
          );
          if (currentMenu.input) vars[currentMenu.input] = text;
        }
        // Saisie sensible (ex. PIN) : jamais journalisée, jamais stockée dans les variables — seulement
        // utilisée ci-dessous pour déterminer le menu suivant (ex. "0000" -> succès, sinon -> échec).
        menuKey = resolveNextMenuKey(currentMenu, state.menu, text);
      }

      hifrica.endpointId = menuKey; // pas d'« endpoint » en USSD : le menu identifie l'échange dans la console.

      const menu = sim.menus[menuKey];
      if (!menu) {
        req.log.warn({ simulator: sim.name, menuKey }, "menu USSD introuvable dans le YAML, session terminée");
        return reply.code(200).send({ sessionId, text: "Erreur du simulateur.", end: true });
      }

      const ended = menu.end === true;
      try {
        if (ended) {
          await runCommand((c) => c.del(sessionKey(sessionId)));
        } else {
          const newState: UssdSessionState = { projectId, simulator: sim.name, menu: menuKey, vars };
          await runCommand((c) => c.set(sessionKey(sessionId), JSON.stringify(newState), "EX", USSD_SESSION_TTL_SEC));
        }
      } catch (err) {
        req.log.error({ err }, "écriture de la session USSD impossible");
        return reply.code(503).send({ error: "stream_unavailable" });
      }

      // Le YAML (≤ 182 c.) et la saisie (vérifiée plus haut) sont bornés, mais leur combinaison par un
      // gabarit {{var}} pourrait dépasser la limite réelle d'un écran USSD : on tronque par sécurité.
      const renderedText = renderVars(menu.text, vars).slice(0, USSD_MAX_LENGTH);
      const screenEvent: UssdScreenEvent = { type: "ussd.screen", sessionId, projectId, text: renderedText, end: ended, createdAt: now };
      await publishEvent(screenEvent, req.log).catch((err: unknown) => req.log.error({ err }, "publishEvent (ussd.screen) a échoué"));

      if (ended) {
        const endEvent: UssdEndEvent = { type: "ussd.end", sessionId, projectId, reason: "completed", createdAt: now };
        await publishEvent(endEvent, req.log).catch((err: unknown) => req.log.error({ err }, "publishEvent (ussd.end) a échoué"));
      }

      return reply.code(200).send({ sessionId, text: renderedText, end: ended });
    },
  );
}
