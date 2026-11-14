# Déclaration d'usage de l'intelligence artificielle

Déclaration exigée par l'article 6 du règlement CADEV 2026 : outils utilisés et parties du projet concernées. À compléter par chaque membre au fil du projet.

## 1. Outils d'IA utilisés pour concevoir et développer le projet

| Outil | Utilisé par | Parties concernées | Relu et maîtrisé par |
| --- | --- | --- | --- |
| Claude (Anthropic) | Alhassane | Cahier des charges, squelette initial du monorepo (structure, docker-compose, Caddyfile, CI/CD, schéma YAML partagé, première version du moteur de simulation), documents de conformité | L'équipe |
| Claude Code | Alhassane | A0 : découpage du moteur en modules | Alhassane, relu en PR par B ou C |
| Claude Code | Alhassane | A1 : assistant IA (génération de simulateurs) | Alhassane, relu en PR par B ou C |
| Claude Code | Alhassane | A2 : webhooks signés (file BullMQ, HMAC, relances, protection SSRF) | Alhassane, relu en PR par B ou C |
| Claude Code | Alhassane | A3 + A4 : session de paiement et webhook sur confirmation | Alhassane, relu en PR par B et C |
| Claude Code | Alhassane | A5 : webhooks par projet et historique des envois | Alhassane, relu en PR par B et C |
| Claude Code | Iza | B0 : types d'événements temps réel partagés (`packages/shared`) | Iza, relu en PR par A |
| Claude Code | Iza | B1 : route SSE (`/api/projects/:id/stream`) et route de confirmation téléphone | Iza, relu en PR par A et C |
| Claude Code | Iza | B2 : écran du téléphone simulé (interface) | Iza, relu en PR par A |
| Claude Code | Iza | B3 : moteur USSD (menus, sessions Valkey, saisies sensibles) | Iza, relu en PR par A et C |
| Claude Code | Iza | B4 : notification SMS depuis un simulateur HTTP (`screen: sms`) | Iza, relu en PR par A |
| Claude Code | Mamadou | C0 + C1 : conception des tables (comptes, projets, clés, simulateurs, scénarios actifs, journal des requêtes), schéma Drizzle, migrations au démarrage, chiffrement des secrets de webhook (`packages/db`) | Mamadou, relu en PR par A et B (#2) |
| Claude Code | Mamadou | C4 (couche de données) : erreurs sûres et validation des données (E1) | Mamadou, relu en PR par A et B (#8) |
| Claude Code | Mamadou | C2 à C5 : comptes Better Auth, projets, clés de test hachées et affichées une seule fois, vraie clé et scénario actif dans le moteur, journal des requêtes et console, catalogue, éditeur YAML et fork, boutique de démonstration | Mamadou, relu en PR par A et B (#12) |
| Claude Code | Mamadou | Refonte de l'interface (`apps/web`) : design system, pages, responsive, accessibilité, inspection visuelle automatisée (Playwright) | Mamadou, fusionnée par A (#12) |
| Claude Code | Mamadou | C6 : réception des webhooks par la boutique de démonstration (`apps/api/src/demo-webhooks.ts`) : vérification de la signature partagée, anti-rejeu, déduplication atomique (script Lua Valkey), lecture réservée au propriétaire du projet | Mamadou, fusionnée par A (#24) |
| Claude Code | Mamadou | Vue d'ensemble du projet (`apps/web/src/pages/Overview.tsx`) : utilisation sur 60 min / 24 h / 7 jours calculée sur le journal réel, statistiques partielles signalées au-delà de 500 requêtes, étapes « Bien démarrer », fenêtre « Connecter » | Mamadou, fusionnée par A (#24) |
| Claude Code | Mamadou | Coquille du tableau de bord (barre latérale à trois modes, en-tête, menu du compte), validation serveur du nom à l'inscription, messages d'erreur de l'assistant IA, logo et favicons | Mamadou, fusionnée par A (#24) |
| Claude Code | Mamadou | Cadre de smartphone générique de la boutique de démonstration (`DeviceFrame.tsx`, `device-frame.css`) autour du téléphone simulé de B, inchangé | Mamadou, en revue par A (#29) |
| _à compléter_ | | | |

Chaque contribution produite avec une IA est relue en pull request par un autre membre avant fusion, et les trois membres savent l'expliquer.

## 2. LLM intégrés au produit (assistant IA de Hifrica)

| Fournisseur | Rôle | Usage | Données envoyées |
| --- | --- | --- | --- |
| DeepSeek (API) | Principal | Génération de YAML de simulateur depuis une description ; explication d'erreurs | Description et YAML. Masqués avant envoi (`apps/api/src/ai/mask.ts`) : emails, y compris accentués ; téléphones internationaux (+… ou 00…) ; numéros sénégalais (70, 75 à 78, 30, 33, avec ou sans 221) ; numéros nationaux de 8 à 11 chiffres écrits par groupes (espaces, points, tirets), ou commençant par 0 ; numéros de carte (13 à 19 chiffres, clé de Luhn valide) ; IBAN ; jetons JWT et jetons « Bearer » ; clés commençant par `sk_`, `sk-`, `pk_`, `rk_`, `whsec_`, `ghp_`, `github_pat_` ; chaînes de 32 caractères ou plus, hexadécimales ou mêlant chiffres, minuscules et majuscules (base64) ; valeur qui suit « PIN », « OTP », « code », « code secret », « code confidentiel », « passcode », « mot de passe », « password », « mdp », « CVV » ou « CVC », si elle suit « : » ou « = » ou contient un chiffre (sauf code USSD, et sauf nombre de 3 chiffres de 100 à 599 après « code », traité comme un code HTTP) ; dans un code USSD, un segment de 4 à 6 chiffres qui suit « PIN » ou qui termine le code (`*144*4*1234#`). Les montants suivis de FCFA, XOF, F CFA ou francs ne sont jamais masqués. Non masqués : noms de personnes ; dates de naissance ; adresses postales ; PIN ou mot de passe écrit sans mot-clé reconnu ni format USSD (« valider avec 1234 ») ; valeur sans chiffre écrite sans « : » ni « = » (« mot de passe soleil ») ; PIN de 3 chiffres après « code » (« code 123 ») ; numéros de 8 chiffres sans séparateur ni 0 initial (« 76123456 »). Faux positif possible : un nombre groupé sans devise (« 10 500 000 ») est remplacé par [TEL]. |
| Google Gemini Flash (API, offre gratuite) | Secours | Mêmes usages si DeepSeek échoue | Idem |

- **Réservé aux utilisateurs connectés.** `POST /api/simulators/generate` exige une session (sinon `401 auth_required`), vérifiée avant tout contrôle de quota et tout appel à un fournisseur. Chaque compte a un quota de générations par jour UTC (`AI_USER_DAILY_LIMIT`, 20 par défaut ; au-delà `429 user_quota_exceeded`), en plus du quota par adresse IP (10 par heure) et du plafond global du jour (`AI_DAILY_LIMIT`). Les logs n'identifient le compte que par son id, jamais par son email ; ni l'un ni l'autre n'est envoyé au fournisseur.
- Les deux fournisseurs sont appelés directement par l'API REST (fetch), sans SDK.
- Les conditions d'utilisation des deux fournisseurs ont été lues.
- Le masquage est partiel (voir le tableau) ; Gemini, en offre gratuite, peut réutiliser les données envoyées : c'est pourquoi il n'est utilisé qu'en secours.
- Tout YAML généré est validé par le JSON Schema partagé (`packages/shared`) et relu par l'utilisateur avant publication.

### Ce que l'interface montre (`apps/web`)

- **Avertissement avant l'envoi.** La fenêtre « Générer avec l'IA » de l'éditeur (`apps/web/src/pages/Editor.tsx`) affiche, sous le champ de description : « Ne saisissez ni donnée personnelle ni secret : la description est envoyée à un fournisseur d'IA (masquage partiel). » La description est limitée à 2 000 caractères ; le bouton « Générer » reste inactif en dessous de 10.
- **Badge sur le YAML généré.** Après une génération, l'éditeur affiche le badge « Généré par IA, à vérifier ». Il reste affiché si l'utilisateur modifie le YAML, et ne disparaît que si l'on repart du modèle de départ (bouton « Modèle »). Un YAML encore invalide après les corrections automatiques est quand même ouvert dans l'éditeur, avec ses erreurs soulignées, et ne peut pas être publié tant qu'elles restent.
- **Badge après publication.** L'interface publie le simulateur avec `origin: "ai"`. L'API lui donne alors le statut « à vérifier » (`apps/api/src/platform.ts`), et le badge « Généré par IA, à vérifier » s'affiche dans le catalogue, la liste des simulateurs du projet et la page du simulateur (`SimulatorBadges`, `apps/web/src/ui.tsx`). L'origine est fixée à la première publication : les versions suivantes la conservent.
- **Limites.** L'origine est déclarée par l'interface, pas prouvée : un appel direct à l'API sans `origin: "ai"` publie sans badge, et un fork d'un simulateur généré par IA repart avec une origine « manuelle ». Le badge est un signal pour le lecteur, pas une vérification du contenu.
