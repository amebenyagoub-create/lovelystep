import { listZrExpressPickupHubs, type ZrPickupHub } from "./zrexpress";

/**
 * Bureaux de retrait ZR Express par wilaya, avec cache memoire partage.
 *
 * Deux appelants s'en servent : la route publique qui alimente le selecteur de bureau du
 * formulaire, et la creation de commande qui doit revalider l'identifiant soumis. Le cache
 * commun evite qu'une commande declenche un second appel vers ZR juste apres celui du
 * formulaire, et borne le trafic sortant a une requete par wilaya toutes les dix minutes,
 * quel que soit le nombre de visiteurs.
 */
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; hubs: ZrPickupHub[] }>();
const inflight = new Map<string, Promise<ZrPickupHub[]>>();

export async function pickupHubsForWilaya(wilayaCode: string, wilayaName: string): Promise<ZrPickupHub[]> {
  const cached = cache.get(wilayaCode);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.hubs;
  // Une rafale de commandes sur la meme wilaya ne doit pas partir en N appels paralleles.
  const pending = inflight.get(wilayaCode);
  if (pending) return pending;
  const request = listZrExpressPickupHubs(wilayaName)
    .then((hubs) => { cache.set(wilayaCode, { at: Date.now(), hubs }); return hubs; })
    .finally(() => { inflight.delete(wilayaCode); });
  inflight.set(wilayaCode, request);
  return request;
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
