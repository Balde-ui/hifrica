// Propriétaire : Dev A
// Destination d'un webhook, lue AU MOMENT DE L'ENVOI (dans le Worker) : une modification dans « Paramètres »
// s'applique aux envois suivants, y compris aux relances d'un envoi déjà programmé.
//   - avec une base : projects.webhook_url et le secret du projet, déchiffré avec WEBHOOK_SECRET_KEYS ;
//   - sans base, hors production uniquement : bouchons WEBHOOK_TEST_URL et WEBHOOK_SIGNING_SECRET (dev local).
// Le secret n'est jamais logué.
import { decryptWebhookSecret, isUuid, projects, safeDbCall, type Database, type WebhookSecretKeyring } from "@hifrica/db";
import { eq } from "drizzle-orm";
import type { WebhookLogger } from "./deliver.js";

export type WebhookTarget =
  | { ok: true; url: string; secret: string }
  | { ok: false; outcome: "no_url" | "no_secret"; host: string | null };

export interface ProjectWebhookRow {
  webhookUrl: string | null;
  webhookSecretEnc: string;
}

type Env = Record<string, string | undefined>;

export interface TargetResolverOptions {
  getDb: () => Database | null;
  keyring: WebhookSecretKeyring | null;
  env: Env;
  log: WebhookLogger;
  /** Lecture du projet (remplaçable dans les tests). Lève si la base est injoignable : l'envoi sera relancé. */
  loadProject?: (db: Database, projectId: string) => Promise<ProjectWebhookRow | null>;
}

async function loadProjectFromDb(db: Database, projectId: string): Promise<ProjectWebhookRow | null> {
  const [row] = await safeDbCall("get_webhook_target", () =>
    db
      .select({ webhookUrl: projects.webhookUrl, webhookSecretEnc: projects.webhookSecretEnc })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1),
  );
  return row ?? null;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

/** Résout l'URL et le secret d'un projet. Lève seulement si la base est injoignable (erreur passagère). */
export function createTargetResolver(opts: TargetResolverOptions): (projectId: string) => Promise<WebhookTarget> {
  const { env, log } = opts;
  const loadProject = opts.loadProject ?? loadProjectFromDb;
  const production = env.NODE_ENV === "production";

  return async (projectId) => {
    const db = opts.getDb();
    if (!db) {
      // Bouchons de développement : jamais en production.
      if (production) return { ok: false, outcome: "no_url", host: null };
      const url = env.WEBHOOK_TEST_URL || undefined;
      const secret = env.WEBHOOK_SIGNING_SECRET || undefined;
      if (!url) return { ok: false, outcome: "no_url", host: null };
      if (!secret) return { ok: false, outcome: "no_secret", host: hostOf(url) };
      return { ok: true, url, secret };
    }

    if (!isUuid(projectId)) return { ok: false, outcome: "no_url", host: null };
    const row = await loadProject(db, projectId);
    if (!row?.webhookUrl) return { ok: false, outcome: "no_url", host: null };
    const host = hostOf(row.webhookUrl);
    if (!opts.keyring) {
      log.error({ projectId }, "WEBHOOK_SECRET_KEYS absente ou invalide : secret du projet indéchiffrable, webhook non envoyé");
      return { ok: false, outcome: "no_secret", host };
    }
    try {
      return { ok: true, url: row.webhookUrl, secret: decryptWebhookSecret(row.webhookSecretEnc, projectId, opts.keyring) };
    } catch (err) {
      // Les messages de WebhookSecretError ne contiennent ni clé ni secret.
      log.error({ projectId, reason: err instanceof Error ? err.message : "error" }, "secret du projet indéchiffrable, webhook non envoyé");
      return { ok: false, outcome: "no_secret", host };
    }
  };
}
