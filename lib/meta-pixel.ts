export type MetaEventParameters = Record<string, string | number | string[] | Array<{ id: string; quantity: number }>>;

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    _lovelyStepMetaPixel?: string;
  }
}

export function trackMeta(eventName: "ViewContent" | "AddToCart" | "InitiateCheckout" | "Purchase", parameters: MetaEventParameters): void {
  if (typeof window === "undefined" || typeof window.fbq !== "function") return;
  window.fbq("track", eventName, parameters);
}
