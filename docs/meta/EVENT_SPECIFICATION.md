# Spécification des événements Meta

État : phase 3 (Pixel + CAPI). Le catalogue et Ads Insights arrivent en phase 4.

## Principe de déduplication

Un événement réel ne doit produire **qu'une seule** conversion Meta, même s'il part deux fois
(navigateur + serveur) et même en cas de rechargement, de renvoi de formulaire ou de nouvelle
tentative serveur.

La règle appliquée :

1. Le serveur calcule un `event_id` **déterministe** à partir de la commande.
2. Le serveur envoie l'événement via la Conversions API et renvoie ce même `event_id` au navigateur.
3. Le navigateur envoie le même `event_name` avec **exactement** le même `event_id`.
4. Meta rapproche les deux et n'en compte qu'un.

La table `meta_events` matérialise cette garantie côté base : `event_id` est `UNIQUE`, et la
réservation se fait par `INSERT … ON CONFLICT DO UPDATE … WHERE capi_sent_at IS NULL`. Un envoi
déjà réussi ne peut donc pas être réclamé une seconde fois, tandis qu'un envoi échoué reste
rejouable et incrémente `attempts`.

| Événement | `event_id` | Source |
| --- | --- | --- |
| `Purchase` | `purchase_<order_number>` | Navigateur + serveur |
| `CompleteRegistration` | `registration_<customer_id>` | Navigateur + serveur |
| Autres | UUID aléatoire par occurrence | Navigateur seul |

## Événements implémentés

| Événement | Déclencheur | Paramètres transmis |
| --- | --- | --- |
| `PageView` | Chargement et navigation client | — |
| `ViewContent` | Page produit | `content_ids`, `content_type`, `content_name`, `content_category`, `value`, `currency` |
| `AddToCart` | Ajout au panier (accueil et fiche produit) | `content_ids`, `contents`, `content_type`, `content_name`, `content_category`, `value`, `currency`, `num_items` |
| `InitiateCheckout` | Ouverture du tunnel de commande | `content_ids`, `contents`, `content_type`, `value`, `currency`, `num_items` |
| `Purchase` | Commande **enregistrée** (voir ci-dessous) | `content_ids`, `contents`, `content_type`, `value`, `currency`, `num_items`, `order_id` |
| `CompleteRegistration` | Création d'un compte client | `content_name`, `currency` |

Non implémentés faute de fonctionnalité correspondante dans la boutique : `Search`,
`AddToWishlist`, `AddPaymentInfo` (aucun paiement en ligne), `Lead`.

## `Purchase` : signal publicitaire, pas revenu comptable

**Décision validée : `Purchase` se déclenche à la commande passée**, pas à la confirmation ni à
la livraison.

Conséquence à garder en tête : ce chiffre **inclut** les commandes qui seront ensuite refusées,
annulées ou non livrées. Il sert uniquement à l'optimisation des campagnes.

Le revenu réellement reconnu suit la règle livré/encaissé et se calcule depuis la table `orders`
(et les tables financières de la phase 2), jamais depuis les événements Meta. Les deux chiffres
sont volontairement différents et ne doivent jamais être comparés directement.

## `content_ids` et catalogue

`content_id` = **slug produit** (`lib/meta/events.ts`, fonction `contentId`).

La phase 4 devra publier ce même slug comme `retailer_id` dans le catalogue Meta. Toute
divergence casse le rapprochement entre événements et catalogue.

Granularité retenue : **produit**, pas variante. La boutique applique un prix unique par produit
quelle que soit la couleur ou la taille ; des identifiants par variante ajouteraient des lignes
sans ajouter de signal.

## Données personnelles

`lib/meta/capi.ts` hache en SHA-256, après normalisation, les champs `em`, `ph`, `fn`, `ln`,
`ct`, `st`, `zp`, `country`, `external_id`.

Normalisation appliquée avant hachage, conforme à la documentation Meta (vérifiée le
2026-08-10) :

| Champ | Règle |
| --- | --- |
| Nom, prénom, e-mail | Minuscules, espaces en trop supprimés |
| Téléphone | Chiffres uniquement, sans `+`, sans zéro initial, indicatif pays obligatoire |
| Ville, région | Minuscules, **ni ponctuation ni espaces** (`Alger-Centre` → `algercentre`) |
| Code postal | Minuscules, sans espace ni tiret |
| Pays | Code ISO 3166-1 alpha-2 en minuscules |

Une normalisation incorrecte ne déclenche aucune erreur : elle dégrade silencieusement le taux
de correspondance. C'est pourquoi ces règles sont couvertes par des tests.

Transmis **non hachés**, car Meta l'exige : `fbp`, `fbc`, `client_ip_address`,
`client_user_agent`. Ces valeurs ne sont collectées qu'avec consentement.

Aucune donnée personnelle n'est stockée dans `meta_events` ni `meta_attribution`, et les
messages d'erreur passent par `redact()` avant d'être conservés.

## Robustesse

- Un échec de suivi **ne bloque jamais** la commande : l'envoi CAPI se fait dans `after()`, après
  la réponse HTTP, et toutes les erreurs sont absorbées.
- Nouvelles tentatives bornées (3) avec backoff, uniquement sur 429/500/502/503/504.
- `META_TRACKING_ENABLED` doit valoir `true` **et** la configuration doit être complète, sinon
  rien n'est envoyé.
- `META_TEST_EVENT_CODE` est ignoré en production.

## Tests

`npm run test:meta` — hachage, normalisation, redaction, déterminisme des `event_id`, et, si
`TEST_DATABASE_URL` est défini, les garanties de déduplication et d'idempotence en base.
