# Déclaration d'usage de l'intelligence artificielle

Déclaration exigée par l'article 6 du règlement CADEV 2026 : outils utilisés et parties du projet concernées. À compléter par chaque membre au fil du projet.

## 1. Outils d'IA utilisés pour concevoir et développer le projet

| Outil | Utilisé par | Parties concernées | Relu et maîtrisé par |
| --- | --- | --- | --- |
| Claude (Anthropic) | Alhassane | Cahier des charges, squelette initial du monorepo (structure, docker-compose, Caddyfile, CI/CD, schéma YAML partagé, première version du moteur de simulation), documents de conformité | L'équipe |
| _à compléter_ | | | |

Chaque contribution produite avec une IA est relue en pull request par un autre membre avant fusion, et les trois membres savent l'expliquer.

## 2. LLM intégrés au produit (assistant IA de Hifrica)

| Fournisseur | Rôle | Usage | Données envoyées |
| --- | --- | --- | --- |
| DeepSeek (API) | Principal | Génération de YAML de simulateur depuis une description ; explication d'erreurs | Description, YAML, journaux masqués (clés, jetons, en-têtes `Authorization`, numéros, emails et noms retirés) |
| Google Gemini Flash (API, offre gratuite) | Secours | Mêmes usages si DeepSeek échoue | Idem |

- Les conditions d'utilisation des deux fournisseurs ont été lues ; aucune donnée personnelle ne leur est envoyée.
- Tout YAML généré est validé par le JSON Schema partagé (`packages/shared`) et relu par l'utilisateur avant publication ; il est marqué « Généré par IA, à vérifier ».
