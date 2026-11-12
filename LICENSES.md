# Composants tiers et licences

Déclaration exigée par l'article 6 du règlement CADEV 2026. Toutes les licences sont permissives ; aucune licence à réciprocité (GPL, AGPL, LGPL). Liste générée par `pnpm licenses list --prod` et vérifiée à chaque push par `pnpm licenses:check`.

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

## Dépendances npm de production

| Paquet | Version | Licence |
| --- | --- | --- |
| @fastify/ajv-compiler | 4.0.7 | MIT |
| @fastify/deepmerge | 3.2.4 | MIT |
| @fastify/error | 4.2.1 | MIT |
| @fastify/fast-json-stringify-compiler | 5.1.1 | MIT |
| @fastify/forwarded | 3.1.2 | MIT |
| @fastify/merge-json-schemas | 0.2.2 | MIT |
| @fastify/proxy-addr | 5.1.2 | MIT |
| @ioredis/commands | 2.0.0 | MIT |
| @pinojs/redact | 0.4.0 | MIT |
| abstract-logging | 2.0.1 | MIT |
| ajv | 8.20.0 | MIT |
| ajv-formats | 3.0.1 | MIT |
| atomic-sleep | 1.0.0 | MIT |
| avvio | 9.3.1 | MIT |
| cluster-key-slot | 1.1.1 | Apache-2.0 |
| cookie | 2.0.2 | MIT |
| debug | 4.4.3 | MIT |
| denque | 2.1.0 | Apache-2.0 |
| dequal | 2.0.3 | MIT |
| fast-decode-uri-component | 1.0.1 | MIT |
| fast-deep-equal | 3.1.3 | MIT |
| fast-json-stringify | 7.3.5 | MIT |
| fast-querystring | 1.1.2 | MIT |
| fast-uri | 3.1.9, 4.2.3 | BSD-3-Clause |
| fastify | 5.12.8 | MIT |
| fastq | 1.20.3 | ISC |
| find-my-way | 9.10.0 | MIT |
| ioredis | 6.0.0 | MIT |
| ipaddr.js | 2.5.0 | MIT |
| json-schema-ref-resolver | 3.0.1 | MIT |
| json-schema-traverse | 1.0.0 | MIT |
| light-my-request | 6.8.0 | BSD-3-Clause |
| ms | 2.1.3 | MIT |
| on-exit-leak-free | 2.1.2 | MIT |
| pino | 10.4.0 | MIT |
| pino-abstract-transport | 3.0.0 | MIT |
| pino-std-serializers | 7.1.0 | MIT |
| process-warning | 5.1.1 | MIT |
| quick-format-unescaped | 4.0.4 | MIT |
| react | 19.3.1 | MIT |
| react-dom | 19.3.1 | MIT |
| real-require | 1.0.0 | MIT |
| redis-errors | 1.2.0 | MIT |
| require-from-string | 2.0.2 | MIT |
| ret | 0.5.1 | MIT |
| reusify | 1.1.0 | MIT |
| rfdc | 1.4.1 | MIT |
| safe-regex2 | 5.1.2 | MIT |
| safe-stable-stringify | 2.5.0 | MIT |
| scheduler | 0.28.0 | MIT |
| secure-json-parse | 4.1.1 | BSD-3-Clause |
| semver | 7.8.6 | ISC |
| set-cookie-parser | 3.2.2 | MIT |
| sonic-boom | 4.2.1 | MIT |
| split2 | 4.2.0 | ISC |
| standard-as-callback | 2.1.0 | MIT |
| thread-stream | 4.2.1 | MIT |
| toad-cache | 3.7.4 | MIT |
| yaml | 2.9.1 | ISC |

## Outils de développement

TypeScript (Apache 2.0), Vite (MIT), @vitejs/plugin-react (MIT), esbuild (MIT), types `@types/*` (MIT). Non embarqués dans les images de production de l'API et du moteur.

> À mettre à jour à chaque ajout de dépendance : relancer `pnpm licenses list --prod`.
