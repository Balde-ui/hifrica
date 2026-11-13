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
- Tout YAML généré est validé par le JSON Schema partagé (`packages/shared`) et relu par l'utilisateur avant publication ; il est marqué « Généré par IA, à vérifier ».