const apiKey = process.env.ZREXPRESS_API_KEY?.trim();
const tenantId = process.env.ZREXPRESS_TENANT_ID?.trim();

if (!apiKey) {
  console.error("ZREXPRESS_API_KEY is missing.");
  process.exit(1);
}

try {
  const tests = tenantId ? [
    { label: "profile · X-Api-Key", url: "https://api.zrexpress.app/api/v1/users/profile", headers: { accept: "application/json", "X-Api-Key": apiKey } },
    { label: "profile · X-Api-Key + tenant", url: "https://api.zrexpress.app/api/v1/users/profile", headers: { accept: "application/json", "X-Api-Key": apiKey, "X-Tenant": tenantId } },
    { label: "v1 · X-Api-Key", url: "https://api.zrexpress.app/api/v1/delivery-pricing/rates", headers: { accept: "application/json", "X-Api-Key": apiKey, "X-Tenant": tenantId } },
    { label: "v1.0 · X-Api-Key", url: "https://api.zrexpress.app/api/v1.0/delivery-pricing/rates", headers: { accept: "application/json", "X-Api-Key": apiKey, "X-Tenant": tenantId } },
    { label: "v1 · Bearer", url: "https://api.zrexpress.app/api/v1/delivery-pricing/rates", headers: { accept: "application/json", authorization: `Bearer ${apiKey}`, "X-Tenant": tenantId } },
    { label: "v1 · both", url: "https://api.zrexpress.app/api/v1/delivery-pricing/rates", headers: { accept: "application/json", authorization: `Bearer ${apiKey}`, "X-Api-Key": apiKey, "X-Tenant": tenantId } },
  ] : [
    { label: "profile · X-Api-Key", url: "https://api.zrexpress.app/api/v1/users/profile", headers: { accept: "application/json", "X-Api-Key": apiKey } },
  ];
  const results = [];
  for (const test of tests) {
    const response = await fetch(test.url, { headers: test.headers, signal: AbortSignal.timeout(20_000) });
    const payload = await response.json().catch(() => ({}));
    results.push({
      label: test.label,
      ok: response.ok,
      status: response.status,
      responseFields: payload && typeof payload === "object" ? Object.keys(payload) : [],
      rates: Array.isArray(payload?.rates) ? payload.rates.length : null,
      authentication: response.headers.get("www-authenticate"),
      requestId: response.headers.get("x-request-id") ?? response.headers.get("trace-id"),
      error: response.ok ? null : String(payload?.detail ?? payload?.message ?? payload?.title ?? "Request refused").slice(0, 300),
    });
    if (response.ok) break;
  }
  console.log(JSON.stringify({ ok: results.some((result) => result.ok), results }, null, 2));
  if (!results.some((result) => result.ok)) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : "ZR Express connection failed.");
  process.exitCode = 1;
}
