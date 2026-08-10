# Modèle financier

État : phase 5. Voir `METRICS_DICTIONARY.md` pour la définition de chaque métrique.

## Représentation monétaire

Tous les montants sont des **entiers en unités mineures** (centimes DZD), en base comme en
mémoire. Aucun calcul monétaire n'utilise de flottant.

Les colonnes monétaires sont en `BIGINT`. Les ratios (marge, CTR, taux de change, ROAS) sont en
`NUMERIC`, jamais utilisés comme montants.

Les divisions produisant un montant sont arrondies une seule fois, à la fin
(`perUnitMinor`). Un test vérifie qu'aucune métrique monétaire ne renvoie de non-entier.

## Chaîne de profit

```
Ventes brutes            Σ subtotal_cents (commandes livrées)
+ Revenu livraison       Σ shipping_cents
− Remboursements         Σ order_refunds.amount_cents
─────────────────────────
= Revenu net

− COGS                   Σ unitCostCents × quantité (figé à la commande)
─────────────────────────
= Profit brut

− Coûts variables        coût transporteur + frais de retour réels
─────────────────────────
= Contribution avant publicité

− Dépense publicitaire   meta_ads_insights_daily, converti en DZD
─────────────────────────
= Contribution après publicité

− Charges d'exploitation expenses, proratisées
─────────────────────────
= Profit net
```

## Sources de vérité

| Donnée | Source | Jamais |
| --- | --- | --- |
| Revenu | `orders` (livrées) | Jamais Meta |
| COGS | Instantané `unitCostCents` dans la commande | Jamais le coût courant du produit |
| Coût de livraison réel | `order_delivery_costs` | Jamais le tarif facturé au client |
| Dépense publicitaire | `meta_ads_insights_daily` converti | Jamais saisie à la main |
| Charges | `expenses` | |

**Meta n'est source de vérité que pour la dépense publicitaire et sa propre attribution.**
Jamais pour le revenu ni le profit.

## Pourquoi le coût est figé à la commande

`orders.items_json` contient `unitCostCents` au moment de la commande. Modifier le coût d'un
produit aujourd'hui **ne change pas** la marge des commandes passées.

`product_costs` conserve en parallèle l'historique daté des coûts (périodes fermées par
`effective_to`), pour les analyses hors commande.

Vérifié par `npm run test:finance` : après un changement de coût, l'instantané de la commande
reste inchangé et la période historique est fermée plutôt qu'écrasée.

## Double comptage

Les mécanismes en place :

- **Remboursements** : `order_refunds` est la seule source ; la somme ne peut pas dépasser le
  total de la commande (contrôle transactionnel avec `FOR UPDATE`), et la contrainte
  `amount_cents > 0` interdit les lignes nulles ou négatives.
- **Coûts de livraison** : clé primaire sur `order_id`, donc un `upsert` remplace au lieu
  d'ajouter une seconde ligne.
- **Dépense publicitaire** : clé unique `(date, level, entity_id)`. Seul le niveau `account`
  alimente les totaux, pour ne pas additionner campagne + adset + ad sur la même dépense.
- **Charges** : les récurrentes sont proratisées sur le chevauchement réel ; une charge dont la
  période est terminée ne contribue plus.

## Données manquantes

Une donnée absente n'est **jamais** traitée comme zéro. Le rapport de complétude indique :

- le nombre de commandes livrées sans coût produit ;
- le nombre de commandes livrées sans coût de livraison réel ;
- si la dépense publicitaire a pu être convertie.

Chaque note précise le **sens de l'erreur** (« le profit brut est surestimé »), pour qu'un
chiffre incomplet ne soit jamais lu comme un chiffre fiable.

Quand la dépense n'est pas convertible, toutes les métriques qui en dépendent valent `null`.
Celles qui n'en dépendent pas (revenu net, profit brut, marge brute) restent disponibles.

## Devise

Devise de restitution : **DZD**. Le compte publicitaire Meta est libellé dans une autre devise.

La dépense est stockée dans la devise d'origine (`meta_ads_insights_daily.currency`) et
convertie au moment du calcul avec le taux du jour (`fx_rates.dzd_per_unit`). Les devises
d'origine et les taux historiques sont conservés : un recalcul passé donne le même résultat.

Les taux se saisissent via `POST /api/admin/finance/fx-rates` (unitaire ou par lot).

## Fuseau

`Africa/Algiers` (UTC+1 fixe, pas d'heure d'été).

**Attention** : les dates d'insights proviennent du fuseau du compte publicitaire Meta. S'il
diffère, les journées ne coïncident pas exactement. Vérifier `timezone_name` via
« Tester la connexion » et documenter l'écart.

## Tests

| Commande | Portée |
| --- | --- |
| `npm run test:kpis` | 35 contrôles sur le moteur réel : chaque formule, division par zéro, données manquantes, proratisation |
| `npm run test:finance` | Schéma financier : historique de statuts, coûts datés, remboursements partiels, cascades |

Les tests KPI importent directement `lib/finance/*.ts` : ils exercent le code réel, pas une
copie. Leur capacité à détecter une régression a été vérifiée par mutation (COGS manquant
traité comme zéro, refus avant expédition imputé au transporteur, division non protégée) : les
trois sont bien détectées.
