import type { CampaignDecision, CampaignKpis, CampaignThresholds, CampaignTrend, DecisionConfidence } from "./types";

const money = (minor: number | null) => minor === null ? "unavailable" : `${Math.round(minor / 100).toLocaleString("en-US")} DZD`;
const atLeast = (value: number | null, threshold: number) => value !== null && value >= threshold;
const below = (value: number | null, threshold: number) => value !== null && value < threshold;
const pct = (value: number | null) => value === null ? "—" : `${Math.round(value)}%`;
/** Une recommandation utile dit quoi faire, dans quel ordre, et avec quel chiffre s'arreter. */
const steps = (intro: string, actions: string[]) => `${intro} ${actions.map((action, index) => `${index + 1}) ${action}`).join(" ")}`;

function confidence(kpis: CampaignKpis, thresholds: CampaignThresholds): DecisionConfidence {
  if (!kpis.completeness.complete) return "low";
  if (kpis.cod.delivered >= thresholds.minimumDeliveredOrdersForHighConfidence && kpis.cod.deliveryOutcomes >= thresholds.minimumResolvedOrdersForDecision) return "high";
  if (kpis.funnel.storeOrders >= thresholds.minimumOrdersForDecision || kpis.advertising.purchases >= thresholds.minimumOrdersForDecision) return "medium";
  return "low";
}

/**
 * Deterministic decision authority. AI output is deliberately absent from this signature,
 * making it impossible for the explanation layer to override the business result.
 */
export function decideCampaign(kpis: CampaignKpis, trend: CampaignTrend, thresholds: CampaignThresholds): CampaignDecision {
  const resultConfidence = confidence(kpis, thresholds);
  const targetOrderCpa = kpis.economics.targetOrderCpaMinor;
  const targetDeliveredCpa = kpis.economics.targetDeliveredCpaMinor;
  const selectedCpa = kpis.economics.selectedCpaMinor;
  const spend = kpis.advertising.spendMinor;
  const resolved = kpis.cod.confirmationOutcomes + kpis.cod.deliveryOutcomes;
  const enoughOrders = Math.max(kpis.funnel.storeOrders, kpis.advertising.purchases) >= thresholds.minimumOrdersForDecision;
  const enoughOutcomes = resolved >= thresholds.minimumResolvedOrdersForDecision;
  const enoughSpend = spend !== null && targetOrderCpa !== null && spend >= targetOrderCpa * thresholds.minimumSpendToTargetCpaRatio;
  const evidence = [
    `Spend: ${money(spend)}.`,
    `Selected delivered CPA: ${money(selectedCpa)}; target: ${money(targetDeliveredCpa)}.`,
    `Net profit (${kpis.mode}): ${money(kpis.economics.selectedNetProfitMinor)}.`,
    `Confirmation ${kpis.cod.confirmationRatePercent ?? "—"}% · delivery ${kpis.cod.deliveryRatePercent ?? "—"}%.`,
  ];

  if (!kpis.completeness.spendConverted) {
    return { status: "WATCH", confidence: "low", reasonCode: "MISSING_SPEND_FX", evidence, recommendation: "Add the missing dated FX rate before changing campaign budget." };
  }
  if (targetOrderCpa === null || targetDeliveredCpa === null) {
    return { status: "WATCH", confidence: "low", reasonCode: "MISSING_UNIT_ECONOMICS", evidence, recommendation: "Complete product and delivery costs so the engine can calculate a safe target CPA." };
  }

  const maxSpendWithoutPurchase = targetOrderCpa * thresholds.maxSpendWithoutPurchaseMultiplier;
  if (kpis.advertising.purchases === 0 && kpis.funnel.storeOrders === 0 && spend !== null && spend >= maxSpendWithoutPurchase) {
    return {
      status: "KILL", confidence: resultConfidence === "low" ? "medium" : resultConfidence, reasonCode: "SPEND_WITHOUT_PURCHASE",
      evidence: [...evidence, `No purchase after the ${money(Math.round(maxSpendWithoutPurchase))} maximum-spend limit.`],
      recommendation: steps(
        `Mettez la campagne en pause : ${money(spend)} depenses sans une seule vente, au-dela de la limite de ${money(Math.round(maxSpendWithoutPurchase))}, ce n'est plus du hasard. Verifiez dans cet ordre, du plus frequent au plus rare :`,
        [
          "Le suivi : comparez les achats comptes par Meta aux commandes reellement recues sur la meme periode. Un ecart total veut dire que le pixel ne remonte pas, et que la campagne marche peut-etre sans que vous le voyiez.",
          "Le parcours mobile : ouvrez la publicite depuis votre telephone, allez jusqu'a valider une commande. Un champ qui zoome, une taille absente ou une wilaya sans tarif suffisent a tout bloquer.",
          "La promesse : le prix et le produit de l'annonce doivent etre exactement ceux de la page. Un ecart fait cliquer puis partir.",
          "L'audience et le placement, en dernier — c'est la cause la moins frequente quand le CTR est bon.",
        ]),
    };
  }

  if (enoughSpend && enoughOrders && selectedCpa !== null && selectedCpa >= targetDeliveredCpa * thresholds.killCpaRatio
    && kpis.economics.selectedNetProfitMinor !== null && kpis.economics.selectedNetProfitMinor < 0) {
    return {
      status: "KILL", confidence: resultConfidence, reasonCode: "UNPROFITABLE_ABOVE_CPA_LIMIT", evidence,
      recommendation: steps(
        `Mettez en pause : ${money(selectedCpa)} par commande livree contre ${money(targetDeliveredCpa)} vises, et la campagne perd ${money(kpis.economics.selectedNetProfitMinor)}. Avant de relancer :`,
        [
          "Coupez d'abord les publicites dont le cout par vente depasse le double de votre meilleure — c'est la que part le budget, pas dans la campagne entiere.",
          "Determinez si le probleme est en amont ou en aval : un CPM ou un CTR degrades sont un probleme de creation ; un taux de livraison bas est un probleme de confirmation et d'attente client.",
          "Relancez avec le budget de depart, pas celui d'avant la pause : une campagne relancee repasse en apprentissage.",
        ]),
    };
  }

  /**
   * Regle qualite COD.
   *
   * Elle exigeait AUSSI un taux de refus au-dessus du seuil. Or ZR ne renvoie jamais de refus
   * distinct : un colis refuse a la porte arrive avec le meme code qu'un retour d'adresse, et
   * le statut `refused` de la boutique n'est jamais atteint. `refusalRatePercent` valait donc
   * toujours 0, la condition ne pouvait jamais etre vraie, et cette regle etait morte : une
   * campagne dont la moitie des colis revenaient passait sans un mot.
   *
   * Le taux d'echec de livraison, lui, est observable — et il coute la meme chose quelle que
   * soit la raison. C'est lui qui declenche desormais. Le detail des refus reste en evidence
   * quand il existe.
   */
  if (enoughOutcomes && below(kpis.cod.deliveryRatePercent, thresholds.minimumDeliveryRatePercent)) {
    return {
      status: kpis.economics.selectedNetProfitMinor !== null && kpis.economics.selectedNetProfitMinor < 0 ? "KILL" : "WATCH",
      confidence: resultConfidence, reasonCode: "COD_QUALITY_FAILURE",
      evidence: [...evidence, `Echec de livraison : ${kpis.cod.failedDeliveryRatePercent ?? "—"}% des colis expedies ne sont pas arrives.`],
      recommendation: steps(
        `Le probleme n'est pas la publicite mais ce qui se passe apres la commande : ${pct(kpis.cod.failedDeliveryRatePercent)} des colis expedies ne sont pas arrives, pour un plancher de livraison a ${thresholds.minimumDeliveryRatePercent}%. N'augmentez pas le budget tant que ce taux n'est pas remonte — chaque commande de plus vous coute un retour. Dans l'ordre :`,
        [
          "Rappelez aujourd'hui les commandes en tentative echouee : un colis relance avant sa troisieme tentative se livre encore, apres il repart en retour.",
          "Verifiez que le montant annonce dans la publicite est bien celui reclame a la porte, livraison comprise. L'ecart de prix est la premiere cause de refus.",
          "Confirmez la commune et le mode de livraison au telephone : une commune erronee est un retour garanti.",
          `Reprenez le budget quand le taux de livraison repasse au-dessus de ${thresholds.minimumDeliveryRatePercent}%.`,
        ]),
    };
  }

  if (trend.creativeFatigue.detected) {
    return {
      status: "WATCH", confidence: trend.creativeFatigue.confidence, reasonCode: "CREATIVE_FATIGUE", evidence: [...evidence, ...trend.creativeFatigue.signals],
      recommendation: steps(
        `Usure de la creation detectee (frequence ${kpis.advertising.frequency === null ? "—" : kpis.advertising.frequency.toFixed(2)}, CTR ${pct(kpis.advertising.ctrPercent)}). Ne montez pas le budget sur une creation fatiguee, cela ne fait qu'accelerer l'usure. Dans l'ordre :`,
        [
          "Preparez deux ou trois nouvelles creations AVANT de couper l'ancienne : couper d'abord arrete la diffusion et fait repartir l'apprentissage.",
          "Gardez l'angle qui fonctionne et changez l'image et l'accroche — c'est l'image que l'audience a trop vue, rarement l'offre.",
          "Lancez les nouvelles a cote de l'ancienne quelques jours, puis coupez celle dont le cout par vente est le plus eleve.",
        ]),
    };
  }

  const healthyCod = (kpis.cod.confirmationRatePercent === null || kpis.cod.confirmationRatePercent >= thresholds.minimumConfirmationRatePercent)
    && (kpis.cod.deliveryRatePercent === null || kpis.cod.deliveryRatePercent >= thresholds.minimumDeliveryRatePercent)
    && (kpis.cod.refusalRatePercent === null || kpis.cod.refusalRatePercent <= thresholds.maximumRefusalRatePercent);
  const targetProfitReached = kpis.economics.profitPerDeliveredOrderMinor !== null
    && kpis.economics.profitPerDeliveredOrderMinor >= thresholds.targetNetProfitPerDeliveredOrderMinor;
  const scaleEfficient = selectedCpa !== null && selectedCpa <= targetDeliveredCpa * thresholds.scaleCpaRatio;

  if (resultConfidence !== "low" && enoughOrders && healthyCod && targetProfitReached && scaleEfficient && trend.direction !== "declining") {
    return {
      status: "SCALE", confidence: resultConfidence, reasonCode: "PROFITABLE_BELOW_TARGET_CPA", evidence,
      recommendation: steps(
        `Campagne rentable et sous l'objectif : ${money(selectedCpa)} par commande livree contre ${money(targetDeliveredCpa)} vises. Montez, mais lentement :`,
        [
          "Augmentez de 20 a 30 % au maximum, puis attendez trois a quatre jours. Une hausse plus forte relance l'apprentissage et fait remonter le cout par vente.",
          "Montez d'abord l'ensemble de publicites dont le cout par vente est le plus bas, pas la campagne entiere : le budget global se repartit rarement comme vous l'esperez.",
          `Arretez la montee des que le cout par commande livree approche ${money(targetDeliveredCpa)}.`,
          "Surveillez la frequence : au-dela de trois, l'audience sature et le cout remonte quoi que vous fassiez.",
        ]),
    };
  }

  const profitable = kpis.economics.selectedNetProfitMinor !== null && kpis.economics.selectedNetProfitMinor >= 0;
  const acceptableCpa = selectedCpa !== null && selectedCpa <= targetDeliveredCpa * thresholds.killCpaRatio;
  if (enoughOrders && profitable && acceptableCpa && healthyCod && trend.direction !== "declining") {
    return {
      status: "KEEP", confidence: resultConfidence, reasonCode: "PROFITABLE_WITHIN_GUARDRAILS", evidence,
      recommendation: steps(
        `Gardez le budget actuel : ${money(selectedCpa)} par commande livree contre ${money(targetDeliveredCpa)} vises, la campagne tient dans ses limites. Le temps joue pour vous :`,
        [
          `Vous avez ${kpis.cod.deliveryOutcomes} livraison(s) resolue(s). A partir de ${thresholds.minimumDeliveredOrdersForHighConfidence}, le verdict repose sur vos vrais taux et non sur des hypotheses.`,
          "Debloquez les commandes en attente : chaque colis resolu rend le cout cible plus juste, et une commande bloquee est une mesure qui n'arrivera jamais.",
          "Ne touchez pas au budget pendant ce temps — un changement remet la mesure a zero et repousse la decision.",
        ]),
    };
  }

  return {
    status: "WATCH", confidence: resultConfidence, reasonCode: !enoughOrders || !enoughSpend ? "INSUFFICIENT_DATA" : trend.direction === "declining" ? "DECLINING_PERFORMANCE" : "OUTSIDE_GUARDRAILS",
    evidence,
    recommendation: !enoughOrders || !enoughSpend
      ? steps(
        `Pas encore de quoi decider : ${Math.max(kpis.funnel.storeOrders, kpis.advertising.purchases)} commande(s) sur les ${thresholds.minimumOrdersForDecision} necessaires, et ${money(spend)} depenses. Laissez tourner sans y toucher :`,
        [
          "Ne changez ni le budget ni le ciblage : chaque modification relance l'apprentissage et repousse d'autant le moment ou le verdict devient fiable.",
          "Pendant l'attente, agissez sur ce qui ne demande pas de decision : debloquer les commandes en erreur, rappeler les tentatives echouees, corriger les tarifs manquants.",
          `Revenez quand la campagne aura depasse ${thresholds.minimumOrdersForDecision} commandes et ${money(Math.round((targetOrderCpa ?? 0) * thresholds.minimumSpendToTargetCpaRatio))} de depense.`,
        ])
      : steps(
        `La campagne est hors de ses limites sans etre clairement perdante. Cherchez le maillon faible avant de toucher au budget — confirmation ${pct(kpis.cod.confirmationRatePercent)} (plancher ${thresholds.minimumConfirmationRatePercent}%), livraison ${pct(kpis.cod.deliveryRatePercent)} (plancher ${thresholds.minimumDeliveryRatePercent}%), cout par commande livree ${money(selectedCpa)} pour ${money(targetDeliveredCpa)} vises :`,
        [
          "Si c'est la confirmation qui peche, le probleme est l'attente creee par la publicite ou la joignabilite du client — pas le budget.",
          "Si c'est la livraison, traitez les tentatives echouees et les communes erronees avant tout.",
          "Si les deux tiennent et que seul le cout depasse, le probleme est publicitaire : comparez vos publicites entre elles et coupez la plus chere plutot que de baisser le budget global.",
        ]),
  };
}
