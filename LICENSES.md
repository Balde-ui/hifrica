Généré par pnpm licenses:md, ne pas modifier à la main

# Composants tiers et licences

Déclaration exigée par l'article 6 du règlement CADEV 2026.
Toutes les licences des dépendances npm de production sont permissives ; aucune licence à réciprocité (GPL, AGPL, LGPL).

La liste npm est produite par `pnpm licenses list --json --prod` (dépendances directes et indirectes de production de tout le monorepo) via `pnpm licenses:md` ; la CI vérifie à chaque push qu'elle est à jour (`pnpm licenses:md:check`) et qu'aucune licence n'est interdite (`pnpm licenses:check`). Les binaires propres à une plateforme sont regroupés par famille, pour que le fichier soit identique sous Linux, macOS et Windows. Les sections hors npm se modifient dans `scripts/licenses-non-npm.md`.

## Images Docker et services

| Composant | Usage | Licence |
| --- | --- | --- |
| Node.js 22 (image `node:22-alpine`) | Exécution de l'API et du moteur | MIT |
| Caddy 2 (image `caddy:2`) | Proxy HTTPS, service du front | Apache 2.0 |
| PostgreSQL 16 (image `postgres:16-alpine`) | Base de données | PostgreSQL License |
| Valkey 8 (image `valkey/valkey:8-alpine`) | Files et cache | BSD-3-Clause |
| Alpine Linux (images de base) | Système des conteneurs | Outils système des images, non intégrés au code |
| GitHub Actions `actions/checkout`, `actions/setup-node`, `pnpm/action-setup` | CI | MIT |
| GitHub Action `appleboy/ssh-action` | Déploiement | MIT |

## Outils de développement

TypeScript (Apache 2.0), Vite (MIT), @vitejs/plugin-react (MIT), esbuild (MIT), types `@types/*` (MIT). Non embarqués dans les images de production de l'API et du moteur.

## Dépendances npm de production (119 paquets et 3 familles de binaires de plateforme)

### Résumé par licence

Une famille de binaires de plateforme compte pour une ligne.

| Licence | Lignes |
| --- | --- |
| MIT | 105 |
| Apache-2.0 | 5 |
| ISC | 5 |
| BSD-3-Clause | 4 |
| OFL-1.1 | 2 |
| 0BSD | 1 |

### Détail

| Paquet | Version | Licence | Dépôt |
| --- | --- | --- | --- |
| @better-auth/core | 1.7.22 | MIT | <https://github.com/better-auth/better-auth/tree/HEAD/packages/core> |
| @better-auth/drizzle-adapter | 1.7.22 | MIT | <https://github.com/better-auth/better-auth/tree/HEAD/packages/drizzle-adapter> |
| @better-auth/kysely-adapter | 1.7.22 | MIT | <https://github.com/better-auth/better-auth/tree/HEAD/packages/kysely-adapter> |
| @better-auth/memory-adapter | 1.7.22 | MIT | <https://github.com/better-auth/better-auth/tree/HEAD/packages/memory-adapter> |
| @better-auth/mongo-adapter | 1.7.22 | MIT | <https://github.com/better-auth/better-auth/tree/HEAD/packages/mongo-adapter> |
| @better-auth/prisma-adapter | 1.7.22 | MIT | <https://github.com/better-auth/better-auth/tree/HEAD/packages/prisma-adapter> |
| @better-auth/telemetry | 1.7.22 | MIT | <https://github.com/better-auth/better-auth/tree/HEAD/packages/telemetry> |
| @better-auth/utils | 0.5.1 | MIT | <https://github.com/better-auth/utils> |
| @better-fetch/fetch | 1.3.3 | MIT | <https://github.com/better-auth/better-fetch/tree/HEAD/packages/better-fetch> |
| @drizzle-team/brocli | 0.10.2 | Apache-2.0 | <https://github.com/drizzle-team/brocli> |
| @esbuild-kit/core-utils | 3.3.2 | MIT | <https://github.com/esbuild-kit/core-utils> |
| @esbuild-kit/esm-loader | 2.6.5 | MIT | <https://github.com/esbuild-kit/esm-loader> |
| @fastify/ajv-compiler | 4.0.7 | MIT | <https://github.com/fastify/ajv-compiler> |
| @fastify/deepmerge | 3.2.4 | MIT | <https://github.com/fastify/deepmerge> |
| @fastify/error | 4.2.1 | MIT | <https://github.com/fastify/fastify-error> |
| @fastify/fast-json-stringify-compiler | 5.1.1 | MIT | <https://github.com/fastify/fast-json-stringify-compiler> |
| @fastify/forwarded | 3.1.2 | MIT | <https://github.com/fastify/forwarded> |
| @fastify/merge-json-schemas | 0.2.2 | MIT | <https://github.com/fastify/merge-json-schemas> |
| @fastify/proxy-addr | 5.1.2 | MIT | <https://github.com/fastify/proxy-addr> |
| @fontsource-variable/inter | 5.1.1 | OFL-1.1 | <https://github.com/fontsource/font-files/tree/HEAD/fonts/variable/inter> |
| @fontsource-variable/sora | 5.1.1 | OFL-1.1 | <https://github.com/fontsource/font-files/tree/HEAD/fonts/variable/sora> |
| @ioredis/commands | 2.0.0 | MIT | <https://github.com/ioredis/commands> |
| @noble/ciphers | 2.4.0 | MIT | <https://github.com/paulmillr/noble-ciphers> |
| @noble/hashes | 2.4.0 | MIT | <https://github.com/paulmillr/noble-hashes> |
| @pinojs/redact | 0.4.0 | MIT | <https://github.com/pinojs/redact> |
| @standard-schema/spec | 1.1.0 | MIT | <https://github.com/standard-schema/standard-schema> |
| @types/node | 22.20.5 | MIT | <https://github.com/DefinitelyTyped/DefinitelyTyped/tree/HEAD/types/node> |
| @types/pg | 8.23.1 | MIT | <https://github.com/DefinitelyTyped/DefinitelyTyped/tree/HEAD/types/pg> |
| abstract-logging | 2.0.1 | MIT | <https://github.com/jsumners/abstract-logging> |
| ajv | 8.20.0 | MIT | <https://github.com/ajv-validator/ajv> |
| ajv-formats | 3.0.1 | MIT | <https://github.com/ajv-validator/ajv-formats> |
| atomic-sleep | 1.0.0 | MIT | <https://github.com/davidmarkclements/atomic-sleep> |
| avvio | 9.3.1 | MIT | <https://github.com/fastify/avvio> |
| better-auth | 1.7.22 | MIT | <https://github.com/better-auth/better-auth/tree/HEAD/packages/better-auth> |
| better-call | 1.4.5 | MIT | <https://github.com/better-auth/better-call/tree/HEAD/packages/better-call> |
| buffer-from | 1.1.2 | MIT | <https://github.com/LinusU/buffer-from> |
| bullmq | 6.7.6 | MIT | <https://github.com/taskforcesh/bullmq> |
| cluster-key-slot | 1.1.1 | Apache-2.0 | <https://github.com/Salakar/cluster-key-slot> |
| cookie | 2.0.2 | MIT | <https://github.com/jshttp/cookie> |
| cron-parser | 5.10.4 | MIT | <https://github.com/harrisiirak/cron-parser> |
| debug | 4.4.3 | MIT | <https://github.com/debug-js/debug> |
| defu | 6.1.7 | MIT | <https://github.com/unjs/defu> |
| denque | 2.1.0 | Apache-2.0 | <https://github.com/invertase/denque> |
| dequal | 2.0.3 | MIT | <https://github.com/lukeed/dequal> |
| detect-libc | 2.1.2 | Apache-2.0 | <https://github.com/lovell/detect-libc> |
| drizzle-kit | 0.31.11 | MIT | <https://github.com/drizzle-team/drizzle-orm> |
| drizzle-orm | 0.45.4 | Apache-2.0 | <https://github.com/drizzle-team/drizzle-orm> |
| esbuild | 0.18.20, 0.25.12, 0.28.2 | MIT | <https://github.com/evanw/esbuild> |
| fast-decode-uri-component | 1.0.1 | MIT | <https://github.com/delvedor/fast-decode-uri-component> |
| fast-deep-equal | 3.1.3 | MIT | <https://github.com/epoberezkin/fast-deep-equal> |
| fast-json-stringify | 7.3.5 | MIT | <https://github.com/fastify/fast-json-stringify> |
| fast-querystring | 1.1.2 | MIT | <https://github.com/anonrig/fast-querystring> |
| fast-uri | 3.1.9, 4.2.3 | BSD-3-Clause | <https://github.com/fastify/fast-uri> |
| fastify | 5.12.8 | MIT | <https://github.com/fastify/fastify> |
| fastq | 1.20.3 | ISC | <https://github.com/mcollina/fastq> |
| find-my-way | 9.10.0 | MIT | <https://github.com/delvedor/find-my-way> |
| get-tsconfig | 4.14.3 | MIT | <https://github.com/privatenumber/get-tsconfig> |
| ioredis | 6.0.0 | MIT | <https://github.com/redis/ioredis> |
| ipaddr.js | 2.5.0 | MIT | <https://github.com/whitequark/ipaddr.js> |
| jose | 6.2.17 | MIT | <https://github.com/panva/jose> |
| json-schema-ref-resolver | 3.0.1 | MIT | <https://github.com/fastify/json-schema-ref-resolver> |
| json-schema-traverse | 1.0.0 | MIT | <https://github.com/epoberezkin/json-schema-traverse> |
| kysely | 0.29.9 | MIT | <https://github.com/kysely-org/kysely> |
| light-my-request | 6.8.0 | BSD-3-Clause | <https://github.com/fastify/light-my-request> |
| luxon | 3.7.2 | MIT | <https://github.com/moment/luxon> |
| monaco-editor | 0.52.2 | MIT | <https://github.com/microsoft/monaco-editor> |
| ms | 2.1.3 | MIT | <https://github.com/vercel/ms> |
| msgpackr | 2.1.4 | MIT | <https://github.com/kriszyp/msgpackr> |
| msgpackr-extract | 3.0.7 | MIT | <https://github.com/kriszyp/msgpackr-extract> |
| nanostores | 1.5.5 | MIT | <https://github.com/nanostores/nanostores> |
| node-abort-controller | 3.1.1 | MIT | <https://github.com/southpolesteve/node-abort-controller> |
| node-gyp-build-optional-packages | 5.2.2 | MIT | <https://github.com/prebuild/node-gyp-build> |
| on-exit-leak-free | 2.1.2 | MIT | <https://github.com/mcollina/on-exit-or-gc> |
| pg | 8.23.1 | MIT | <https://github.com/brianc/node-postgres/tree/HEAD/packages/pg> |
| pg-cloudflare | 1.4.1 | MIT | <https://github.com/brianc/node-postgres/tree/HEAD/packages/pg-cloudflare> |
| pg-connection-string | 2.14.1 | MIT | <https://github.com/brianc/node-postgres/tree/HEAD/packages/pg-connection-string> |
| pg-int8 | 1.0.1 | ISC | <https://github.com/charmander/pg-int8> |
| pg-pool | 3.14.0 | MIT | <https://github.com/brianc/node-postgres/tree/HEAD/packages/pg-pool> |
| pg-protocol | 1.16.1 | MIT | <https://github.com/brianc/node-postgres/tree/HEAD/packages/pg-protocol> |
| pg-types | 2.2.0 | MIT | <https://github.com/brianc/node-pg-types> |
| pgpass | 1.0.5 | MIT | <https://github.com/hoegaarden/pgpass> |
| pino | 10.4.0 | MIT | <https://github.com/pinojs/pino> |
| pino-abstract-transport | 3.0.0 | MIT | <https://github.com/pinojs/pino-abstract-transport> |
| pino-std-serializers | 7.1.0 | MIT | <https://github.com/pinojs/pino-std-serializers> |
| postgres-array | 2.0.0 | MIT | <https://github.com/bendrucker/postgres-array> |
| postgres-bytea | 1.0.1 | MIT | <https://github.com/bendrucker/postgres-bytea> |
| postgres-date | 1.0.7 | MIT | <https://github.com/bendrucker/postgres-date> |
| postgres-interval | 1.2.0 | MIT | <https://github.com/bendrucker/postgres-interval> |
| process-warning | 5.1.1 | MIT | <https://github.com/fastify/process-warning> |
| quick-format-unescaped | 4.0.4 | MIT | <https://github.com/davidmarkclements/quick-format> |
| react | 19.3.1 | MIT | <https://github.com/react/react/tree/HEAD/packages/react> |
| react-dom | 19.3.1 | MIT | <https://github.com/react/react/tree/HEAD/packages/react-dom> |
| real-require | 1.0.0 | MIT | <https://github.com/pinojs/real-require> |
| redis-errors | 1.2.0 | MIT | <https://github.com/NodeRedis/redis-errors> |
| require-from-string | 2.0.2 | MIT | <https://github.com/floatdrop/require-from-string> |
| resolve-pkg-maps | 1.0.0 | MIT | <https://github.com/privatenumber/resolve-pkg-maps> |
| ret | 0.5.1 | MIT | <https://github.com/fent/ret.js> |
| reusify | 1.1.0 | MIT | <https://github.com/mcollina/reusify> |
| rfdc | 1.4.1 | MIT | <https://github.com/davidmarkclements/rfdc> |
| rou3 | 0.9.2 | MIT | <https://github.com/h3js/rou3> |
| safe-regex2 | 5.1.2 | MIT | <https://github.com/fastify/safe-regex2> |
| safe-stable-stringify | 2.5.0 | MIT | <https://github.com/BridgeAR/safe-stable-stringify> |
| scheduler | 0.28.0 | MIT | <https://github.com/react/react/tree/HEAD/packages/scheduler> |
| secure-json-parse | 4.1.1 | BSD-3-Clause | <https://github.com/fastify/secure-json-parse> |
| semver | 7.8.6 | ISC | <https://github.com/npm/node-semver> |
| set-cookie-parser | 3.2.2 | MIT | <https://github.com/nfriedly/set-cookie-parser> |
| sonic-boom | 4.2.1 | MIT | <https://github.com/pinojs/sonic-boom> |
| source-map | 0.6.1 | BSD-3-Clause | <https://github.com/mozilla/source-map> |
| source-map-support | 0.5.21 | MIT | <https://github.com/evanw/node-source-map-support> |
| split2 | 4.2.0 | ISC | <https://github.com/mcollina/split2> |
| standard-as-callback | 2.1.0 | MIT | <https://github.com/luin/asCallback> |
| thread-stream | 4.2.1 | MIT | <https://github.com/mcollina/thread-stream> |
| toad-cache | 3.7.4 | MIT | <https://github.com/kibertoad/toad-cache> |
| tslib | 2.9.1 | 0BSD | <https://github.com/Microsoft/tslib> |
| tsx | 4.23.15 | MIT | <https://github.com/privatenumber/tsx> |
| undici-types | 6.21.0 | MIT | <https://github.com/nodejs/undici> |
| xtend | 4.0.2 | MIT | <https://github.com/Raynos/xtend> |
| yaml | 2.9.1 | ISC | <https://github.com/eemeli/yaml> |
| zod | 4.6.7 | MIT | <https://github.com/colinhacks/zod> |

### Binaires propres à une plateforme

Une seule variante est installée, selon le système et le processeur de la machine.

| Paquet | Rôle | Licence | Dépôt |
| --- | --- | --- | --- |
| `@esbuild/<plateforme>` | binaire esbuild de la plateforme | MIT | <https://github.com/evanw/esbuild> |
| `@msgpackr-extract/msgpackr-extract-<plateforme>` | binaire msgpackr-extract de la plateforme | MIT | <https://github.com/kriszyp/msgpackr-extract> |
| `fsevents` | module natif de tsx, macOS uniquement | MIT | <https://github.com/fsevents/fsevents> |
