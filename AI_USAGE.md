# Déclaration d'usage de l'intelligence artificielle

Déclaration exigée par l'article 6 du règlement CADEV 2026 : outils utilisés et parties du projet concernées. À compléter par chaque membre au fil du projet.

## 1. Outils d'IA utilisés pour concevoir et développer le projet

| Outil | Utilisé par | Parties concernées | Relu et maîtrisé par |
| --- | --- | --- | --- |
| Claude (Anthropic) | Alhassane | Cahier des charges, squelette initial du monorepo (structure, docker-compose, Caddyfile, CI/CD, schéma YAML partagé, première version du moteur de simulation), documents de conformité | L'équipe |
| Claude Code | Alhassane | A0 : découpage du moteur en modules | Alhassane, relu en PR par B ou C |
| Claude Code | Alhassane | A1 : assistant IA (génération de simulateurs) | Alhassane, relu en PR par B ou C |
| Claude Code | Alhassane | A2 : webhooks signés (file BullMQ, HMAC, relances, protection SSRF) | Alhassane, relu en PR par B ou C |
| _à compléter_ | | | |

Chaque contribution produite avec une IA est relue en pull request par un autre membre avant fusion, et les trois membres savent l'expliquer.

## 2. LLM intégrés au produit (assistant IA de Hifrica)

| Fournisseur | Rôle | Usage | Données envoyées |
| --- | --- | --- | --- |
| DeepSeek (API) | Principal | Génération de YAML de simulateur depuis une description ; explication d'erreurs | Description et YAML. Masquage partiel avant envoi : emails, numéros de téléphone internationaux (+…) et nationaux courants, clés et jetons, IBAN, numéros de carte, valeurs suivant « PIN », « code » ou « mot de passe ». Non masqués : les noms de personnes et les dates de naissance. L'avertissement de l'interface (« ne saisissez pas de données personnelles ») est prévu avec l'éditeur (A6). |
| Google Gemini Flash (API, offre gratuite) | Secours | Mêmes usages si DeepSeek échoue | Idem |

- Les deux fournisseurs sont appelés directement par l'API REST (fetch), sans SDK.
- Les conditions d'utilisation des deux fournisseurs ont été lues.
- Le masquage est partiel (voir le tableau) ; Gemini, en offre gratuite, peut réutiliser les données envoyées : c'est pourquoi il n'est utilisé qu'en secours.
- Tout YAML généré est validé par le JSON Schema partagé (`packages/shared`) et relu par l'utilisateur avant publication ; il est marqué « Généré par IA, à vérifier ».