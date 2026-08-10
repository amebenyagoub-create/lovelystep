import { NextResponse } from "next/server";
import { requireAdminApi, validCsrf } from "@/lib/auth";
import { audit, createImportJob, updateImportJob } from "@/lib/db";
import { assert1688Url, createDraftFromScrape, scrape1688Product } from "@/lib/scraper/1688";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(request: Request) {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  if (!validCsrf(request, session)) return NextResponse.json({ error: "Requête refusée." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { url?: string };
  let source: URL;
  try { source = assert1688Url(String(body.url ?? "")); } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "URL invalide." }, { status: 400 }); }
  const jobId = createImportJob(source.toString());
  updateImportJob(jobId, { status: "running" });
  try {
    const scraped = await scrape1688Product(source.toString(), jobId);
    const product = createDraftFromScrape(source.toString(), scraped);
    updateImportJob(jobId, { status: "draft_created", extracted: { title: scraped.title, images: scraped.localImages.length, priceText: scraped.priceText }, productId: product.id });
    audit(session.adminId, "1688.import", "product", String(product.id), { source: source.toString() });
    return NextResponse.json({ ok: true, jobId, product });
  } catch (error) {
    const needsLogin = error instanceof Error && (error.name === "Needs1688Login" || /executable|browser/i.test(error.message));
    const message = error instanceof Error ? error.message : "Import impossible.";
    updateImportJob(jobId, { status: needsLogin ? "needs_login" : "failed", error: message.slice(0, 800) });
    return NextResponse.json({ error: message, jobId }, { status: needsLogin ? 409 : 502 });
  }
}
