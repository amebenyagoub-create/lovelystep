"use client";

import { useSyncExternalStore } from "react";
import { readConsentCookie, type ConsentState } from "./consent";

export const CONSENT_CHANGED_EVENT = "lovelystep:consent-changed";

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CONSENT_CHANGED_EVENT, onChange);
  return () => window.removeEventListener(CONSENT_CHANGED_EVENT, onChange);
}

/** The consent cookie is an external store, so React reads it through useSyncExternalStore. */
export function useConsent(): ConsentState {
  return useSyncExternalStore(subscribe, readConsentCookie, () => "unset" as const);
}

export function notifyConsentChanged(): void {
  window.dispatchEvent(new Event(CONSENT_CHANGED_EVENT));
}
