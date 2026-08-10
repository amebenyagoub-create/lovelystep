import "server-only";

import { metaConfig } from "./config";
import { redact } from "./capi";

/**
 * Minimal Graph API client shared by Ads Insights and catalog sync.
 * Handles pagination, rate limiting and token-expiry detection in one place.
 */

export class MetaTokenExpiredError extends Error {
  constructor(message: string) { super(message); this.name = "MetaTokenExpiredError"; }
}
export class MetaRateLimitError extends Error {
  constructor(message: string) { super(message); this.name = "MetaRateLimitError"; }
}

type GraphError = { message?: string; code?: number; error_subcode?: number; type?: string };

// 190 = invalid/expired token, 102 = session expired, 463 = expired, 467 = invalid.
const TOKEN_ERROR_CODES = new Set([102, 190, 463, 467]);
// 4/17/32 = app or account level throttling, 613 = custom-rate limit.
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);

function graphUrl(path: string, params: Record<string, string>): string {
  const config = metaConfig();
  const url = new URL(`https://graph.facebook.com/${config.graphApiVersion}/${path.replace(/^\/+/, "")}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

async function requestOnce<T>(url: string, init?: RequestInit): Promise<T> {
  const config = metaConfig();
  const response = await fetch(url, {
    ...init,
    headers: { accept: "application/json", authorization: `Bearer ${config.accessToken}`, ...(init?.headers ?? {}) },
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await response.json().catch(() => ({})) as { error?: GraphError } & Record<string, unknown>;
  if (response.ok && !payload.error) return payload as T;
  const error = payload.error ?? {};
  const message = redact(String(error.message ?? `HTTP ${response.status}`));
  if (error.code != null && TOKEN_ERROR_CODES.has(error.code)) throw new MetaTokenExpiredError(message);
  if (response.status === 429 || (error.code != null && RATE_LIMIT_CODES.has(error.code))) throw new MetaRateLimitError(message);
  throw new Error(message);
}

/** Retries only throttling and transient transport failures, with exponential backoff. */
export async function graphRequest<T>(path: string, params: Record<string, string> = {}, init?: RequestInit, attempts = 4): Promise<T> {
  const url = init?.method === "POST" ? graphUrl(path, {}) : graphUrl(path, params);
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await requestOnce<T>(url, init);
    } catch (error) {
      lastError = error;
      // An expired token will never recover by retrying.
      if (error instanceof MetaTokenExpiredError) throw error;
      const retryable = error instanceof MetaRateLimitError || error instanceof TypeError || (error instanceof Error && error.name === "TimeoutError");
      if (!retryable || attempt === attempts) throw error;
      // Throttling needs a much longer pause than a network blip.
      const base = error instanceof MetaRateLimitError ? 5_000 : 500;
      await new Promise((resolve) => setTimeout(resolve, base * 2 ** (attempt - 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Graph request failed");
}

type Paged<T> = { data: T[]; paging?: { next?: string; cursors?: { after?: string } } };

async function requestWithRetry<T>(url: string, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await requestOnce<T>(url);
    } catch (error) {
      lastError = error;
      if (error instanceof MetaTokenExpiredError) throw error;
      const retryable = error instanceof MetaRateLimitError || error instanceof TypeError || (error instanceof Error && error.name === "TimeoutError");
      if (!retryable || attempt === attempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, (error instanceof MetaRateLimitError ? 5_000 : 500) * 2 ** (attempt - 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Graph request failed");
}

/**
 * Walks every page of a Graph edge by following the absolute `paging.next` URLs, which already
 * carry their own cursor and signature.
 *
 * `maxPages` is a safety stop: an unbounded loop against a paginated API is how a sync job
 * turns into a runaway bill.
 */
export async function graphPaginate<T>(path: string, params: Record<string, string>, maxPages = 100): Promise<T[]> {
  const results: T[] = [];
  let url: string | undefined = graphUrl(path, params);
  let pages = 0;
  while (url && pages < maxPages) {
    const page: Paged<T> = await requestWithRetry<Paged<T>>(url);
    results.push(...(page.data ?? []));
    url = page.paging?.next;
    pages += 1;
  }
  return results;
}

export async function graphPost<T>(path: string, body: unknown): Promise<T> {
  return graphRequest<T>(path, {}, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
