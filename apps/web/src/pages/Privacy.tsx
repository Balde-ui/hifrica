// Propriétaire : Dev C — page publique « Confidentialité et mentions légales » (/confidentialite).
// Chaque affirmation renvoie au code (voir les commentaires) ; rien n'est annoncé qui ne soit en place.
import type { ReactNode } from "react";
import { PageHead } from "../shell.js";

/** Adresse officielle de contact de l'équipe Hifrica. */
const CONTACT = "contact@hifrica.site";
const REPO = "https://github.com/Balde-ui/hifrica";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel" style={{ marginBottom: "1rem" }}>
      <div className="panel-head">
        <h2>{title}</h2>
      </div>
      <div className="panel-body stack" style={{ lineHeight: 1.65 }}>
        {children}
      </div>
    </section>
  );
}

export function PrivacyPage() {
  return (
    <div style={{ maxWidth: 860 }}>
      <PageHead
        title="Confidentialité et mentions légales"
        description="Ce que Hifrica enregistre, pourquoi, et où. Hifrica est un simulateur : aucune transaction réelle, aucune donnée bancaire."
      />

      <Section title="Mentions légales">
        <p>
          <strong>Éditeur</strong> : l'équipe Hifrica, projet présenté au concours CADEV 2026.
        </p>
        <p>
          <strong>Contact</strong> :{" "}
          <a href={`mailto:${CONTACT}`} data-testid="privacy-contact">
            {CONTACT}
          </a>
        </p>
        <p>
          {/* README, section Architecture */}
          <strong>Hébergement</strong> : serveur cloud Systalink Datacloud, région de Madrid (Espagne).
        </p>
        <p>
          {/* LICENSE ; README, Conformité CADEV 2026 */}
          <strong>Propriété</strong> : le code de Hifrica est protégé, tous droits réservés (
          <a href={`${REPO}/blob/main/LICENSE`} target="_blank" rel="noreferrer">
            licence du code
          </a>
          ). Les simulateurs publiés par les utilisateurs sont partagés sous licence CC BY 4.0.
        </p>
      </Section>

      <Section title="Données de votre compte">
        <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
          {/* packages/db/src/schema/auth.ts (users, accounts, sessions) */}
          <li>Nom, adresse email et mot de passe. Le mot de passe est géré par la bibliothèque d'authentification Better Auth et n'est jamais stocké en clair.</li>
          <li>
            Session : un cookie de session (HttpOnly) vous garde connecté jusqu'à 7 jours. La base enregistre, pour chaque session, l'adresse IP et le
            navigateur (user-agent) utilisés.
          </li>
        </ul>
      </Section>

      <Section title="Données de vos projets">
        <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
          {/* api-keys : empreinte SHA-256 ; projects : secret chiffré (packages/db) */}
          <li>Clés de test : seule leur empreinte est enregistrée ; la clé complète ne s'affiche qu'une fois.</li>
          <li>Secret de signature des webhooks : chiffré en base (AES-256-GCM), avec des clés de chiffrement gardées hors de la base.</li>
          <li>URL de webhook, nom du projet, scénario actif.</li>
          <li>
            {/* apps/engine/src/logs.ts */}
            Journal des requêtes (console) : méthode, chemin, statut, durée, simulateur, scénario, type et taille du contenu. Ni le corps des requêtes et
            des réponses, ni l'en-tête Authorization, ni la query ne sont enregistrés.
          </li>
          <li>Historique des webhooks : date, événement, tentative, résultat, code HTTP, durée et hôte de destination (jamais l'URL complète ni le corps).</li>
          <li>Simulateurs publiés : publics dans le catalogue, avec leur YAML.</li>
        </ul>
      </Section>

      <Section title="Données temporaires">
        <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
          {/* packages/shared/src/sessions.ts ; apps/engine/src/ussd.ts ; apps/api/src/demo-webhooks.ts */}
          <li>Demande de paiement en attente sur le téléphone simulé : 10 minutes.</li>
          <li>Session USSD : 3 minutes.</li>
          <li>Confirmation de paiement reçue par la boutique de démonstration : 24 heures.</li>
          <li>Le code PIN saisi sur le téléphone simulé n'est jamais envoyé au serveur.</li>
        </ul>
      </Section>

      <Section title="Assistant IA">
        <p>
          {/* AI_USAGE.md ; apps/api/src/ai/ */}
          La description que vous saisissez dans « Générer avec l'IA » est envoyée à un fournisseur d'IA (DeepSeek, ou Gemini en secours) après un masquage{" "}
          <strong>partiel</strong> des emails, numéros, clés et codes. N'y saisissez ni donnée personnelle ni secret. L'assistant est réservé aux comptes
          connectés ; votre adresse IP et votre compte servent à appliquer les quotas de générations. Le détail est dans{" "}
          <a href={`${REPO}/blob/main/AI_USAGE.md`} target="_blank" rel="noreferrer">
            AI_USAGE.md
          </a>
          .
        </p>
      </Section>

      <Section title="Stockage dans votre navigateur">
        <ul style={{ margin: 0, paddingLeft: "1.2rem" }}>
          {/* apps/web/src : clés hifrica:* */}
          <li>Stockage local : projet actif, affichage de la barre latérale, brouillon de l'éditeur YAML.</li>
          <li>Stockage de session : les clés de test créées pendant la session, effacées à la fermeture de l'onglet.</li>
          <li>Aucun cookie publicitaire, aucun outil de mesure d'audience ; les polices sont servies par Hifrica.</li>
        </ul>
      </Section>

      <Section title="Durée de conservation et vos droits">
        <p>
          Les données de votre compte et de vos projets sont conservées tant que le compte existe. Une purge automatique du journal des requêtes n'est
          pas encore en place.
        </p>
        <p>
          Il n'y a pas encore de suppression de compte en libre-service : pour consulter, corriger ou supprimer vos données, écrivez à{" "}
          <a href={`mailto:${CONTACT}`} data-testid="privacy-contact-rights">
            {CONTACT}
          </a>
          .
        </p>
      </Section>
    </div>
  );
}
