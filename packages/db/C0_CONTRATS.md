# Hifrica — C0 : contrats base de données à valider (A, B)

*12 novembre 2026 · Dev C · Contrats de la base de données à valider par A et B (PR draft C0/C1, branche `feat/c0-database-design`).*

**Ce qu'on vous demande :** répondre « OK » ou « changement : … » sur chaque ligne marquée **À VALIDER**. Tant que le code n'est pas fusionné, toute modification reste gratuite : les migrations sont simplement régénérées.

**États possibles :**
- **Validé** : écrit dans le cahier des charges ou la chronologie.
- **Décidé par C** : interne à C, déjà implémenté.
- **À VALIDER** : touche le travail de A ou B.

## 1. Tables (10)

| Table | Rôle | Écrite par | Lue par |
|---|---|---|---|
| `users`, `sessions`, `accounts`, `verifications` | Comptes Better Auth (email + GitHub), **générées** par le CLI Better Auth 1.7.22 | Better Auth (C) | C ; A et B via la session |
| `projects` | Projet, propriétaire, `webhook_url`, `webhook_secret_enc` (chiffré) | C | **A (A5)** |
| `api_keys` | Clés `sk_test_` : empreinte SHA-256 seulement | C | moteur (`auth.ts`, C3) |
| `simulators`, `simulator_versions` | Catalogue + YAML figé par version (une seule version courante) | C (C5), A (A6 : brouillons IA) | moteur |
| `project_simulators` | Simulateurs d'un projet et scénario actif de chacun | C | moteur |
| `request_logs` | Journal des appels aux simulateurs | moteur (crochets de A + module de C) | console (C) |

Par rapport à la liste de la chronologie (users, projects, api_keys, simulators, scenarios, webhook_url, request_logs) :
- `webhook_url` est une **colonne** de `projects`, pas une table ;
- `scenarios` est **reportée**, car on la lit directement dans le YAML (décidé par C) ;
- les tables ajoutées sont imposées par Better Auth ou nécessaires au multi-simulateur.

**Pas encore créée :** `webhook_deliveries` (voir A4 ci-dessous).

## 2. Décisions

| # | Proposition | Justification | Concerne | État |
|---|---|---|---|---|
| V1 | PostgreSQL 16 + Drizzle + Better Auth ; clés hachées et montrées une fois ; journaux purgés à 7 jours ; YAML ≤ 64 Ko ; simulateurs publiés sous CC BY 4.0 ; base créée automatiquement au déploiement | Cahier, chronologie | Tous | **Validé** |
| C-1 | Identifiants `uuid` partout ; tables Better Auth au pluriel ; colonnes en `snake_case` (sortie native du générateur) | Clés étrangères homogènes ; pas de mot réservé `user` | C (A et B ne touchent pas `users`) | Décidé par C |
| C-2 | Schéma Better Auth **100 % généré**. Ajouts par options : `role` (`input: false`), `country` ; unicité `(provider_id, account_id)` par un plugin ; `CHECK role` dans une migration manuelle | Reproductible ; rien ne se perd à la régénération | C | Décidé par C |
| C-3 | Dates Better Auth en `timestamp` (générateur), sessions PostgreSQL forcées en UTC ; tables métier en `timestamptz` | Drizzle lit et écrit en UTC ; seul `now()` dépendait du fuseau | C | Décidé par C |
| C-4 | Pas de plugin `username` pour le MVP. Le login GitHub n'est **jamais** recopié dans `username` | Un `-`, plus de 30 caractères ou un pseudonyme déjà pris bloqueraient la connexion GitHub | C | Décidé par C |
| C-5 | Clé d'API `sk_test_` + 43 caractères base62 (256 bits), empreinte SHA-256, `prefix` et `last4` pour l'affichage, révocation par `revoked_at` | Cahier ; recherche du moteur par index unique | C (C2, C3) | Décidé par C |
| C-6 | Suppression d'un utilisateur ou d'un projet : cascade (clés, journaux, scénarios actifs). Simulateurs : `owner_id` mis à NULL, forks conservés. Un simulateur publié n'est pas supprimé mais passe à `unpublished` (règle applicative) | Données minimales ; contenus CC BY préservés | C ; A et B doivent gérer un projet disparu (404) | **À VALIDER** (A, B) |
| **A-1** | `webhook_secret` **par projet**, stocké chiffré AES-256-GCM. Format `v1:<iv>.<chiffré+tag>`, AAD = identifiant du projet, clés dans `WEBHOOK_SECRET_KEYS` (jamais en base). **A déchiffre** dans son worker avec `decryptWebhookSecret(enc, projectId, loadWebhookSecretKeyring())` de `@hifrica/db` | Un secret global serait connu de tous les utilisateurs ; une copie de la base ne livre pas les secrets | **A2, A5** | **À VALIDER** (A) |
| **A-2** | `WEBHOOK_SIGNING_SECRET` (global, `.env.example`) est retiré **quand A5 est fusionné** | Remplacé par le secret par projet | A2, A5 | **À VALIDER** (A) |
| **A-3** | `request_id` = uuid v4 généré **par le moteur à la réception**, renvoyé dans l'en-tête `X-Hifrica-Request-Id`, transmis dans la session de paiement et les événements ; colonne unique de `request_logs` | Relie la requête, le paiement, le webhook et la console ; le journal est écrit **après** la réponse | **A (moteur)**, B (événements), C (console) | **À VALIDER** (A, B) |
| **A-4** | `request_logs` distingue `outcome` (`responded`, `client_aborted`, `response_failed`, `timeout`) et `status` (code **réellement envoyé**, sinon NULL), plus `error_code`. Le moteur déclare les crochets Fastify `onRequest`, `onError`, `onResponse` et `onRequestAbort`, qui appellent le module de journalisation de C | Fastify ne déclenche pas `onResponse` quand le client coupe : sans cela, il faudrait inventer un code HTTP | **A (index.ts du moteur)**, C (C4) | **À VALIDER** (A) |
| **A-5** | `webhook_deliveries` : **une ligne par tentative** + `delivery_id` (identifiant du job BullMQ), `outcome` (`success`, `http_error`, `network_error`, `timeout`, `blocked`), `status_code` seulement si une réponse HTTP existe. **Nombre maximal de tentatives : 3 ou 4 ?** (le cahier dit « 3 relances » et « 3 tentatives max »). **Qui crée la table : C, ou A dans sa PR ?** | Écritures en insertion seule ; chaque échec garde sa cause (Parcours 3) | **A2, A4**, C (console) | **À VALIDER** (A), non implémenté |
| **A-6** | Plusieurs simulateurs par projet : `project_simulators(project_id, simulator_id, active_scenario_key)` ; `NULL` = nominal. Le moteur lit le scénario actif du projet (en-tête `X-Hifrica-Scenario` gardé seulement hors production) | La boutique de démonstration utilise 3 simulateurs ; un seul `active_scenario_id` ne suffit pas | **A (moteur)**, C (C3) | **À VALIDER** (A) |
| **AB-1** | Tout le schéma et les requêtes vivent dans `packages/db` (propriétaire : C). A et B importent `@hifrica/db`. Une nouvelle table de A ou B = une PR sur `packages/db` relue par C | Une seule source de schéma ; pas de revue à trois pour chaque migration | A, B | **À VALIDER** (A, B) |
| **AB-2** | Règles des migrations : rebase sur `main` avant `pnpm db:generate` ; ne jamais modifier une migration fusionnée ; SQL non générable dans une migration `--custom` ; vérifier avec `check-migration-journal.mjs origin/main` | Drizzle **ignore sans erreur** une migration plus ancienne fusionnée après coup | A, B | **À VALIDER** (A, B) |
| **B-1** | Journaliser l'USSD et les SMS dans `request_logs` : `channel` = `ussd` ou `sms`, `source = 'phone'`, `status` NULL en USSD | La console montre tous les échanges | **B (B3, B4)** | **À VALIDER** (B) |
| **B-2** | Événement `log.created` (à ajouter à B0 après sa fusion) : `{ id, v: 1, type, projectId, createdAt, logId: string, requestId, simulator, channel, method, path, status: number \| null, outcome, durationMs, source }` | Le BIGINT circule en chaîne ; aucun code HTTP inventé | **B (SSE)**, C (console) | **À VALIDER** (B) |
| **B-3** | Autorisation des routes SSE et téléphone de B1 : `requireUser()` et `assertProjectOwner()` fournis par C en C2 (404 si le projet n'appartient pas à l'utilisateur) | Isolation entre projets | **B1** (bouchon en attendant C2) | **À VALIDER** (B) |

## 3. Ce que chaque tâche obtient dès la fusion de C1

| Tâche | Fourni par `@hifrica/db` |
|---|---|
| **A5** (URL de webhook en base) | `projects.webhookUrl`, `projects.webhookSecretEnc`, `decryptWebhookSecret`, `loadWebhookSecretKeyring`. Le moteur ajoute `@hifrica/db` à ses dépendances et `COPY packages/db` dans `apps/engine/Dockerfile` |
| **C2** (comptes, projets, clés) | Tables Better Auth + `authSchemaOptions`, `projects`, `apiKeys`, `generateApiKey`, `generateWebhookSecret`, `encryptWebhookSecret` |
| **C4** (journal, console) | `requestLogs`, `toApiId` et `parseApiId` (BIGINT en chaîne) |
| **C5** (éditeur, catalogue, fork) | `simulators`, `simulatorVersions`, `projectSimulators` |
