// Railway cron entry point: reconcile orders with Google Sheets, then exit.
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

const target = new URL("/api/cron/sheet-sync", base).toString();
const startedAt = Date.now();

try {
  const response = await fetch(target, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, accept: "application/json" },
    signal: AbortSignal.timeout(320_000),
  });
  const payload = await response.json().catch(() => ({}));
  console.log(`${target} → HTTP ${response.status} in ${Math.round((Date.now() - startedAt) / 1000)}s`);
  console.log(JSON.stringify(payload, null, 2));

  if (!response.ok || payload.ok === false) {
    console.error("Google Sheets sync reported errors.");
    process.exit(1);
  }
  process.exit(0);
} catch (error) {
  console.error("Could not reach the Google Sheets sync endpoint:", error?.message ?? error);
  process.exit(1);
}
