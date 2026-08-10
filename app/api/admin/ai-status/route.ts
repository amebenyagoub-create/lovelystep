import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { checkAiProviders } from "@/lib/ai/product-extractor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  const providers = await checkAiProviders();
  return NextResponse.json({
    ok: providers.gemini.ok || providers.groq.ok,
    providers,
  }, { status: providers.gemini.ok || providers.groq.ok ? 200 : 503 });
}
