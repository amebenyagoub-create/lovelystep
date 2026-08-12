# Synchronisation du catalogue produit Meta

État : phase 4. Endpoint utilisé : `POST /{META_CATALOG_ID}/items_batch` (vérifié le 2026-08-10).

## Aucune intégration officielle préexistante

Le dépôt a été audité : la boutique est un Next.js sur mesure, sans connecteur Shopify,
WooCommerce ou autre plateforme disposant d'une intégration Meta officielle. Il n'existe donc
aucun flux catalogue concurrent à réutiliser, et aucun risque de double suivi de ce côté.

## Identifiant produit

`id` = **slug produit**, via `contentId()` (`lib/meta/events.ts`).

C'est **le même identifiant** que celui envoyé dans `content_ids` par le Pixel et la CAPI. Toute
divergence empêcherait Meta de relier un événement à un produit du catalogue.

Un test structurel (`npm run test:meta-ads`) relit les sources et échoue si le catalogue ou l'un
des émetteurs d'événements cesse de passer par `contentId()`.

Granularité **produit**, pas variante : la boutique applique un prix unique par produit quelles
que soient la couleur et la taille.

## Champs envoyés

Obligatoires selon Meta : `id`, `title`, `description`, `availability`, `condition`, `price`,
`link`, `brand`, plus au moins une image.

| Champ | Source |
| --- | --- |
| `id` | `contentId(slug)` |
| `title` | `product.name` (100 caractères max) |
| `description` | `shortDescription`, sinon `description`, sinon `name` |
| `availability` | `in stock` / `out of stock` selon le stock total ; `discontinued` si archivé |
| `condition` | `new` |
| `price` | `"3490.00 DZD"` — montant à deux décimales, espace, code ISO 4217 |
| `sale_price` | Uniquement si `compareAtCents > priceCents` ; `price` porte alors l'ancien prix |
| `link` | `NEXT_PUBLIC_SITE_URL/produits/{slug}` |
| `image_link` | Première image, en URL absolue |
| `additional_image_link` | Jusqu'à 10 images supplémentaires |
| `brand` | `Lovely Step` |
| `product_type` | `product.category` |
| `color` | Couleurs déclarées du produit |

`gtin` et `mpn` **ne sont pas envoyés** : la boutique ne les stocke pas. Envoyer un identifiant
faux serait pire que de l'omettre.

## Cycle de vie

- **Publié** → `CREATE` la première fois, `UPDATE` ensuite (`allow_upsert: true`, donc un
  `CREATE` sur un `id` existant met à jour au lieu d'échouer).
- **Brouillon ou archivé** → `DELETE`, uniquement si l'article avait déjà été envoyé. Un produit
  non publié ne doit pas rester dans le catalogue publicitaire.
- **Inchangé** → ignoré. Un hachage SHA-256 du payload est stocké dans
  `meta_catalog_items.content_hash` ; une synchronisation incrémentale ne renvoie que les
  produits dont le contenu a réellement changé, ou ceux en erreur.
- **Synchronisation complète** : `{"target":"catalog","full":true}` force le renvoi de tout.

## Lots et diagnostics

Lots de **1000 articles** (Meta autorise 5000 et recommande 3000 ; des lots plus petits donnent
des erreurs par article plus lisibles). Limite de charge utile Meta : 28 Mo.

Meta signale les articles refusés dans `validation_status` **sans faire échouer le lot entier**.
Chaque refus est enregistré dans `meta_catalog_items.last_error` et l'article n'est pas marqué
comme synchronisé, donc il sera automatiquement retenté à la prochaine exécution.

`catalogQualityReport()` (exposé par `GET /api/admin/meta/status`) renvoie : nombre de produits
publiés, synchronisés, en échec, jamais synchronisés, et la liste des erreurs.

## Prérequis

- `META_CATALOG_ID`
- `META_ACCESS_TOKEN` avec la permission `catalog_management`
- `NEXT_PUBLIC_SITE_URL` en HTTPS public : Meta doit pouvoir atteindre les liens et les images.
  Les URL locales (`localhost`) produisent un catalogue invalide.

## Tests

`npm run test:meta-ads` — format de prix, valeurs d'énumération `availability` conformes à Meta,
stabilité du hachage, et cohérence structurelle entre `id` catalogue et `content_ids`.
