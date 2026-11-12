// Propriétaire : Dev B
// Moteur USSD : sessions et menus des simulateurs de type ussd.
import type { FastifyInstance } from "fastify";
import type { Simulator } from "./simulators.js";

/** Déclare les routes USSD pour les simulateurs kind: ussd. */
export function registerUssd(app: FastifyInstance, simulators: Map<string, Simulator>): void {
  // TODO(B3) moteur USSD pour les simulateurs kind: ussd.
}
