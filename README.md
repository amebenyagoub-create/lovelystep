# Lovely Step

Boutique locale Node.js/Next.js pour vêtements enfants, avec paiement à la livraison, catalogue SQLite, pages produit détaillées, comptes clients et dashboard administrateur.

Fonctions principales :

- boutique FR/EN/AR avec affichage RTL en arabe ;
- image produit associée à chaque couleur et stock par couleur/taille ;
- compte client sécurisé par téléphone et mot de passe ;
- sélection en cascade des 69 wilayas et 1 541 communes ;
- livraison à domicile ou au bureau avec tarif propre à chaque wilaya ;
- personnalisation de la façade, des textes et de la palette depuis l’administration ;
- export Excel de toutes les commandes ;
- connecteur générique pour l’API d’une société de livraison.

## Démarrage local

Prérequis : Node.js 22 ou plus récent.

```bash
npm install
npm run dev
```

Ouvrez `http://localhost:3000`. La première visite de `http://localhost:3000/admin` redirige vers `/admin/setup` afin de créer le compte propriétaire. Aucun identifiant par défaut n’est fourni.

Pour tester exactement le build de production local :

```bash
npm run build
npm start
```

## Import produit assisté par IA

Dans le dashboard, ouvrez **Import IA**, puis glissez-déposez :

1. les photos propres du produit à publier dans la boutique ;
2. une ou plusieurs captures d’écran de la fiche fournisseur 1688.

Gemini lit les captures et prépare un brouillon structuré : nom français, descriptions, prix fournisseur en RMB, MOQ, matière, couleurs et guide des tailles. Si Gemini est indisponible, Groq prend automatiquement le relais. Aucun prix de vente n’est inventé et le produit reste en brouillon jusqu’à votre vérification.

Les remarques provenant des avis fournisseur restent privées. Elles ne sont jamais présentées comme des témoignages de clients Lovely Step.

Configuration locale dans `.env.local` :

```env
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.6-flash
GROQ_API_KEY=
GROQ_MODEL=qwen/qwen3.6-27b
```

Les clés sont utilisées uniquement côté serveur et ne sont jamais envoyées au navigateur.

## Livraison et export Excel

Dans **Administration → Livraison**, renseignez les frais domicile/bureau de chaque wilaya. Le serveur recalcule toujours le total : le navigateur ne peut pas imposer son propre tarif.

Le bouton **Exporter Excel** dans les commandes produit un classeur `.xlsx` contenant client, téléphone, produit, couleur, taille, quantité, prix, frais de livraison, total, wilaya, commune, mode et adresse.

Pour un transporteur, configurez d’abord le connecteur dans le dashboard, puis placez la clé dans `.env.local` sous le nom choisi, par exemple :

```env
DELIVERY_API_TOKEN=
```

Pour remplir automatiquement les tarifs ZR Express, ajoutez également les deux variables serveur suivantes :

```env
ZREXPRESS_API_KEY=...
ZREXPRESS_TENANT_ID=...
```

Dans **Administration → Livraison**, cliquez ensuite sur **Synchroniser ZR Express**. LovelyStep appelle l’endpoint officiel `GET /api/v1/delivery-pricing/rates`, associe les tarifs `home` et `pickup-point` aux wilayas et convertit les montants DZD dans son format interne.

Le connecteur d’envoi des commandes ne doit être activé qu’après le test dédié du format colis ZR Express.

Le référentiel des adresses provient du projet MIT [Algeria-Cities](https://github.com/ihahachi/Algeria-Cities).

## Suppression d’arrière-plan des produits

Avant d’ajouter le fond crème et l’overlay Lovely Step, chaque photo produit passe par une suppression d’arrière-plan locale. Cette étape utilise Rembg sur le serveur : la photo n’est envoyée à aucun service tiers.

Installez le moteur une seule fois avec Python 3.11 à 3.13 :

```bash
npm run background:setup
```

Le modèle `isnet-general-use` est téléchargé au premier traitement puis conservé dans `data/background-removal-models/`. Ce premier traitement est donc plus long. Vous pouvez choisir un autre modèle avec `BACKGROUND_REMOVAL_MODEL` et préciser un exécutable Python avec `BACKGROUND_REMOVAL_PYTHON`.

## Données locales

- Base : `data/lovelystep.db`
- Images produit : `public/uploads/products/`
- Guides de tailles : `public/generated/size-guides/`

Ces chemins sont ignorés par Git. Sauvegardez-les avant toute migration.

## Vérifications IA

Vérification des clés et des modèles :

```bash
npm run ai:test-providers
```

Test complet sur une base séparée, avec une capture synthétique et un serveur lancé sur le port `3102` :

```bash
$env:TEST_BASE_URL="http://localhost:3102"
npm run ai:test-import
```

Tests du parcours commande et des nouvelles fonctions boutique :

```bash
npm run test:order-flow
npm run test:store-features
```

## Mise en production ultérieure

Avant une ouverture publique : configurez `NEXT_PUBLIC_SITE_URL=https://votre-domaine`, `COOKIE_SECURE=true`, un reverse proxy HTTPS, des sauvegardes chiffrées et un stockage d’images persistant. Pour plusieurs serveurs, remplacez SQLite par PostgreSQL et les fichiers locaux par un stockage objet compatible S3.

## Production avec Supabase

LovelyStep utilise PostgreSQL dès que `DATABASE_URL` est configurée. Dans Supabase, ouvrez **Connect**, choisissez **Session pooler** (port 5432) et placez cette URI dans Railway. Le mot de passe contenant des caractères spéciaux doit être encodé dans l’URI.

Variables Railway requises :

```env
DATABASE_URL=postgresql://postgres.PROJECT:mot-de-passe@aws-0-REGION.pooler.supabase.com:5432/postgres
DATABASE_POOL_SIZE=5
NEXT_PUBLIC_SUPABASE_URL=https://PROJECT.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
SUPABASE_STORAGE_BUCKET=product-media
```

La clé `SUPABASE_SECRET_KEY` est exclusivement serveur et ne doit jamais porter le préfixe `NEXT_PUBLIC_`. La clé publishable n’est pas nécessaire au fonctionnement actuel du store.

Pour migrer les données et médias locaux avant le basculement :

```powershell
npm run db:migrate:supabase
npm run media:migrate:supabase
```

Les scripts sont réexécutables : les lignes existantes sont conservées et les objets Storage sont mis à jour. Faites néanmoins une copie de `data/lovelystep.db` et des dossiers `public/uploads` / `public/generated` avant toute migration.

Commandes de contrôle :

```bash
npm run lint
npm run build
npm audit
```
