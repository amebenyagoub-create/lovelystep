export type ValidatedCampaignNarrative = {
  headline: string;
  explanation: string;
  diagnostics: string[];
  nextAction: string;
};

function boundedText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string") throw new Error(`Invalid AI field: ${field}.`);
  const clean = value.trim();
  if (!clean || clean.length > maximum) throw new Error(`Invalid AI field length: ${field}.`);
  return clean;
}

/** Runtime validation is mandatory because model output is untrusted external input. */
export function validateCampaignNarrative(value: unknown): ValidatedCampaignNarrative {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("AI output is not a JSON object.");
  const raw = value as Record<string, unknown>;
  if (!Array.isArray(raw.diagnostics) || raw.diagnostics.length < 1 || raw.diagnostics.length > 5) throw new Error("Invalid AI diagnostics array.");
  return {
    headline: boundedText(raw.headline, "headline", 120),
    explanation: boundedText(raw.explanation, "explanation", 900),
    diagnostics: raw.diagnostics.map((item, index) => boundedText(item, `diagnostics[${index}]`, 240)),
    nextAction: boundedText(raw.nextAction, "nextAction", 300),
  };
}
