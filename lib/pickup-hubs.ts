import { findWilaya } from "./algeria";
import { listAllZrExpressPickupHubs, listZrExpressPickupHubs, type ZrPickupHub } from "./zrexpress";

/**
 * Bureaux de retrait ZR Express par wilaya, avec cache memoire partage.
 *
 * Deux appelants s'en servent : la route publique qui alimente le selecteur de bureau du
 * formulaire, et la creation de commande qui doit revalider l'identifiant soumis. Le cache
 * commun evite qu'une commande declenche un second appel vers ZR juste apres celui du
 * formulaire, et borne le trafic sortant quel que soit le nombre de visiteurs.
 *
 * Le tri par wilaya se fait ici et non chez ZR : leur recherche par mot-cle porte sur le nom
 * du bureau, pas sur la wilaya, donc « Alger » ou « Oran » ne renvoyaient rien alors que ces
 * wilayas comptent le plus de bureaux. On rapproche donc la commune du bureau des communes
 * de la wilaya, comparees sans accents ni ponctuation.
 */
const CACHE_MS = 30 * 60 * 1000;
let allHubs: { at: number; hubs: ZrPickupHub[] } | null = null;
let allHubsInflight: Promise<ZrPickupHub[]> | null = null;

const normalized = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, " ").trim().toLocaleLowerCase("fr");

async function everyHub(): Promise<ZrPickupHub[]> {
  if (allHubs && Date.now() - allHubs.at < CACHE_MS) return allHubs.hubs;
  // Une rafale de visiteurs ne doit pas partir en N appels paralleles vers ZR.
  if (allHubsInflight) return allHubsInflight;
  allHubsInflight = listAllZrExpressPickupHubs()
    .then((hubs) => { allHubs = { at: Date.now(), hubs }; return hubs; })
    .finally(() => { allHubsInflight = null; });
  return allHubsInflight;
}

/**
 * Code wilaya porte par le nom du bureau, ou null.
 *
 * ZR numerote ses bureaux : « Hub Baraki 16 », « Hub In Salah 53 », « Oum El Bouaghi04 ».
 * C'est le rattachement le plus sur dont on dispose, et il tranche deux cas que le nom de
 * commune rate : les orthographes qui divergent de notre referentiel (« Ain Salah » pour
 * In Salah, « B. B. Arreridj » pour Bordj Bou Arreridj) et les communes homonymes dans deux
 * wilayas differentes, qui feraient apparaitre un bureau la ou il n'est pas.
 * Un nom portant plusieurs nombres est ambigu : on ne devine pas, on repasse a la commune.
 */
function wilayaCodeFromHubName(name: string): string | null {
  const codes = [...new Set([...name.matchAll(/\d{1,2}/g)].map((match) => Number(match[0])).filter((code) => code >= 1 && code <= 58))];
  return codes.length === 1 ? String(codes[0]).padStart(2, "0") : null;
}

export async function pickupHubsForWilaya(wilayaCode: string, wilayaName: string): Promise<ZrPickupHub[]> {
  const wilaya = findWilaya(wilayaCode);
  const code = wilaya?.code ?? wilayaCode.padStart(2, "0");
  const known = new Set<string>(wilaya ? wilaya.communes.map((commune) => normalized(commune.nameFr)) : []);
  known.add(normalized(wilayaName));

  const hubs = await everyHub();
  const matched = hubs.filter((hub) => {
    const tagged = wilayaCodeFromHubName(hub.name);
    return tagged ? tagged === code : known.has(normalized(hub.district));
  });
  if (matched.length) return matched;

  // Repli : ZR a peut-etre orthographie la commune autrement que notre referentiel. La
  // recherche par mot-cle rattrape au moins les bureaux nommes d'apres la wilaya.
  try {
    return await listZrExpressPickupHubs(wilayaName);
  } catch {
    return [];
  }
}

export type SubmittedHubResult =
  /** L'identifiant existe bien dans la liste reelle de la wilaya. */
  | { status: "resolved"; hub: ZrPickupHub }
  /** La liste a ete obtenue et l'identifiant n'y figure pas : il ne doit pas etre garde. */
  | { status: "unknown" }
  /** ZR n'a pas repondu : on ne peut ni confirmer ni infirmer le choix du client. */
  | { status: "unavailable" };

/**
 * Confronte le bureau soumis par le navigateur a la liste reelle de la wilaya.
 *
 * La version precedente renvoyait `null` dans les deux cas d'echec, et l'appelant enregistrait
 * alors la commande sans bureau. Or « ZR n'a pas repondu » et « ce bureau n'existe pas » ne
 * demandent pas la meme chose : dans le premier cas l'identifiant vient d'une liste que ZR
 * lui-meme nous a servie quelques minutes plus tot et reste tres probablement bon, dans le
 * second il est faux et doit disparaitre.
 *
 * Les confondre coutait cher et en silence : sans bureau, l'expedition en devine un a partir
 * de la commune, et le colis pouvait atterrir dans un autre bureau que celui choisi par le
 * client -- qui se deplace alors pour rien. On distingue donc les deux, et l'appelant garde
 * le choix du client quand ZR est simplement injoignable.
 *
 * Une liste vide est traitee comme une panne : pickupHubsForWilaya retombe deja sur une
 * recherche par mot-cle qui renvoie `[]` quand ZR echoue, donc « aucun bureau » ne prouve pas
 * que celui du client n'existe pas.
 */
export async function resolveSubmittedHub(wilayaCode: string, wilayaName: string, hubId: string): Promise<SubmittedHubResult> {
  if (!hubId) return { status: "unknown" };
  let hubs: ZrPickupHub[];
  try {
    hubs = await pickupHubsForWilaya(wilayaCode, wilayaName);
  } catch {
    return { status: "unavailable" };
  }
  if (!hubs.length) return { status: "unavailable" };
  const hub = hubs.find((entry) => entry.id === hubId);
  return hub ? { status: "resolved", hub } : { status: "unknown" };
}
