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

/**
 * Renvoie le bureau correspondant a l'identifiant soumis, ou null.
 *
 * Un identifiant venu du navigateur n'est jamais recopie tel quel dans la commande : il est
 * confronte a la liste reelle de la wilaya. Si ZR est injoignable, on renvoie null et la
 * commande part sans bureau, ce que l'expedition sait encore resoudre par elle-meme.
 */
export async function resolveSubmittedHub(wilayaCode: string, wilayaName: string, hubId: string): Promise<ZrPickupHub | null> {
  if (!hubId) return null;
  try {
    const hubs = await pickupHubsForWilaya(wilayaCode, wilayaName);
    return hubs.find((hub) => hub.id === hubId) ?? null;
  } catch {
    return null;
  }
}
