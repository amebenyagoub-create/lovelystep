async function safeJson(response) {
  try { return await response.json(); } catch { return {}; }
}

async function checkGemini() {
  const response = await fetch("https://generativelanguage.googleapis.com/v1beta/models", { headers: { "x-goog-api-key": process.env.GEMINI_API_KEY || "" }, signal: AbortSignal.timeout(20000) });
  const payload = await safeJson(response);
  const configured = process.env.GEMINI_MODEL || "gemini-3.6-flash";
  const models = Array.isArray(payload.models) ? payload.models : [];
  return { ok: response.ok, status: response.status, configured, available: models.some((model) => model.name === `models/${configured}`), alternatives: models.map((model) => String(model.name || "").replace("models/", "")).filter((name) => name.includes("flash") && !name.includes("image")).slice(0, 20), error: response.ok ? undefined : String(payload?.error?.message || "Gemini request failed").slice(0, 200) };
}

async function checkGroq() {
  const response = await fetch("https://api.groq.com/openai/v1/models", { headers: { authorization: `Bearer ${process.env.GROQ_API_KEY || ""}` }, signal: AbortSignal.timeout(20000) });
  const payload = await safeJson(response);
  const configured = process.env.GROQ_MODEL || "qwen/qwen3.6-27b";
  const models = Array.isArray(payload.data) ? payload.data : [];
  return { ok: response.ok, status: response.status, configured, available: models.some((model) => model.id === configured), alternatives: models.map((model) => String(model.id || "")).filter((name) => /qwen|vision|scout/i.test(name)).slice(0, 8), error: response.ok ? undefined : String(payload?.error?.message || "Groq request failed").slice(0, 200) };
}

const [gemini, groq] = await Promise.all([checkGemini(), checkGroq()]);
console.log(JSON.stringify({ gemini, groq }, null, 2));
if (!gemini.ok || !groq.ok) process.exitCode = 1;
