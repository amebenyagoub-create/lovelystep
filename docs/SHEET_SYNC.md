# Synchronisation Google Sheets

Le Google Sheet est la file d'attente entre la boutique et l'agent de
confirmation. Tant qu'une commande n'y figure pas, l'agent ignore son existence :
aucun message, aucun colis, et le client n'entend rien.

## Les deux sens

| Sens | Ce qui circule | Déclencheur |
|---|---|---|
| Boutique → Sheet | une ligne par commande | à la commande, puis l'outbox |
| Sheet → Boutique | la colonne `state` réécrite par l'agent | le cron, et l'ouverture du tableau de bord |

## L'outbox

Trois colonnes sur `orders` :

- `sheet_synced_at` — `NULL` tant que la ligne n'est pas dans le Sheet. C'est la file.
- `sheet_attempts` — sert au recul progressif : la tentative *n* attend *n × 2* minutes.
- `sheet_last_error` — affiché tel quel dans le tableau de bord.

L'export est idempotent : `appendOrderToGoogleSheet` déduplique sur `order_id`,
donc rejouer l'outbox ne crée jamais de doublon.

## Le travail planifié

```
POST /api/cron/sheet-sync
Authorization: Bearer $CRON_SECRET
```

Toutes les **5 minutes**. Les deux moitiés — vider l'outbox, relire les états —
s'exécutent indépendamment : l'échec de l'une n'empêche pas l'autre.

Sans `CRON_SECRET` configuré, le endpoint reste **fermé** (401), jamais ouvert.

## Boutons dans le tableau de bord

- **Synchroniser Google Sheets** (onglet Commandes) : vide l'outbox immédiatement.
- **Réessayer l'export Sheets** : n'apparaît que sur une commande absente du Sheet.

## Surveillance

`GET /api/health` renvoie `503` si la plus ancienne commande en attente a plus
d'une heure — c'est-à-dire si le cron ne tourne plus. Les journaux à alerter
portent le préfixe `ACTION_REQUIRED.`.
