# Hifrica — C0 : contrats base de données (A, B)

*Mis à jour le 12 novembre 2026 · Dev C · PR #2 (`feat/c0-database-design`).*

**Sources :** réponses **écrites** sur la PR #2 :
- **A** (`Balde-ui`, 12 nov. 20:11 UTC : contrats A-1 à A-6, C-6, AB-1, AB-2 ; **12 nov. 21:51 UTC : validation explicite de C-1 à C-5, des tables Better Auth et du report de `scenarios`**) ;
- **B** (`izayid-04`, 12 nov. 21:44 UTC).

La fusion reste soumise à une **approbation formelle** (revue GitHub) de A et B.

**États :**
- **Validé (docs)** : cahier des charges ou chronologie.
- **Validé A** / **Validé B** : accord écrit sur la PR #2.
- **Interne à C** : sans effet sur le travail de A ou B.
- **Reporté** : décidé, mais traité dans une tâche ultérieure, **hors C1**.
- **Ouvert** : à clarifier.

---

## 1. Périmètre de C1 (D1) et tables

**D1 — Validé B :** C1 couvre les **8 tables métier du lot 1** ; `ratings` et `ai_calls` viendront à la demande de A. Concrètement :
- **6 tables métier dans C1 :** `projects`, `api_keys`, `simulators`, `simulator_versions`, `project_simulators`, `request_logs` ;
- **`webhook_deliveries`** est créée **par A dans sa PR A5** (A-5, validé A) ;
- **`scenarios`** est **reportée** : les scénarios sont lus dans le YAML (validé A et B).

S'y ajoutent les **4 tables Better Auth** (`users`, `sessions`, `accounts`, `verifications`), générées par le CLI Better Auth 1.7.22 (validées par A et B). Soit **10 tables** dans C1.

| Table | Rôle | Écrite par | Lue par |
|---|---|---|---|
| `users`, `sessions`, `accounts`, `verifications` | Comptes (email + GitHub) | Better Auth (C) | C ; A et B via la session |
| `projects` | Projet, propriétaire, `webhook_url`, `webhook_secret_enc` (chiffré) | C | **A (A5)** |
| `api_keys` | Clés `sk_test_` : empreinte SHA-256 seulement | C | moteur (`auth.ts`, C3) |
| `simulators`, `simulator_versions` | Catalogue + YAML figé par version (une seule version courante) | C (C5), **A (A6 : brouillons IA)** | moteur |
| `project_simulators` | Simulateurs d'un projet et scénario actif de chacun | C (création automatique, D5b) | moteur |
| `request_logs` | Journal des appels HTTP et des échanges USSD/SMS | moteur via `apps/engine/src/logs.ts` (C) ; échanges USSD/SMS (B, via `insertRequestLog`) | console (C) |
| *(hors C1)* `webhook_deliveries` | Une ligne par tentative de webhook | **A (PR A5)** | console (C) |

**Migrations de C1 :**
- `0000_init` (générée) ;
- `0001_users_role_check` (`--custom`) ;
- **`0002_request_logs_session_id`** (D14, additive).

## 2. Décisions validées

| # | Décision | État |
|---|---|---|
| V1 | PostgreSQL 16 + Drizzle + Better Auth ; clés hachées, montrées une fois, révocables ; journaux purgés à 7 jours ; YAML ≤ 64 Ko ; CC BY 4.0 ; base créée au déploiement ; `auth.ts` du moteur appartient à C ; `packages/shared` modifié seulement par une PR relue par les deux autres | **Validé (docs)** |
| C-1 | Identifiants `uuid` partout ; tables Better Auth au pluriel ; colonnes en `snake_case` | **Validé A et B** (A : 12 nov. 21:51 UTC) |
| C-2 | Schéma Better Auth **100 % généré** ; `role` (`input: false`, `CHECK` en migration custom), `country` ; unicité `(provider_id, account_id)` des comptes OAuth | **Validé A et B** (A : 12 nov. 21:51 UTC) |
| C-3 | Dates Better Auth en `timestamp`, sessions PostgreSQL en UTC ; tables métier en `timestamptz` | **Validé A et B** (A : 12 nov. 21:51 UTC) |
| C-4 | Pas de plugin `username` pour le MVP ; le login GitHub n'est jamais recopié | **Validé A et B** (A : 12 nov. 21:51 UTC) |
| C-5 | Clé `sk_test_` + 43 caractères base62 (256 bits), empreinte SHA-256, `prefix`/`last4`, révocation par `revoked_at` | **Validé A et B** (A : 12 nov. 21:51 UTC) |
| C-6 | Suppressions : cascade utilisateur → projets → clés, journaux, scénarios actifs ; simulateurs conservés (`owner_id` à NULL, forks conservés) ; simulateur publié jamais supprimé (passage à `unpublished`) | **Validé A** |
| A-1 | Secret de webhook **par projet**, AES-256-GCM, format `v1:<iv>.<chiffré+tag>`, AAD = identifiant du projet, clés dans `WEBHOOK_SECRET_KEYS` (jamais en base). **A déchiffre** avec `decryptWebhookSecret(enc, projectId, loadWebhookSecretKeyring())`, en passant l'identifiant tel que renvoyé par la base | **Validé A** |
| A-2 | Retrait de `WEBHOOK_SIGNING_SECRET` (global) après la fusion de A5 | **Validé A** |
| A-3 | `request_id` = uuid v4 généré par le moteur (A0), en-tête `X-Hifrica-Request-Id`, colonne unique de `request_logs` | **Validé A** |
| A-4 | `request_logs` : `outcome` distinct de `status` (code réellement envoyé, sinon NULL) + `error_code`. **Les crochets Fastify (`onRequest`, `onError`, `onResponse`, `onRequestAbort`) sont dans `apps/engine/src/logs.ts` (C), via `registerRequestLogging(app)`** ; `index.ts` (A) se contente de l'appeler. C les implémente en **C4** | **Validé A (modifié)** |
| A-5 | `webhook_deliveries` : une ligne par tentative, `delivery_id` = identifiant du job BullMQ, `outcome` ∈ {`success`, `http_error`, `network_error`, `timeout`, `blocked`}, `status_code` seulement si une réponse HTTP existe ; **4 tentatives** (1 envoi + 3 relances). **Table créée par A dans sa PR A5** sur `packages/db`, relue par C ; C1 n'attend pas | **Validé A** |
| A-6 | Plusieurs simulateurs par projet (`project_simulators`, `active_scenario_key` NULL = nominal). **L'en-tête `X-Hifrica-Scenario` reste accepté en production** comme surcharge ponctuelle ; le scénario actif en base reste la valeur par défaut. Priorité : en-tête > base > nominal | **Validé A (modifié)** |
| AB-1 | Tout le schéma et les requêtes dans `packages/db` (C) ; une table de A ou B = une PR sur `packages/db` relue par C | **Validé A** |
| AB-2 | Migrations : rebase sur `main` avant `pnpm db:generate` ; jamais modifier une migration fusionnée ; SQL non générable dans une migration `--custom` ; `check-migration-journal.mjs origin/main`. **A5 devra générer sa migration après `0002`** | **Validé A** |
| D5b | `project_simulators` créée **automatiquement au premier scénario choisi**, sans étape d'activation | **Validé B** (implémentation : C3) |
| **D14** | **`request_logs.session_id`** : `text`, **nullable**, index composite `(project_id, session_id)`. Valeur = `sessionId` des événements (`ussd.screen`, `ussd.input`, `ussd.end`, `payment.pending`) ; NULL pour un SMS isolé ou une requête HTTP sans session. **Pas de contrainte de longueur** (non validée). **Implémenté dans C1 (migration `0002`)** | **Validé B** |

## 3. Choix internes à C

- Organisation de `packages/db` (`schema/`, `crypto/`, `scripts/`, tests `node:test`).
- Migrations sur une connexion `pg.Client` dédiée qui tient le verrou consultatif.
- Sessions en UTC.
- `request_logs.id` en BIGINT transmis en chaîne (`toApiId` / `parseApiId`).
- **Pas de contrainte SQL anti-PIN** : elle ne couvre pas les champs génériques, et le message d'erreur de PostgreSQL recopie la ligne rejetée. La protection se fait dans le code (§4).

## 4. Reporté hors C1

| # | Sujet | Contenu | Où et qui |
|---|---|---|---|
| **D22** | Événement `log.created` | Contrat **confirmé par B** : `{ id, v: 1, type: "log.created", projectId, createdAt, logId: string, requestId, simulator, channel, method, path, status: number \| null, outcome, durationMs, source, sessionId?: string }`. Résumé sans corps de requête ni de réponse, et **jamais de PIN** | **`packages/shared/src/events.ts`** : PR dédiée, relue par A et B (règle 3). Production par C (C4), consommation par B (SSE, B1). **Hors C1** |
| **PIN** | `sensitive?: boolean` sur les menus USSD | Proposé par B : champ facultatif dans `ussdMenu` (`packages/shared/src/schema.ts`), posé par l'auteur du simulateur sur l'étape qui collecte un PIN. **Aucune colonne requise dans C1** | PR `packages/shared` (B, relue par A et C), **à faire avant B3 et C4** |

**Exigences liées au PIN** (applicables à B3, C4, A1 et B1) :
1. **Aucun PIN en clair** dans aucun journal : `request_logs`, journaux applicatifs, console, `log.created`, webhooks. Cela vaut aussi quand le PIN arrive dans un **champ générique** (`input` d'un échange USSD).
2. **Aucune saisie sensible diffusée en clair dans les événements.** L'événement `ussd.input` (`input: string`, obligatoire) ne doit pas transporter la valeur d'un menu `sensitive` : le contrat est **à définir avec B**.
3. **Aucune réutilisation d'une saisie sensible dans les gabarits USSD** (`{{input.…}}`), ni dans le chemin journalisé (code USSD de base seulement).
4. **Corps HTTP non enregistrés par défaut** dans `request_logs` (métadonnées seulement). Seuls des éléments explicitement autorisés et nettoyés peuvent l'être.

## 5. Questions encore ouvertes

| # | Question | À qui |
|---|---|---|
| Q2 | `sessionId?` dans `HifricaRequestContext` (`apps/engine/src/context.ts`, fichier de A) pour que C4 renseigne `session_id` | A |
| Q3 | `requestId?: string` dans les événements (convenu entre A et B sur la PR #4, pas encore ajouté) | B |
| Q4 | `log.created` porte `id` et `v`, alors que `BaseEvent` ne les a pas : à aligner. Qui écrit la PR `shared` de `log.created` ? | B, C |
| Q5 | Contrat de `ussd.input` pour un menu `sensitive` (exigence 2 du §4) | B |
| Q6 | Prompt de l'assistant IA : poser `sensitive: true` sur les étapes de PIN | A |

## 6. Ce que chaque tâche obtient dès la fusion de C1

| Tâche | Fourni par `@hifrica/db` |
|---|---|
| **A5** | `projects.webhookUrl`, `projects.webhookSecretEnc`, `decryptWebhookSecret`, `loadWebhookSecretKeyring` (le moteur ajoute `@hifrica/db` à ses dépendances et `COPY packages/db` dans son Dockerfile) |
| **C2** | Tables Better Auth + `authSchemaOptions`, `projects`, `apiKeys`, `generateApiKey`, `generateWebhookSecret`, `encryptWebhookSecret` |
| **C4** | `requestLogs` (avec `sessionId`), `toApiId` / `parseApiId` |
| **C5** | `simulators`, `simulatorVersions`, `projectSimulators` |
