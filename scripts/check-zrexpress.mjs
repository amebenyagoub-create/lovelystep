const apiKey = process.env.ZREXPRESS_API_KEY?.trim();
const tenantId = process.env.ZREXPRESS_TENANT_ID?.trim();

if (!apiKey) {
  console.error("ZREXPRESS_API_KEY is missing.");
  process.exit(1);
}

const url = tenantId
  ? "https://api.zrexpress.app/api/v1/delivery-pricing/rates"
  : "https://api.zrexpress.app/api/v1/users/profile";
const headers = { accept: "application/json", "X-Api-Key": apiKey };
if (tenantId) headers["X-Tenant"] = tenantId;

try {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  const payload = await response.json().catch(() => ({}));
  const tenantCandidate = payload?.tenantId ?? payload?.tenant?.id ?? payload?.supplier?.tenantId ?? null;
  console.log(JSON.stringify({
    ok: response.ok,
    status: response.status,
    tested: tenantId ? "rates" : "profile",
    responseFields: payload && typeof payload === "object" ? Object.keys(payload) : [],
    tenantCandidate,
    error: response.ok ? null : String(payload?.detail ?? payload?.message ?? payload?.title ?? "Request refused").slice(0, 300),
  }, null, 2));
  if (!response.ok) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : "ZR Express connection failed.");
  process.exitCode = 1;
}
