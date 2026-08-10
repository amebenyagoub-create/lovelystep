# Synchronisation des données publicitaires Meta

État : phase 4. Version Graph API épinglée : **v26.0** (courante au 2026-08-10).

## Ce qui est importé

`GET act_{AD_ACCOUNT}/insights` avec `time_increment=1` (une ligne par jour) aux quatre
niveaux : `account`, `campaign`, `adset`, `ad`.

Stockage dans `meta_ads_insights_daily`, clé unique `(date, level, entity_id)`.

Champs demandés : `spend`, `impressions`, `reach`, `frequency`, `clicks`,
`inline_link_clicks`, `unique_clicks`, `ctr`, `cpc`, `cpm`, `outbound_clicks`, `actions`,
`action_values`, `purchase_roas`, `video_thruplay_watched_actions`, `video_play_actions`,
`video_p25/50/75/100_watched_actions`, plus les identifiants et libellés de chaque niveau,
`objective`, `optimization_goal`, `attribution_setting`, `account_currency`.

## Règle non négociable : lecture par `action_type`

`actions` et `action_values` sont des tableaux d'objets `{action_type, value}`. Meta en modifie
l'ordre et en omet des entrées sans préavis.

**Toute lecture se fait par `action_type`**, jamais par position. Une entrée absente vaut `0`,
jamais la valeur voisine. C'est vérifié par `npm run test:meta-ads`, y compris avec un tableau
volontairement inversé.

Types utilisés, avec repli sur la variante préfixée Pixel :

| Métrique | `action_type` |
| --- | --- |
| Achats | `purchase`, sinon `offsite_conversion.fb_pixel_purchase` |
| Ajouts au panier | `add_to_cart`, sinon `offsite_conversion.fb_pixel_add_to_cart` |
| Checkouts | `initiate_checkout`, sinon `offsite_conversion.fb_pixel_initiate_checkout` |
| Prospects | `lead`, sinon `offsite_conversion.fb_pixel_lead` |
| Vues de page de destination | `landing_page_view` |
| Clics sortants | `outbound_click` |

## Devise et fuseau

Les montants sont stockés en **unités mineures entières** dans la devise du **compte
publicitaire** (colonne `currency`), pas en DZD.

Aucune conversion n'est faite à l'ingestion : convertir demanderait un taux daté, ce qui relève
de la couche de restitution. Si le compte publicitaire n'est pas en DZD, la conversion devra
être explicite et historisée avant tout calcul de profit mêlant dépense et revenu.

Les dates proviennent de `date_start`, donc du fuseau du compte publicitaire. Le fuseau de
restitution retenu pour la boutique est `Africa/Algiers`. **Si le compte publicitaire est réglé
sur un autre fuseau, les journées ne coïncident pas** : vérifier `timezone_name` via
« Tester la connexion » et documenter l'écart avant d'interpréter les comparaisons quotidiennes.

## Rafraîchissement et backfill

- **Incrémental** : `syncRecentInsights()` réimporte les **7 derniers jours** à chaque exécution.
  L'attribution Meta continue d'évoluer plusieurs jours après coup ; les upserts étant
  idempotents, un réimport corrige au lieu de dupliquer.
- **Backfill** : `backfillInsights(since, until)` découpe la plage en tranches de 30 jours pour
  ne pas dépasser le délai d'exécution.
- **Pagination** : suivi des URL absolues `paging.next`, avec un plafond `maxPages` (100) qui
  empêche une boucle infinie contre une API paginée.

## Limites de débit et jetons

`lib/meta/graph.ts` centralise le traitement :

- Codes 4, 17, 32, 613 et HTTP 429 → `MetaRateLimitError`, nouvelle tentative avec backoff long
  (5 s, 10 s, 20 s).
- Codes 102, 190, 463, 467 → `MetaTokenExpiredError`, **aucune nouvelle tentative** : un jeton
  expiré ne guérit pas en réessayant. L'endpoint cron renvoie alors HTTP 401 pour que le
  planificateur déclenche une alerte.
- Les erreurs passent par `redact()` avant journalisation.

## Déclenchement

| Usage | Appel |
| --- | --- |
| Planifié | `POST /api/cron/meta-sync` avec `Authorization: Bearer $CRON_SECRET` |
| Manuel (admin) | `POST /api/admin/meta/sync` avec `{"target":"insights"}` |
| Backfill (admin) | `POST /api/admin/meta/sync` avec `{"target":"backfill","since":"…","until":"…"}` |
| Diagnostic | `GET /api/admin/meta/status` |
| Test de connexion | `POST /api/admin/meta/test-connection` |

Le endpoint cron compare `CRON_SECRET` en temps constant. **Sans `CRON_SECRET` configuré, il
refuse tout appel** plutôt que de rester ouvert. Insights et catalogue s'exécutent
indépendamment : l'échec de l'un n'empêche pas l'autre.

## Fraîcheur des données

`meta_sync_state` conserve par tâche : dernière exécution, dernier succès, dernière erreur.

Un échec **n'efface pas** l'horodatage du dernier succès, ce qui permet d'afficher « données
vieilles de N heures » plutôt qu'un simple « erreur ».

## Tests

`npm run test:meta-ads` — lecture par `action_type` y compris tableau inversé, absence de
métrique renvoyant 0, conversion monétaire exacte en unités mineures, division par zéro,
upserts idempotents, niveaux distincts non collisionnés, conservation du dernier succès.
