// Calls the scheduled Meta sync endpoint. Intended to be the start command of a Railway cron
// service: Railway runs the service on its schedule, the process exits, and a non-zero exit
// marks the run as failed so the platform surfaces it.
//
// Required environment: CRON_SECRET, and SITE_URL (or CRON_TARGET_URL) pointing at the
// deployed store. Both already exist on the web service — copy them onto the cron service.
//
// Exit codes: 0 success, 1 sync reported an error, 2 misconfiguration, 3 token expired.

const secret = (process.env.CRON_SECRET ?? "").trim();
const base = (process.env.CRON_TARGET_URL ?? process.env.SITE_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "").trim();

if (!secret) {
  console.error("CRON_SECRET is missing. The endpoint stays closed without it.");
  process.exit(2);
}
if (!base || base.startsWith("http://localhost")) {
  console.error(`CRON_TARGET_URL/SITE_URL is missing or still local (${base || "unset"}).`);
  process.exit(2);
}

const target = new URL("/api/cron/meta-sync", base).toString();
const startedAt = Date.now();

try {
  const response = await fetch(target, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, accept: "application/json" },
    // The route allows up to 300s; give it room plus a margin for cold start.
    signal: AbortSignal.timeout(320_000),
  });
  const payload = await response.json().catch(() => ({}));
  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  console.log(`${target} → HTTP ${response.status} in ${elapsed}s`);
  console.log(JSON.stringify(payload, null, 2));

  if (payload.tokenExpired) {
    console.error("META_ACCESS_TOKEN is expired or invalid. Renew it, then re-run.");
    process.exit(3);
  }
  if (!response.ok || payload.ok === false) {
    console.error("Sync reported errors.");
    process.exit(1);
  }
  process.exit(0);
} catch (error) {
  console.error("Could not reach the sync endpoint:", error?.message ?? error);
  process.exit(1);
}
