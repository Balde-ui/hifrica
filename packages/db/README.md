# @hifrica/db

Socle base de données de Hifrica (propriétaire : Dev C) : schéma Drizzle PostgreSQL 16, tables Better Auth,
migrations versionnées appliquées au démarrage de l'API, chiffrement des secrets et empreinte des clés.

Les contrats partagés avec A et B (et leur état de validation) sont dans [`C0_CONTRATS.md`](C0_CONTRATS.md).

## Contenu

```
packages/db/
├── auth.cli.mjs              # config Better Auth réservée au CLI de génération (sans base, sans secret)
├── drizzle.config.ts         # drizzle-kit lit le schéma COMPILÉ (dist/schema/index.js)
├── migrations/               # SQL versionné : 0000_init (généré), 0001_users_role_check (--custom), 0002_request_logs_session_id (généré, D14), 0003_webhook_deliveries (généré, A5)
├── scripts/
│   ├── auth-schema.mjs       # generate | check : schéma Better Auth reproductible + contrôle de dérive
│   └── check-migration-journal.mjs  # ordre strict des migrations, fichiers orphelins, migrations fusionnées intactes
├── src/
│   ├── auth/options.ts       # options Better Auth qui définissent le schéma (source unique, CLI + API)
│   ├── schema/auth.ts        # GÉNÉRÉ : users, sessions, accounts, verifications — ne pas modifier
│   ├── schema/*.ts           # projects, api_keys, simulators, simulator_versions, project_simulators, request_logs, webhook_deliveries
│   ├── client.ts             # createPool (sessions en UTC) / createDb
│   ├── errors.ts             # erreurs sûres : DbOperationError, toSafeDbError, safeDbCall, InvalidInputError
│   ├── validate.ts           # isUuid, méthode HTTP, error_code, slug (alignés sur les CHECK)
│   ├── migrate.ts            # runMigrations : connexion dédiée + verrou consultatif sur cette connexion
│   ├── crypto/api-keys.ts    # sk_test_… : génération, SHA-256, format
│   ├── crypto/webhook-secret.ts  # secrets whsec_… chiffrés AES-256-GCM (WEBHOOK_SECRET_KEYS)
│   └── ids.ts                # BIGINT ↔ chaîne (jamais Number)
└── test/{unit,pg}/           # node:test (aucune dépendance de test ajoutée)
```

## Commandes

| Commande | Rôle |
|---|---|
| `pnpm --filter @hifrica/db build` | Compile vers `dist/` (fait aussi par `pnpm build`) |
| `pnpm db:generate` | Génère une migration à partir du schéma TypeScript |
| `pnpm --filter @hifrica/db db:generate:custom -- --name <nom>` | Crée une migration SQL manuelle vide |
| `pnpm db:check` | `drizzle-kit check` + cohérence du journal |
| `node packages/db/scripts/check-migration-journal.mjs origin/main` | Idem, et vérifie que les migrations de `main` sont inchangées et en tête |
| `pnpm --filter @hifrica/db db:auth:generate` | Régénère `src/schema/auth.ts` depuis `src/auth/options.ts` (CLI `auth@1.7.22`) |
| `pnpm --filter @hifrica/db db:auth:drift` | Échoue si le schéma Better Auth versionné ne correspond plus à la génération |
| `pnpm test:db` | Tests unitaires (clés, chiffrement, identifiants) |
| `pnpm test:db:pg` | Tests sur bases PostgreSQL **vierges** (voir ci-dessous) |

### Tests PostgreSQL

Ils créent une base neuve par série sur un serveur de test, puis la suppriment. **Jamais la production.**

```bash
docker run -d --rm --name hifrica-test-pg -e POSTGRES_PASSWORD=<mdp> -p 127.0.0.1:55432:5432 postgres:16-alpine
HIFRICA_TEST_PG_ADMIN_URL=postgres://postgres:<mdp>@127.0.0.1:55432/postgres pnpm test:db:pg
docker stop hifrica-test-pg
```

Sans `HIFRICA_TEST_PG_ADMIN_URL`, ces tests sont **ignorés** (et affichés comme tels), pas réussis.

## Variables d'environnement

| Variable | Utilisée par | Requise |
|---|---|---|
| `DATABASE_URL` | API (migrations au démarrage), moteur plus tard | Oui en production (fournie par `docker-compose.yml`). Absente : l'API démarre sans migrer (dev local) |
| `WEBHOOK_SECRET_KEYS` | Chiffrement (C2) / déchiffrement (A5) des secrets de webhook | Dès C2. Format `v1:<base64 32 octets>[,v0:…]`, la première chiffre |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Better Auth (C2) | Dès C2 |

`WEBHOOK_SECRET_KEYS` n'est jamais stockée en base. La perdre rend les secrets illisibles (il faut les régénérer) :
la sauvegarder à part, jamais à côté des dumps SQL.

## Règles

**Migrations**
- Drizzle applique une migration seulement si son `when` est plus récent que la dernière appliquée : une migration
  générée sur une branche en retard puis fusionnée serait **ignorée sans erreur**. Toujours rebaser sur `main`
  avant `pnpm db:generate`, et lancer `check-migration-journal.mjs origin/main` avant de fusionner.
- Ne **jamais** modifier une migration fusionnée : en créer une nouvelle.
- Pas de `CREATE INDEX CONCURRENTLY` (toutes les migrations en attente tournent dans une seule transaction).
- `runMigrations` prend `pg_try_advisory_lock` **sur la connexion qui migre** (un `pg.Client` dédié, jamais le
  pool) : plusieurs démarrages simultanés sont sérialisés.

**Schéma Better Auth**
- `src/schema/auth.ts` est généré : toute adaptation passe par `src/auth/options.ts` (champs, plugins, index)
  ou par une migration `--custom` (contraintes que le générateur ne produit pas, ex. `users_role_chk`).
- Les colonnes `timestamp` sans fuseau des tables Better Auth sont sûres : Drizzle écrit et relit en UTC, et
  toutes les sessions (pool, migrations) sont forcées en UTC.
- `role` n'est jamais accepté depuis une requête (`input: false`).

**Données**
- Clés d'API : seule l'empreinte SHA-256 est stockée ; la clé complète n'est montrée qu'une fois.
- `request_logs.id` est un BIGINT : `bigint` côté JS, chaîne à l'extérieur (`toApiId` / `parseApiId`).
- `request_logs` distingue `outcome` (issue réelle) et `status` (code HTTP réellement envoyé, sinon NULL).

**Erreurs et validation (E1)**
- Tout accès à la base passe par `safeDbCall(operation, fn)` : une erreur Drizzle ou `pg` est convertie en
  `DbOperationError` qui ne garde que `operation` (liste fermée `DB_OPERATIONS`), `kind`, un `sqlstate`
  autorisé et, pour une violation d'intégrité, le nom de contrainte. Le message, les paramètres, `detail`,
  `hint`, `where` et les informations de connexion d'origine ne sont **jamais** lus ni recopiés.
- **Aucune `cause`** n'est conservée : pino (`errWithCause`), `util.inspect` et Fastify la parcourraient et
  journaliseraient les paramètres SQL (PIN, clés, corps). En contrepartie, la pile d'une `DbOperationError`
  pointe vers `toSafeDbError` / `safeDbCall` et non vers la requête : se fier à `operation` et à la pile de
  l'appelant.
- Catégories (`kind`) : violations d'intégrité, `invalid_input`, `serialization_failure`, `deadlock`,
  `lock_not_available`, `query_canceled`, `connection`, `schema_mismatch` (`42P01`, `42703` : souvent une
  migration non appliquée), `transaction_aborted` (`25P02`), `authentication_failed` (`28P01`, `28000`),
  `database_not_found` (`3D000`), sinon `unknown` (sans SQLSTATE).
- Les validateurs de `validate.ts` **refusent** sans corriger (ni `trim`, ni changement de casse) et lèvent
  `InvalidInputError(champ, règle)`, qui ne contient **jamais** la valeur rejetée.
- Les tests de journalisation (`test/unit/db-errors.test.mjs`) utilisent le pino et le Fastify installés pour
  `apps/api` : s'ils sont introuvables, ces tests **échouent** (ils ne sont jamais ignorés).
