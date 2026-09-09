import "server-only";

import type { CampaignDecision, CampaignKpis, CampaignTrend } from "./types";
import { validateCampaignNarrative, type ValidatedCampaignNarrative } from "./ai-schema";

type GroqResponse = {
  choices?: Array<{ message?: { content?: unknown } }>;
  error?: { message?: unknown };
};

export const campaignAiModel = () => process.env.CAMPAIGN_AI_MODEL || "llama-3.3-70b-versatile";

function parseJson(value: string): unknown {
  const cleaned = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  return JSON.parse(cleaned);
}

export async function generateGroqCampaignNarrative(input: {
  campaignName: string;
  decision: CampaignDecision;
  kpis: CampaignKpis;
  trend: CampaignTrend;
}): Promise<ValidatedCampaignNarrative> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY is not configured.");
  const model = campaignAiModel();
  const timeout = Math.min(30_000, Math.max(3_000, Number(process.env.CAMPAIGN_AI_TIMEOUT_MS ?? 12_000)));
  const facts = {
    campaign: input.campaignName,
    deterministicDecision: input.decision,
    kpis: input.kpis,
    trend: input.trend,
  };
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    signal: AbortSignal.timeout(timeout),
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      max_completion_tokens: 1_400,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content: [
            "Tu es analyste publicitaire e-commerce pour une boutique algerienne en paiement a la livraison.",
            "Tu expliques UNIQUEMENT le resultat deterministe fourni. Ne propose jamais un autre statut SCALE/KEEP/WATCH/KILL. N'invente aucun chiffre absent des donnees.",
            "Reponds en francais, en JSON seulement : headline, explanation, diagnostics (1 a 5 chaines), nextAction.",
            "nextAction doit etre un plan d'action detaille et ordonne, pas une phrase generale. Reprends le champ deterministicDecision.recommendation, qui contient deja les etapes numerotees et les montants : garde ses etapes, son ordre et ses chiffres, et n'ajoute que ce que les donnees justifient.",
            "Chaque etape dit quoi faire, dans quel ordre, et a quel chiffre s'arreter. Cite les montants en DZD tels quels. Pas de conseil generique du type « optimisez vos creations ».",
            "Si une donnee manque, dis-le explicitement plutot que de contourner.",
          ].join(" "),
        },
        { role: "user", content: JSON.stringify(facts) },
      ],
    }),
  });
  const payload = await response.json().catch(() => ({})) as GroqResponse;
  if (!response.ok) {
    const message = typeof payload.error?.message === "string" ? payload.error.message.slice(0, 240) : `HTTP ${response.status}`;
    throw new Error(`Groq campaign analysis failed: ${message}`);
  }
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("Groq returned an empty campaign analysis.");
  return validateCampaignNarrative(parseJson(content));
}
