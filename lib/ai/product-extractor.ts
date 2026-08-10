import "server-only";

import type { EvidenceImage } from "@/lib/uploads";

export type AiProvider = "gemini" | "groq";
export type AiProviderHealth = { ok: boolean; model: string; message: string };
export type ExtractedProduct = {
  rawTitle: string;
  frenchName: string;
  shortDescription: string;
  description: string;
  supplierPriceRmb: number;
  moq: string;
  category: string;
  color: string;
  colors: string[];
  materials: string;
  care: string;
  sizes: Array<{ label: string; age: string; weight: string; height: string }>;
  variants: string[];
  features: string[];
  warnings: string[];
  supplierReviewInsights: string[];
  testimonials: Array<{ quote: string; author: string; rating: number; source: string }>;
};

const schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    rawTitle: { type: "string" }, frenchName: { type: "string" }, shortDescription: { type: "string" }, description: { type: "string" },
    supplierPriceRmb: { type: "number" }, moq: { type: "string" }, category: { type: "string" }, color: { type: "string" }, colors: { type: "array", items: { type: "string" } },
    materials: { type: "string" }, care: { type: "string" },
    sizes: { type: "array", items: { type: "object", additionalProperties: false, properties: { label: { type: "string" }, age: { type: "string" }, weight: { type: "string" }, height: { type: "string" } }, required: ["label", "age", "weight", "height"] } },
    variants: { type: "array", items: { type: "string" } }, features: { type: "array", items: { type: "string" } },
    warnings: { type: "array", items: { type: "string" } }, supplierReviewInsights: { type: "array", items: { type: "string" } },
    testimonials: { type: "array", items: { type: "object", additionalProperties: false, properties: { quote: { type: "string" }, author: { type: "string" }, rating: { type: "number" }, source: { type: "string" } }, required: ["quote", "author", "rating", "source"] } },
  },
  required: ["rawTitle", "frenchName", "shortDescription", "description", "supplierPriceRmb", "moq", "category", "color", "colors", "materials", "care", "sizes", "variants", "features", "warnings", "supplierReviewInsights", "testimonials"],
} as const;

function withoutAdditionalProperties(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutAdditionalProperties);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "additionalProperties").map(([key, item]) => [key, withoutAdditionalProperties(item)]));
}
const geminiSchema = withoutAdditionalProperties(schema);

const prompt = `You are extracting factual product data from screenshots of a Chinese 1688 supplier listing for a French children's clothing store.
Read every provided screenshot. Translate useful facts into natural French, but never invent missing facts.
Return only JSON matching the supplied schema.
Rules:
- rawTitle: original supplier title when visible.
- frenchName: concise French retail name, without unsupported claims.
- supplierPriceRmb: supplier price in RMB as a number; use 0 if unclear. Never convert it into a selling price.
- colors: every clearly visible or explicitly listed product color. Do not infer colors hidden by lighting.
- sizes: copy only size-chart values that are visibly supported. Use empty strings for absent age, weight, or height.
- features: factual garment characteristics only.
- warnings: list every missing, ambiguous, contradictory, or low-confidence field in French.
- supplierReviewInsights: summarize supplier-listing reviews privately in French; never present them as Lovely Step customer testimonials.
- testimonials: transcribe only complete testimonial or review quotes visibly supplied in the screenshots. Translate the quote to French when needed. Keep author and rating only when visible, otherwise use an empty author and rating 0. Set source to a short truthful label such as "Fiche fournisseur 1688". Never invent a quote.
- descriptions must be suitable draft copy but must not add certifications, materials, benefits, or guarantees not visible in the evidence.`;

function text(value: unknown): string { return typeof value === "string" ? value.trim() : ""; }
function strings(value: unknown): string[] { return Array.isArray(value) ? value.map(text).filter(Boolean).slice(0, 30) : []; }

function testimonials(value: unknown): ExtractedProduct["testimonials"] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const quote = text(row.quote);
    if (!quote) return [];
    const rating = Math.min(5, Math.max(0, Number(row.rating) || 0));
    return [{ quote, author: text(row.author), rating, source: text(row.source) || "Fiche fournisseur" }];
  }).slice(0, 20);
}

function validate(value: unknown): ExtractedProduct {
  if (!value || typeof value !== "object") throw new Error("Réponse IA vide ou invalide.");
  const row = value as Record<string, unknown>;
  const sizes = Array.isArray(row.sizes) ? row.sizes.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const size = item as Record<string, unknown>;
    const label = text(size.label);
    return label ? [{ label, age: text(size.age), weight: text(size.weight), height: text(size.height) }] : [];
  }).slice(0, 30) : [];
  const color = text(row.color);
  const colors = strings(row.colors);
  return {
    rawTitle: text(row.rawTitle), frenchName: text(row.frenchName) || "Produit importé à vérifier",
    shortDescription: text(row.shortDescription), description: text(row.description),
    supplierPriceRmb: Number.isFinite(Number(row.supplierPriceRmb)) ? Math.max(0, Number(row.supplierPriceRmb)) : 0,
    moq: text(row.moq), category: text(row.category) || "À classer", color, colors: colors.length ? colors : (color ? [color] : []), materials: text(row.materials), care: text(row.care),
    sizes, variants: strings(row.variants), features: strings(row.features), warnings: strings(row.warnings), supplierReviewInsights: strings(row.supplierReviewInsights), testimonials: testimonials(row.testimonials),
  };
}

function parseJson(value: string): unknown {
  const cleaned = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(cleaned);
}

function providerError(provider: AiProvider, status: number, payload: unknown): Error {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const nested = record.error && typeof record.error === "object" ? record.error as Record<string, unknown> : {};
  const detail = text(nested.message) || text(record.message) || `HTTP ${status}`;
  return new Error(`${provider === "gemini" ? "Gemini" : "Groq"} : ${detail.slice(0, 300)}`);
}

function networkErrorCode(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const direct = error as { code?: unknown; cause?: unknown; errors?: unknown };
  if (typeof direct.code === "string") return direct.code;
  const causeCode = networkErrorCode(direct.cause);
  if (causeCode) return causeCode;
  if (Array.isArray(direct.errors)) {
    for (const item of direct.errors) {
      const code = networkErrorCode(item);
      if (code) return code;
    }
  }
  return "";
}

async function providerFetch(provider: AiProvider, input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    const label = provider === "gemini" ? "Gemini" : "Groq";
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") throw new Error(`${label} : délai de réponse dépassé.`);
    const code = networkErrorCode(error);
    if (code === "EACCES" || code === "EPERM") {
      throw new Error(`${label} : la connexion Internet du processus LovelyStep est bloquée par Windows ou par l’environnement de lancement. Redémarrez le serveur avec l’accès réseau autorisé.`);
    }
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
      throw new Error(`${label} : le service est introuvable. Vérifiez la connexion Internet et les réglages DNS.`);
    }
    throw new Error(`${label} : connexion réseau impossible. Vérifiez l’accès Internet du serveur.`);
  }
}

async function checkProvider(provider: AiProvider): Promise<AiProviderHealth> {
  const key = provider === "gemini" ? process.env.GEMINI_API_KEY : process.env.GROQ_API_KEY;
  const model = provider === "gemini" ? (process.env.GEMINI_MODEL || "gemini-3.6-flash") : (process.env.GROQ_MODEL || "qwen/qwen3.6-27b");
  if (!key) return { ok: false, model, message: "Clé API absente." };
  const url = provider === "gemini" ? "https://generativelanguage.googleapis.com/v1beta/models" : "https://api.groq.com/openai/v1/models";
  const headers: HeadersInit = provider === "gemini" ? { "x-goog-api-key": key } : { authorization: `Bearer ${key}` };
  try {
    const response = await providerFetch(provider, url, { headers, signal: AbortSignal.timeout(20_000) });
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) return { ok: false, model, message: providerError(provider, response.status, payload).message };
    const available = provider === "gemini"
      ? (Array.isArray(payload.models) && payload.models.some((item) => item && typeof item === "object" && (item as Record<string, unknown>).name === `models/${model}`))
      : (Array.isArray(payload.data) && payload.data.some((item) => item && typeof item === "object" && (item as Record<string, unknown>).id === model));
    return available
      ? { ok: true, model, message: "Connexion opérationnelle." }
      : { ok: false, model, message: `Connexion réussie, mais le modèle ${model} n’est pas disponible.` };
  } catch (error) {
    return { ok: false, model, message: error instanceof Error ? error.message : "Test impossible." };
  }
}

export async function checkAiProviders(): Promise<Record<AiProvider, AiProviderHealth>> {
  const [gemini, groq] = await Promise.all([checkProvider("gemini"), checkProvider("groq")]);
  return { gemini, groq };
}

export async function extractWithGemini(images: EvidenceImage[]): Promise<ExtractedProduct> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Gemini n’est pas configuré.");
  const model = process.env.GEMINI_MODEL || "gemini-3.6-flash";
  const response = await providerFetch("gemini", `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST", signal: AbortSignal.timeout(90_000),
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }, ...images.map((image) => ({ inlineData: { mimeType: image.mimeType, data: image.data.toString("base64") } }))] }], generationConfig: { temperature: 0.1, responseMimeType: "application/json", responseSchema: geminiSchema } }),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw providerError("gemini", response.status, payload);
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const candidate = candidates[0] as Record<string, unknown> | undefined;
  const content = candidate?.content as Record<string, unknown> | undefined;
  const parts = Array.isArray(content?.parts) ? content.parts as Record<string, unknown>[] : [];
  const output = parts.map((part) => text(part.text)).filter(Boolean).join("\n");
  if (!output) throw new Error("Gemini n’a retourné aucune donnée exploitable.");
  return validate(parseJson(output));
}

export async function extractWithGroq(images: EvidenceImage[]): Promise<ExtractedProduct> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("Groq n’est pas configuré.");
  const model = process.env.GROQ_MODEL || "qwen/qwen3.6-27b";
  const response = await providerFetch("groq", "https://api.groq.com/openai/v1/chat/completions", {
    method: "POST", signal: AbortSignal.timeout(90_000),
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, temperature: 0.1, max_completion_tokens: 3000, response_format: { type: "json_object" }, messages: [{ role: "user", content: [{ type: "text", text: `${prompt}\nJSON schema:\n${JSON.stringify(schema)}` }, ...images.map((image) => ({ type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.data.toString("base64")}` } }))] }] }),
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw providerError("groq", response.status, payload);
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const choice = choices[0] as Record<string, unknown> | undefined;
  const message = choice?.message as Record<string, unknown> | undefined;
  const output = text(message?.content);
  if (!output) throw new Error("Groq n’a retourné aucune donnée exploitable.");
  return validate(parseJson(output));
}

export async function extractProduct(images: EvidenceImage[], requested: "auto" | AiProvider = "auto"): Promise<{ provider: AiProvider; product: ExtractedProduct; fallbackReason?: string }> {
  if (requested === "gemini") return { provider: "gemini", product: await extractWithGemini(images) };
  if (requested === "groq") return { provider: "groq", product: await extractWithGroq(images) };
  try { return { provider: "gemini", product: await extractWithGemini(images) }; }
  catch (geminiError) {
    const fallbackReason = geminiError instanceof Error ? geminiError.message : "Gemini indisponible";
    try { return { provider: "groq", product: await extractWithGroq(images), fallbackReason }; }
    catch (groqError) {
      const groqReason = groqError instanceof Error ? groqError.message : "Groq indisponible";
      throw new Error(`Aucun fournisseur IA n’est joignable. ${fallbackReason} | ${groqReason}`);
    }
  }
}
