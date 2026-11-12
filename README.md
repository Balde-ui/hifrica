# Hifrica

Plateforme communautaire de simulateurs de paiement mobile, d'USSD et de SMS pour tester les apps africaines, sans compte marchand ni coût. Un assistant IA crée un simulateur à partir d'une simple description. Projet présenté au concours CADEV 2026.

- **Démo** : https://app.5-22-216-30.sslip.io
- **Simulateurs** : https://sim.5-22-216-30.sslip.io

## Essayer un simulateur

```bash
curl -X POST https://sim.5-22-216-30.sslip.io/paiement-mobile-generique/v1/checkout \
  -H "Authorization: Bearer sk_test_demo" \
  -H "Content-Type: application/json" \
  -d '{"amount": 5000, "merchant": "Boutique"}'
```

Scénario d'échec : ajouter l'en-tête `X-Hifrica-Scenario: solde-insuffisant` avec un montant supérieur à 500 000.

## Architecture

| Dossier | Rôle |
| --- | --- |
| `packages/shared` | JSON Schema du format YAML et validation, partagés par tous les services |
| `apps/engine` | Moteur de simulation (Fastify) : lit les YAML et répond comme le vrai service |
| `apps/api` | API de la plateforme (Fastify) : comptes, catalogue, journaux, assistant IA |
| `apps/web` | Front (React + Vite) |
| `simulators/` | Simulateurs de lancement |
| `infra/Caddyfile` | HTTPS automatique et routage `app.` / `sim.` |

Tout tourne en Docker Compose sur un serveur cloud Systalink Datacloud (région Madrid). Seul Caddy expose des ports (80/443).

## Développement local

```bash
corepack enable
pnpm install
pnpm build
SIMULATORS_DIR=./simulators pnpm dev:engine   # http://localhost:4000
pnpm dev:api                                  # http://localhost:3000
pnpm dev:web                                  # http://localhost:5173
```

## Déploiement

Chaque push sur `main` lance la CI (build et contrôle des licences), puis déploie sur le serveur via SSH. Le fichier `.env` (voir `.env.example`) est créé une seule fois à la main sur le serveur et n'est jamais commité.

## Conformité CADEV 2026

- Composants tiers et licences : [`LICENSES.md`](LICENSES.md)
- Usage de l'IA : [`AI_USAGE.md`](AI_USAGE.md)
- Code : tous droits réservés, voir [`LICENSE`](LICENSE)
