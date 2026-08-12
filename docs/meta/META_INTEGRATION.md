# Intégration Meta — vue d'ensemble

Point d'entrée de la documentation. Détails par domaine :
`EVENT_SPECIFICATION.md`, `CATALOG_SYNC.md`, `ADS_DATA_SYNC.md`,
`../analytics/METRICS_DICTIONARY.md`, `../analytics/ATTRIBUTION.md`,
`../analytics/FINANCIAL_MODEL.md`, `../privacy/TRACKING_AND_CONSENT.md`.

## Ce qui est en place

| Domaine | État |
| --- | --- |
| Pixel navigateur | `PageView`, `ViewContent`, `AddToCart`, `InitiateCheckout`, `Purchase`, `CompleteRegistration` |
| Conversions API | `Purchase` et `CompleteRegistration`, hachage SHA-256, tentatives bornées |
| Déduplication | `event_id` déterministe partagé, unicité en base, réclamation atomique |
| Consentement | Bannière first-party ; sans accord : ni Pixel, ni CAPI, ni attribution |
| Catalogue | `items_batch`, synchro complète et incrémentale, diagnostics par article |
| Ads Insights | 4 niveaux, quotidien, rafraîchissement 7 jours, backfill |
| Attribution | Premier et dernier contact, niveau canal |
| Rapprochement | 16 signalements typés |
| Rentabilité | Chaîne complète revenu → profit net, complétude explicite |
| Rétention | Purge configurable des données de suivi |
| Effacement | Anonymisation sur demande, comptabilité préservée |

## Architecture

```
Navigateur                        Serveur                         Meta
──────────                        ───────                         ────
StoreTracking (pages boutique)
  ├─ ConsentBanner ──── cookie lovelystep_consent
  ├─ MetaPixel ─────────────────────────────────────────────────► Pixel
  └─ AttributionTracker ── localStorage

POST /api/orders
  └─ createOrder ──► after() ─┬─ persistOrderAttribution
                              ├─ sendPurchaseEvent ── claim ────► CAPI
                              └─ dispatchDeliveryOrder

POST /api/cron/meta-sync (Bearer CRON_SECRET)
  ├─ syncRecentInsights ◄──────────────────────────────────────── Insights
  ├─ syncCatalog ──────────────────────────────────────────────► items_batch
  └─ applyRetention
```

Le suivi n'est monté que par les pages boutique (`app/store-tracking.tsx`), **jamais** par le
layout racine ni par l'administration.

## Variables d'environnement

Voir `.env.example`. Seul `NEXT_PUBLIC_META_PIXEL_ID` est exposé au navigateur ; tout le reste
reste serveur. `npm run security:test-client-secrets` le vérifie.

Le suivi ne démarre que si `META_TRACKING_ENABLED=true` **et** que l'administrateur ne l'a pas
désactivé depuis l'onglet Meta.

## Mise en production

1. Vérifier la version Graph API sur le changelog Meta et fixer `META_GRAPH_API_VERSION`.
2. Renseigner Pixel, jeton système, compte publicitaire, catalogue.
3. Vérifier le domaine dans Business Manager (nécessaire au matching iOS).
4. `NEXT_PUBLIC_SITE_URL` en HTTPS public : Meta doit atteindre liens et images du catalogue.
5. Tester avec `META_TEST_EVENT_CODE` **hors production** ; il est ignoré en production.
6. Onglet Meta → « Tester la connexion », puis « Synchroniser » catalogue et insights.
7. Vérifier le fuseau du compte publicitaire ; s'il diffère d'`Africa/Algiers`, documenter l'écart.
8. Saisir les taux de change si le compte n'est pas en DZD, sinon toutes les métriques de
   dépense resteront indisponibles — par choix, pas par bug.
9. Planifier `POST /api/cron/meta-sync` (quotidien) avec `Authorization: Bearer $CRON_SECRET`.
10. Passer `META_TRACKING_ENABLED=true`.

## Migrations et base de données

`ensureDatabase()` applique le schéma au premier accès en **runtime**. Un garde-fou empêche
toute migration pendant `next build` : une page qui lit la base pendant le build échoue avec un
message explicite plutôt que de migrer une base de production par accident.

**Ne jamais lire la base dans `app/layout.tsx`** : le layout racine enveloppe les routes
prérendues, donc `next build` exécuterait la lecture. C'est arrivé une fois.

## Fiabilité

- Un échec de suivi ne bloque jamais une commande : tout part dans `after()`.
- Tentatives bornées avec backoff ; un jeton expiré n'est jamais réessayé.
- `meta_events` sert de file d'attente morte : les envois échoués gardent leur statut et leur
  compteur de tentatives, et restent réclamables tant qu'ils n'ont pas abouti.
- `meta_sync_state` conserve le dernier succès même après un échec, pour afficher l'âge réel
  des données.
- Le rapprochement signale données périmées, événements manquants, coûts incomplets, articles
  refusés et identifiants expirés.

## Tests

| Commande | Portée | Base requise |
| --- | --- | --- |
| `npm run test:kpis` | 35 contrôles sur le moteur financier réel | non |
| `npm run test:attribution` | 18 contrôles attribution | non |
| `npm run test:integration` | 19 contrôles Meta simulés : pagination, quotas, jeton, fuseau, devise | non |
| `npm run test:all` | Les trois ci-dessus | non |
| `npm run test:finance` | Schéma financier | oui |
| `npm run test:meta` | Déduplication Pixel/CAPI | oui |
| `npm run test:meta-ads` | Insights et catalogue | oui |
| `npm run test:privacy` | Rétention et effacement | oui |

Les tests nécessitant une base créent un schéma temporaire `ls_*` et le suppriment ; ils ne
touchent jamais `public`. Fournir `TEST_DATABASE_URL`.
