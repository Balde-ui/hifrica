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

