# Automatisation produit Meta

## Comportement

- Chaque enregistrement de produit déclenche une synchronisation incrémentale du catalogue si
  `META_AUTO_CATALOG_SYNC_ENABLED=true`.
- Le premier passage d'un produit de brouillon/archivé à `published` crée une publication photo
  si `META_AUTO_POST_ENABLED=true`.
- Modifier un produit déjà publié met le catalogue à jour sans créer un nouveau post.
- Archiver ou supprimer un produit le retire automatiquement du catalogue.
- Une panne Meta ne bloque jamais l'enregistrement du produit dans la boutique.
- Le cron Meta reste le filet de sécurité pour retenter la synchronisation du catalogue.

La table `meta_product_page_posts` revendique un produit avant l'appel Graph API. Sa clé primaire
sur `product_id` empêche deux enregistrements simultanés de créer deux publications. Les échecs
sont visibles dans l'onglet Meta avec un bouton `Réessayer`; une publication déjà réussie ne peut
pas être revendiquée.

## Variables Railway

```env
META_AUTO_CATALOG_SYNC_ENABLED=true
META_AUTO_POST_ENABLED=true
META_PAGE_ID=
META_PAGE_ACCESS_TOKEN=
```

`META_PAGE_ID` est l'identifiant numérique de la Page, pas celui du Business Portfolio.
`META_PAGE_ACCESS_TOKEN` doit être un jeton de Page et reste uniquement côté serveur.

## Permissions

- `pages_manage_posts` : création de la publication
- `pages_read_engagement` : dépendance Page requise par Meta
- `pages_show_list` : sélection de la Page et génération du jeton

`pages_manage_ads` ne permet pas de publier sur une Page.

## Publication produite

L'application appelle `POST /{page-id}/photos` avec l'image principale publique, un texte court,
le prix en DZD et le lien canonique `https://lovelystep.com/produits/{slug}`.
