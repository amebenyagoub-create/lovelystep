# Lovely Step

Boutique Node.js/Next.js pour vêtements enfants, avec paiement à la livraison, catalogue PostgreSQL, pages produit détaillées, comptes clients et dashboard administrateur.

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
Copiez `.env.example` vers `.env.local` et renseignez la connexion PostgreSQL avant de démarrer.

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

## Production avec Aiven PostgreSQL

Dans **Connection information** de la console Aiven, copiez l’URI du service et téléchargez le certificat CA. Collez le contenu PEM du certificat dans `DATABASE_CA_CERT` pour vérifier le certificat et le nom d’hôte PostgreSQL. Sur Railway, ces variables s’appliquent au service web `lovelystep`.

Variables PostgreSQL du service web

```env
DATABASE_URL=postgresql://avnadmin:mot-de-passe@HOTE:PORT/defaultdb?sslmode=require
DATABASE_CA_CERT="-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"
DATABASE_POOL_SIZE=5
```

Le stockage des images produit utilise Supabase Storage. Configurez les variables suivantes sur le même service.

```env
NEXT_PUBLIC_SUPABASE_URL=https://PROJECT.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...
SUPABASE_STORAGE_BUCKET=product-media
```

La clé `SUPABASE_SECRET_KEY` est exclusivement serveur et ne doit jamais porter le préfixe `NEXT_PUBLIC_`. La clé publishable n’est pas nécessaire au fonctionnement actuel du store.

Pour importer une ancienne base SQLite ou des fichiers médias locaux :

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
