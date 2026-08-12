# Attribution et rapprochement

État : phase 6. Implémentation : `lib/meta/attribution.ts`, `lib/meta/persist-attribution.ts`,
`lib/meta/reconciliation.ts`, `attributedTotals()` dans `lib/finance/kpis.ts`.
Tests : `npm run test:attribution` (18 contrôles sur le code réel).

## Deux perspectives, jamais fusionnées

| | Attribution Meta | Attribution boutique |
| --- | --- | --- |
| Qui compte | Meta | LovelyStep |
| Déclencheur | Événement `Purchase` = **commande passée** | Commande **livrée** |
| Fenêtres | Fenêtres d'attribution Meta (clic/vue) | Dernier ou premier contact enregistré |
| Source | `meta_ads_insights_daily` | `meta_attribution` + `orders` |
| Métrique | `ROAS déclaré par Meta` | `ROAS attribué boutique`, `POAS` |

**Un écart entre les deux est normal, pas un bug.** Il s'explique par :

- Meta compte à la commande passée, la boutique au livré : toutes les commandes non
  confirmées, refusées ou non livrées creusent l'écart ;
- Meta attribue aussi des achats après une simple **vue** d'annonce, sans clic, que la boutique
  ne peut pas voir ;
- les visiteurs ayant **refusé le consentement** ne génèrent aucune donnée d'attribution côté
  boutique, alors que Meta peut tout de même leur attribuer une conversion ;
- Meta réattribue rétroactivement pendant plusieurs jours.

Le rapport de rapprochement signale un écart supérieur à 30 % en `info`, pas en erreur :
l'objectif est de l'expliquer, pas de le supprimer.

## Capture des contacts

Un « contact » n'est enregistré que s'il porte un signal de campagne : `fbclid`, `utm_source`,
`utm_medium` ou `utm_campaign`. À défaut, un référent externe compte aussi.

**Une navigation interne n'est jamais un contact.** Sans cette règle, parcourir la boutique
écraserait la campagne qui a amené le visiteur. C'est vérifié par test, et par mutation.

Champs capturés : `fbclid`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`,
`utm_term`, page d'atterrissage, référent, horodatage.

Stockage navigateur : `localStorage` (clé `lovelystep_attribution`), et non un cookie, pour ne
pas transmettre ces données à chaque requête. Elles ne sont lues qu'une fois, à la commande.

**Aucune capture sans consentement marketing.** Le composant ne fait rien tant que le
consentement n'est pas accordé.

### Premier et dernier contact

- **Premier contact** : écrit une seule fois, jamais écrasé.
- **Dernier contact** : avancé à chaque nouveau contact porteur de campagne.

Modèle par défaut : **dernier contact**. Le paramètre `?model=first` bascule sur le premier
contact.

## Qu'est-ce qu'un contact « Meta »

Par ordre de fiabilité :

1. **`fbclid` présent** → Meta. Le paramètre est ajouté par Meta lui-même.
2. **Cookie `_fbc` présent** côté serveur → Meta. Ce cookie n'existe que parce qu'un clic Meta
   l'a créé. Sert de filet si `localStorage` était indisponible.
3. **`utm_source`** valant `facebook`, `instagram`, `meta`, `fb` ou `ig` → Meta. Signal
   secondaire : l'annonceur contrôle cette valeur, elle peut être mal saisie ou usurpée.

## Limite importante : granularité

L'attribution boutique fonctionne au niveau **canal** (« cette commande vient de Meta »), pas au
niveau annonce.

`fbclid` **ne contient pas** l'identifiant de campagne, d'ad set ou d'annonce. Attribuer une
commande à une annonce précise n'est possible que si les URL de destination portent des UTM
renseignés (`utm_campaign`, `utm_content`). Sans cela, `ROAS attribué boutique` reste un
chiffre global Meta, non ventilable par campagne.

Pour obtenir la ventilation, configurer dans Meta Ads Manager des paramètres d'URL du type :

```
utm_source=facebook&utm_medium=cpc&utm_campaign={{campaign.name}}&utm_content={{ad.name}}
```

## Cohérence des coûts

`attributedTotals()` réutilise **exactement** les mêmes fonctions de coût que le calcul de
profit global. Une marge attribuée ne peut donc pas contredire la marge d'ensemble.

Si une commande attribuée manque de coût produit ou de coût de livraison, la contribution
attribuée vaut `null` — jamais un chiffre gonflé. Le revenu attribué reste connu et affiché.

## Rapprochement

`GET /api/admin/meta/reconciliation?since=…&until=…` compare et signale.

Éléments rapprochés : commandes passées, confirmées, livrées ; événements Purchase envoyés
(Pixel seul, CAPI seule, dédupliqués, en échec) ; achats et valeur déclarés par Meta ; commandes
et revenu attribués par la boutique ; dépense importée.

Signalements produits :

| Code | Gravité | Sens |
| --- | --- | --- |
| `missing_purchase_events` | avertissement / erreur | Moins d'événements que de commandes. Cause normale : refus de consentement |
| `duplicate_purchase_events` | erreur | Plus d'événements que de commandes : déduplication à vérifier |
| `pixel_never_paired` | avertissement | Aucun achat vu par les deux canaux |
| `capi_failures` | avertissement | Envois CAPI en échec |
| `low_attribution_coverage` | info | Moins de la moitié des commandes livrées ont une attribution |
| `attribution_gap` | info | Écart Meta / boutique supérieur à 30 % |
| `sync_never_succeeded` | erreur | Une synchronisation n'a jamais abouti |
| `sync_stale` / `sync_aging` | erreur / avertissement | Données de plus de 48 h / 26 h |
| `sync_error` | avertissement | Dernière erreur de synchronisation |
| `no_spend_data` | avertissement | Aucune dépense importée sur la période |
| `missing_fx_rate` | erreur | Taux de change manquant : métriques de dépense indisponibles |
| `mixed_currencies` | avertissement | Plusieurs devises de dépense sur la période |
| `tracking_disabled` | info | `META_TRACKING_ENABLED` inactif |
| `test_events_active` | avertissement | Code Test Events actif : conversions non réelles |
| `incomplete_costs` | avertissement | Coût produit ou de livraison manquant |
| `catalog_failures` | avertissement | Produits refusés par le catalogue |

## Données personnelles

`meta_attribution` ne contient **aucune** donnée personnelle : uniquement des identifiants de
clic et des paramètres de campagne. Un test automatisé échoue si une colonne de type e-mail,
téléphone, nom ou adresse y apparaît.

La charge utile d'attribution envoyée par le navigateur est **non fiable par nature** : chaque
champ est typé, borné en longueur, et les horodatages aberrants sont rejetés avant insertion.

Une seule ligne par commande (`order_id` unique) : un renvoi met à jour au lieu de créer un
doublon.
