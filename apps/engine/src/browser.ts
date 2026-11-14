// Propriétaire : Dev A
// sim.<domaine> sert des programmes. Un humain qui l'ouvre dans un navigateur est renvoyé vers le
// catalogue de l'application, au lieu de tomber sur du JSON ou un 404.
//
// Règle « navigateur » : GET, Accept contenant text/html, et AUCUN en-tête Authorization. Une application
// cliente envoie toujours sa clé : elle n'est jamais redirigée. Ces redirections ont lieu avant
// authenticate et ne remplissent pas request.hifrica : rien n'est écrit dans request_logs.
import type { FastifyReply, FastifyRequest } from "fastify";

type Env = Record<string, string | undefined>;

/** APP_PUBLIC_URL, sinon https://$APP_DOMAIN, sinon http://localhost:5173 (sans « / » final). */
export function appPublicUrl(env: Env = process.env): string {
  const explicit = env.APP_PUBLIC_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const domain = env.APP_DOMAIN?.trim();
  if (domain) return `https://${domain.replace(/\/+$/, "")}`;
  return "http://localhost:5173";
}

export function isBrowserRequest(req: FastifyRequest): boolean {
  if (req.method !== "GET") return false;
  if (req.headers.authorization !== undefined) return false;
  const accept = req.headers.accept;
  return typeof accept === "string" && accept.toLowerCase().includes("text/html");
}

/** 302, sans mise en cache par un intermédiaire qui ignorerait la règle navigateur / programme. */
export function redirectBrowser(reply: FastifyReply, location: string): FastifyReply {
  return reply.header("Vary", "Accept, Authorization").header("Cache-Control", "no-store").redirect(location, 302);
}

/** Fiche du simulateur dans le catalogue s'il existe, sinon le catalogue. */
export function catalogueUrl(appUrl: string, simulator?: string): string {
  return simulator ? `${appUrl}/catalogue/${encodeURIComponent(simulator)}` : `${appUrl}/catalogue`;
}

/** Réponse de GET / pour un programme (curl, client HTTP) : où trouver le catalogue et comment appeler. */
export function homeDocument(appUrl: string) {
  return {
    service: "Hifrica — simulateurs",
    catalogue: catalogueUrl(appUrl),
    docs: `${appUrl}/`,
    usage: "POST /<simulateur>/<chemin> avec Authorization: Bearer sk_test_...",
  };
}
