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
