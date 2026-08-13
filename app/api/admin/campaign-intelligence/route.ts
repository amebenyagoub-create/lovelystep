import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { getCampaignIntelligence } from "@/lib/campaign-intelligence/service";

export const dynamic = "force-dynamic";

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const url = new URL(request.url);
  const since = url.searchParams.get("since") ?? "";
  const until = url.searchParams.get("until") ?? "";
  const days = isoDate.test(since) && isoDate.test(until) ? Math.round((Date.parse(until) - Date.parse(since)) / 86_400_000) + 1 : 0;
  if (!isoDate.test(since) || !isoDate.test(until) || since > until || days < 1 || days > 93) {
    return NextResponse.json({ error: "Invalid period. Use YYYY-MM-DD and a maximum of 93 days." }, { status: 400 });
  }

  try {
    return NextResponse.json(await getCampaignIntelligence(since, until));
  } catch (error) {
    console.error("Campaign intelligence failed", error);
    return NextResponse.json({ error: "Campaign intelligence is temporarily unavailable." }, { status: 500 });
  }
}
