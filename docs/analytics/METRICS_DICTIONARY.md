# Dictionnaire des métriques

État : phase 5. Implémentation : `lib/finance/kpis.ts`. Tests : `npm run test:kpis` (35 contrôles
sur le moteur réel).

## Conventions générales

Sauf mention contraire, elles s'appliquent à **toutes** les métriques ci-dessous.

| Convention | Valeur |
| --- | --- |
| Devise de restitution | **DZD**, en unités mineures entières (centimes). Aucun flottant. |
| Fuseau de restitution | **Africa/Algiers** (UTC+1 fixe, pas d'heure d'été) |
| Revenu reconnu | Commandes au statut **`delivered`** uniquement |
| Statuts exclus du revenu | `new`, `to_confirm`, `confirmed`, `preparing`, `shipped`, `refused`, `returned`, `cancelled` |
| Division par zéro | Renvoie **`null`**, jamais `Infinity`, `NaN` ni un `0` trompeur |
| Donnée manquante | **Jamais assimilée à zéro** : signalée dans le rapport de complétude |
| Fraîcheur | Commandes en temps réel ; dépense publicitaire selon `meta_sync_state` |

### Reconnaissance du revenu, et pourquoi elle diffère de Meta

L'événement Meta `Purchase` se déclenche à la **commande passée**, pour optimiser les
campagnes. Le revenu comptable ne reconnaît que le **livré**.

Ces deux chiffres sont volontairement différents et **ne doivent jamais être comparés
directement** : l'écart correspond aux commandes non confirmées, refusées, annulées ou non
livrées.

## Revenu et profit

| Métrique | Formule | Source |
| --- | --- | --- |
| Nombre de commandes | Toutes commandes de la période, tous statuts | `orders` |
| Commandes valides | Commandes `delivered` | `orders.status` |
| Ventes brutes | Σ `subtotal_cents` des commandes livrées | `orders` |
| Revenu livraison | Σ `shipping_cents` des commandes livrées | `orders` |
| Remboursements | Σ `order_refunds.amount_cents` | `order_refunds` |
| Remises | **Toujours 0** — la boutique n'a aucun mécanisme de remise | — |
| Revenu net | Ventes brutes + revenu livraison − remboursements | calculé |
| COGS | Σ `unitCostCents × quantity` figé à la commande | `orders.items_json` |
| Profit brut | Revenu net − COGS | calculé |
| Marge brute | Profit brut / Revenu net | calculé |
| Coûts variables | Coût transporteur réel + frais de retour | `order_delivery_costs` |
| Profit de contribution avant pub | Revenu net − COGS − coûts variables | calculé |
| Profit de contribution après pub | Contribution avant pub − dépense publicitaire | calculé |
| Charges d'exploitation | Ponctuelles en totalité ; récurrentes au prorata des jours | `expenses` |
| Profit net | Contribution après pub − charges d'exploitation | calculé |
| Marge nette | Profit net / Revenu net | calculé |
| Capital investi | COGS + dépense publicitaire | **définition validée** |
| ROI | Profit net / Capital investi | **définition validée** |
| AOV | Revenu net / commandes valides | calculé |
| Profit par commande | Profit net / commandes valides | calculé |
| Upsell (commandes) | Commandes livrées à plus d'une ligne | **définition validée** |
| Revenu upsell | Σ des lignes **au-delà de la première** | **définition validée** |
| ROAS de rentabilité | 1 / (contribution avant pub / revenu net) | calculé |

**Pas de frais de paiement** : la boutique est exclusivement en paiement à la livraison. Aucun
frais de passerelle, aucun rétrofacturation.

**ROAS de rentabilité** vaut `null` si la marge de contribution est nulle ou négative : il n'y a
alors aucun seuil de rentabilité atteignable, et afficher un nombre serait trompeur.

**Charges récurrentes** : le montant saisi est interprété comme **mensuel** et réparti à raison
de `montant / 30 × jours de chevauchement`.

## Publicité

| Métrique | Formule | Remarque |
| --- | --- | --- |
| Dépense | Σ `spend_minor` converti en DZD | `null` si un taux de change manque |
| ROAS déclaré par Meta | Valeur d'achat attribuée par Meta / dépense | Attribution **Meta** |
| ROAS attribué boutique | Revenu net **livré et attribué Meta** / dépense | Attribution **boutique** (phase 6) |
| MER | Revenu net **total** boutique / dépense totale | N'utilise aucune attribution |
| POAS | Contribution attribuée / dépense | `null` si un coût manque sur une commande attribuée |
| CPA | Dépense / commandes attribuées boutique | Cohérent avec le ROAS boutique |

Les deux ROAS sont **délibérément séparés** et jamais fusionnés : ils répondent à des questions
différentes. Voir `ATTRIBUTION.md` pour les causes normales d'écart et la limite de
granularité (attribution au niveau canal, pas au niveau annonce, sans UTM configurés).

### Métriques d'exposition

Impressions, couverture, répétition, clics, clics sur lien, clics sortants, clics uniques, CTR,
CPC, CPM, vues de page de destination, vues de vidéo, ThruPlays et rétention vidéo proviennent
directement de `meta_ads_insights_daily` (voir `ADS_DATA_SYNC.md`).

**Landing Rate, Traffic Quality, Hook Rate et Hold Rate ne sont pas implémentés.** Ces libellés
n'ont pas de définition Meta standard et ne doivent pas être déduits de leur nom. Les données
brutes nécessaires sont stockées ; les formules restent à valider. Définitions candidates, **non
implémentées** :

- Landing Rate = vues de page de destination / clics sur lien
- Traffic Quality = vues de page de destination / clics (toutes destinations)
- Hook Rate = vues vidéo à 3 s / impressions
- Hold Rate = ThruPlays / vues vidéo à 3 s

## Clients

| Métrique | Formule | Remarque |
| --- | --- | --- |
| Acheteurs uniques | Téléphones distincts sur commandes livrées | Le téléphone identifie le client : la commande invité est possible |
| Nouveaux acheteurs | Acheteurs sans commande livrée **avant** la période | |
| Acheteurs fidèles | Acheteurs uniques − nouveaux acheteurs | |
| Taux d'acquisition | Nouveaux acheteurs / acheteurs uniques | |
| Taux de réachat | Clients à ≥ 2 commandes / clients à ≥ 1 commande | Sur **tout l'historique** |
| Fréquence d'achat | Commandes valides / acheteurs uniques | |
| Délai médian au 2ᵉ achat | Médiane des écarts 1ʳᵉ → 2ᵉ commande | En jours |
| Valeur client moyenne | Revenu net / acheteurs uniques | |
| Profit par client | Profit net / acheteurs uniques | |
| CAC | Dépense publicitaire / **nouveaux** acheteurs | Diviser par tous les acheteurs sous-estimerait le coût |
| LTV:CAC | Valeur client moyenne / CAC | |

**LTV réalisée à 30/60/90/180/365 jours et cohortes : non implémentées** (phase 6). Aucune valeur
projetée n'est présentée comme une LTV réelle.

## Paiement à la livraison

| Métrique | Formule |
| --- | --- |
| Commandes passées / confirmées / expédiées / livrées / retournées / annulées | Comptages par statut et historique |
| Taux de confirmation | Confirmées / commandes ayant reçu une décision (les commandes en attente sont **exclues**) |
| Taux de livraison | Livrées / expédiées |
| Taux de retour | Retournées / expédiées |
| Taux d'échec de livraison | Refusées **après expédition** / expédiées |
| **Performance de confirmation** | Confirmées / traitées, **par agent** (définition validée) |
| **Performance de livraison** | Livrées / (livrées + retournées + échecs), **commandes expédiées uniquement** (définition validée) |
| Délai médian de confirmation | Médiane commande → confirmation, en heures |
| Délai médian de livraison | Médiane expédition → livraison, en jours |
| Revenu livraison | Σ `shipping_cents` des commandes livrées |
| Coût transporteur sortant | Σ `carrier_cost_cents` |
| Coût de retour | Σ `return_cost_cents` |
| Écart sur frais de livraison | Revenu livraison − coût sortant − coût de retour |
| Écart par commande livrée | Écart / commandes livrées |

**Point important sur la performance de livraison** : une commande `refused` **avant**
expédition est un échec de *confirmation*, pas de *livraison*. Elle est exclue du dénominateur,
sinon la performance du transporteur serait mécaniquement sous-évaluée. La distinction repose
sur `order_status_history`.

**Performance de confirmation par agent** : chaque transition `confirmed` ou `refused` est
attribuée à l'administrateur qui l'a effectuée (`order_status_history.changed_by_admin_id`).
Les transitions antérieures à la phase 2 n'ont pas toujours d'agent : elles apparaissent sous
`adminId: null`.

## Complétude financière

Une période n'est **complète** que si les trois conditions sont réunies :

1. aucune commande livrée sans coût produit ;
2. aucune commande livrée sans coût de livraison réel ;
3. dépense publicitaire intégralement convertie en DZD.

Sinon, `completeness.complete = false` et `completeness.notes` précise ce qui manque et dans
quel sens le chiffre est faussé (par exemple « le profit brut est surestimé »).

## Conversion de devise

Le compte publicitaire Meta n'est **pas** libellé en DZD. Chaque ligne de dépense est convertie
avec le taux du **jour concerné** (`fx_rates`).

Un taux manquant **n'est jamais remplacé par 1,0 ni par 0**. La conversion renvoie `null`, et
toutes les métriques dépendant de la dépense (contribution après pub, profit net, ROI, capital,
CAC, ROAS, MER, POAS, CPA) deviennent `null`. Un total partiel sous-estimerait le coût et
gonflerait le profit : c'est précisément ce que ce mécanisme empêche.

## Limites connues

- Le client est identifié par **téléphone**, pas par compte : deux personnes partageant un
  numéro sont comptées comme une seule.
- Les charges récurrentes sont traitées comme **mensuelles** et proratisées sur 30 jours.
- L'attribution boutique est au niveau **canal**, pas au niveau annonce, tant que les UTM ne
  sont pas configurés dans Ads Manager (voir `ATTRIBUTION.md`).
- Les commandes des visiteurs ayant refusé le consentement n'ont **aucune** attribution : le
  ROAS boutique est donc structurellement sous-estimé par rapport au ROAS Meta.
- LTV réalisée par cohorte (30/60/90/180/365 jours) : non implémentée.
- Les métriques par variante n'existent pas : le catalogue et les événements sont au niveau
  produit.
