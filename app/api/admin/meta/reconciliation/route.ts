import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/auth";
import { buildReconciliation } from "@/lib/meta/reconciliation";

export const dynamic = "force-dynamic";

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  const url = new URL(request.url);
  const since = url.searchParams.get("since") ?? "";
  const until = url.searchParams.get("until") ?? "";
  if (!isoDate.test(since) || !isoDate.test(until) || since > until) {
    return NextResponse.json({ error: "Période invalide (AAAA-MM-JJ)." }, { status: 400 });
  }
  return NextResponse.json(await buildReconciliation(since, until));
}
