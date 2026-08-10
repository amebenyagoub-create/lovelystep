# Suivi publicitaire et consentement

État : phase 3. Ce document décrit le comportement réellement implémenté.

## Modèle de consentement

Le consentement marketing est stocké dans un cookie first-party `lovelystep_consent`, avec trois
états : `granted`, `denied`, et **absent** (aucun choix exprimé).

**L'absence de cookie vaut refus.** Aucun suivi ne démarre avant un « Accepter » explicite.

### Ce qui se passe sans consentement

- Le script du Pixel **n'est pas inséré dans la page** : aucune requête vers Meta, aucun cookie
  `_fbp` ou `_fbc` créé.
- `trackMeta()` revérifie le consentement à chaque appel et ne fait rien s'il manque.
- Côté serveur, `metaRequestContext()` retourne `{ consentGranted: false }` et ne lit **ni** les
  cookies Meta, **ni** l'adresse IP, **ni** le user-agent.
- La Conversions API n'envoie rien : `sendServerEvent()` s'arrête sur `skipped: "no_consent"`.

La CAPI n'est donc pas un moyen de contourner le refus : le refus coupe les deux canaux.

### Retrait du consentement

Le composant réagit au changement de cookie via `useSyncExternalStore`. Un passage à `denied`
arrête immédiatement tout nouvel événement. Le script déjà chargé dans l'onglet courant ne peut
pas être déchargé — c'est pourquoi `trackMeta()` revérifie le consentement à chaque appel plutôt
que de se fier au montage initial.

## Données transmises à Meta

Uniquement avec consentement, et uniquement lors d'un achat ou d'une création de compte.

| Donnée | Traitement |
| --- | --- |
| Téléphone, prénom, nom, commune, wilaya, pays, id client | **SHA-256 après normalisation** |
| `_fbp`, `_fbc` | Transmis tels quels (exigence Meta) |
| Adresse IP, user-agent | Transmis tels quels (exigence Meta) |
| Montant, devise, produits, numéro de commande | Transmis tels quels |

Aucun e-mail n'est transmis : la boutique n'en collecte pas auprès des clients.

## Minimisation et journalisation

- `meta_events` ne contient que des identifiants techniques, des horodatages et des statuts.
- `meta_attribution` ne contient que des identifiants de clic et des paramètres de campagne.
- Aucune table de suivi ne comporte de colonne e-mail, téléphone, nom ou adresse — c'est vérifié
  automatiquement par `npm run test:meta`.
- `redact()` retire e-mails, numéros, empreintes et jetons de tout message d'erreur conservé.
- Le jeton `META_ACCESS_TOKEN` reste strictement serveur ; son absence des bundles client est
  vérifiée par `npm run security:test-client-secrets`.

## Points nécessitant une revue juridique

Ces éléments sortent de la compétence technique et doivent être validés avant l'ouverture
publique :

1. **Base légale et texte applicable.** La rédaction actuelle de la bannière suppose un
   consentement préalable de type RGPD. La loi algérienne 18-07 relative à la protection des
   personnes physiques dans le traitement des données à caractère personnel doit être vérifiée
   par un conseil qualifié, en particulier si la boutique cible aussi des résidents de l'UE.
2. **Réutilisation des données de livraison.** Le téléphone et l'adresse sont collectés pour
   livrer ; leur réutilisation (même hachée) à des fins de mesure publicitaire est un finalité
   distincte qui doit être couverte par la politique de confidentialité.
3. **Durées de conservation.** Les valeurs par défaut (ci-dessous) sont un choix technique, pas
   un avis juridique : elles doivent être validées au regard du droit applicable.
4. **Mentions obligatoires.** Politique de confidentialité et information sur les cookies à
   publier avant la mise en production.

## Rétention

Purge automatique à chaque exécution de `POST /api/cron/meta-sync`, configurable :

| Donnée | Variable | Défaut |
| --- | --- | --- |
| Visites | `RETENTION_VISITS_DAYS` | 180 jours |
| Événements Meta | `RETENTION_META_EVENTS_DAYS` | 180 jours |
| Attribution | `RETENTION_ATTRIBUTION_DAYS` | 400 jours |

**Les données comptables ne sont jamais purgées** : commandes, remboursements, coûts et charges
sont des pièces comptables soumises à leurs propres obligations de conservation. La purge ne
touche que les données de suivi et de comportement. Un test le vérifie.

## Droit à l'effacement

`POST /api/admin/privacy/erase` avec `{ "phone": "...", "confirm": true }` (admin, CSRF requis).

Ce que fait l'effacement :

- écrase nom, prénom, téléphone, adresse, commune, notes et empreinte du mot de passe, chez le
  client **et** sur ses commandes ;
- révoque ses sessions, sinon un jeton existant continuerait à l'authentifier ;
- supprime ses lignes d'attribution : un identifiant de clic est une donnée personnelle.

Ce que l'effacement **conserve délibérément** : la commande elle-même, ses montants, son statut
et sa date. Les supprimer corromprait la comptabilité et fausserait rétroactivement tous les
indicateurs historiques.

Le téléphone est remplacé par un **jeton unique par personne**, jamais par une valeur constante :
sinon toutes les personnes effacées fusionneraient en un seul « client » et gonfleraient le taux
de réachat.

L'opération est irréversible et exige `confirm: true`. Le journal d'audit enregistre qu'un
effacement a eu lieu, jamais le numéro effacé.

Vérifié par `npm run test:privacy` : champs personnels irrécupérables, montants intacts,
sessions révoquées, attribution supprimée.

## Tests

- `npm run test:meta` — hachage, redaction, absence de données personnelles en base.
- `npm run security:test-client-secrets` — aucun secret serveur exposé au navigateur.
