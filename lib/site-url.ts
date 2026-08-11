import "server-only";

/**
 * Public origin of the store, without a trailing slash.
 *
 * SITE_URL is the source and is read at runtime. NEXT_PUBLIC_SITE_URL remains a fallback for
 * existing deployments, but Next replaces every NEXT_PUBLIC_* reference with a literal during
 * `next build` and the value is frozen from then on — see
 * next/dist/docs/01-app/02-guides/environment-variables.md. On a host where the variable is set
 * or corrected after the image is built, the public name silently keeps the stale value, which
 * matters here because this string decides catalog links and the secure-cookie flag.
 *
 * Nothing client-side reads either name: the server passes what the browser needs as props.
 */
export function siteUrl(): string {
  const configured = (process.env.SITE_URL ?? "").trim() || (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim();
  return configured.replace(/\/+$/, "");
}

/** True when the store is served over TLS, which is what the secure cookie flag keys off. */
export function siteIsHttps(): boolean {
  return siteUrl().startsWith("https://");
}
