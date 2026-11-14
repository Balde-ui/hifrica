// Propriétaire : Dev C (C2)
// Comptes : Better Auth (email + mot de passe, GitHub si configuré) monté sur /api/auth/*,
// et contrôle d'accès des routes de la plateforme.
//
// Signatures requireUser / assertProjectOwner identiques au bouchon de B (feat/b1-sse-route) :
// le flux SSE peut les utiliser tel quel.
import { and, eq } from "drizzle-orm";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { fromNodeHeaders } from "better-auth/node";
import type { FastifyBaseLogger, FastifyInstance, FastifyRequest } from "fastify";
import * as dbModule from "@hifrica/db";
import { AUTH_USE_PLURAL, authSchemaOptions, projects, type Database } from "@hifrica/db";

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
}

type Env = Record<string, string | undefined>;

export function createAuth(db: Database, env: Env, log: FastifyBaseLogger) {
  const baseURL = env.BETTER_AUTH_URL as string;
  const github =
    env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
      ? { github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: env.GITHUB_CLIENT_SECRET } }
      : {};
  return betterAuth({
    ...authSchemaOptions,
    advanced: { ...authSchemaOptions.advanced, useSecureCookies: baseURL.startsWith("https://") },
    database: drizzleAdapter(db, { provider: "pg", usePlural: AUTH_USE_PLURAL, schema: dbModule }),
    basePath: "/api/auth",
    baseURL,
    secret: env.BETTER_AUTH_SECRET as string,
    trustedOrigins: [new URL(baseURL).origin],
    emailAndPassword: { enabled: true, minPasswordLength: 8, maxPasswordLength: 128, autoSignIn: true },
    socialProviders: github,
    telemetry: { enabled: false },
    // Journal : uniquement le message de Better Auth, jamais ses arguments (une erreur Drizzle y
    // transporterait les paramètres SQL : email, empreinte de mot de passe, jeton de session).
    logger: {
      level: "warn",
      log: (level, message) => {
        if (level === "error") log.error({ source: "better-auth" }, message);
        else log.warn({ source: "better-auth" }, message);
      },
    },
  });
}

export type Auth = ReturnType<typeof createAuth>;

let current: { auth: Auth; db: Database } | undefined;

/** Active l'authentification (appelé au démarrage, une fois la base migrée). */
export function setAuthContext(auth: Auth, db: Database): void {
  current = { auth, db };
}

export function isAuthConfigured(): boolean {
  return current !== undefined;
}

/** Utilisateur de la session, ou null (pas de session, session expirée, auth non configurée). */
export async function requireUser(req: FastifyRequest): Promise<AuthenticatedUser | null> {
  if (!current) return null;
  const session = await current.auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session) return null;
  return { id: session.user.id, email: session.user.email, name: session.user.name };
}

/** true si `user` possède `projectId`. Faux pour un id mal formé (aucune requête SQL). */
export async function assertProjectOwner(user: AuthenticatedUser, projectId: string): Promise<boolean> {
  if (!current || !dbModule.isUuid(projectId)) return false;
  const rows = await dbModule.safeDbCall("get_project_for_owner", () =>
    current!.db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.ownerId, user.id)))
      .limit(1),
  );
  return rows.length === 1;
}

/** Longueur maximale du nom affiché : la même que le formulaire d'inscription (maxLength 80). */
export const NAME_MAX_LENGTH = 80;

export type NameCheck = { ok: true } | { ok: false; code: "NAME_REQUIRED" | "NAME_TOO_LONG"; message: string };

/**
 * Nom affiché : chaîne de 1 à 80 caractères une fois les espaces de bord retirés. Compté en caractères
 * Unicode, donc jamais plus strict que le maxLength du formulaire (qui compte des unités UTF-16).
 */
export function checkDisplayName(value: unknown): NameCheck {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: false, code: "NAME_REQUIRED", message: "Nom requis." };
  }
  if ([...value.trim()].length > NAME_MAX_LENGTH) {
    return { ok: false, code: "NAME_TOO_LONG", message: `Nom trop long (${NAME_MAX_LENGTH} caractères au plus).` };
  }
  return { ok: true };
}

/** Routes de Better Auth qui reçoivent un nom saisi par l'utilisateur (obligatoire à l'inscription). */
const NAME_ROUTES: Record<string, "required" | "optional"> = {
  "/api/auth/sign-up/email": "required",
  "/api/auth/update-user": "optional",
};

/** Monte le gestionnaire Better Auth sur /api/auth/* (Fastify a déjà lu et analysé le corps). */
export function registerAuthRoutes(app: FastifyInstance, auth: Auth, baseURL: string): void {
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    async handler(req, reply) {
      const url = new URL(req.url, baseURL);
      // Limite du nom appliquée côté serveur, avant Better Auth (dont la configuration reste inchangée).
      // Réponse au même format que ses erreurs : { code, message }.
      const nameRule = req.method === "POST" ? NAME_ROUTES[url.pathname] : undefined;
      if (nameRule) {
        const body = typeof req.body === "object" && req.body !== null ? (req.body as Record<string, unknown>) : undefined;
        if (nameRule === "required" || (body !== undefined && "name" in body)) {
          const check = checkDisplayName(body?.name);
          if (!check.ok) return reply.code(400).send({ code: check.code, message: check.message });
        }
      }
      const hasBody = req.method !== "GET" && req.body !== undefined && req.body !== null;
      const response = await auth.handler(
        new Request(url, {
          method: req.method,
          headers: fromNodeHeaders(req.headers),
          body: hasBody ? JSON.stringify(req.body) : undefined,
        }),
      );
      reply.status(response.status);
      response.headers.forEach((value, key) => {
        if (key !== "set-cookie") reply.header(key, value);
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) reply.header("set-cookie", cookies);
      return reply.send(response.body ? await response.text() : null);
    },
  });
}
