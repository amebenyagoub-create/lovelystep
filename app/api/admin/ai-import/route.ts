import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { requireAdminApi, validCsrf } from "@/lib/auth";
import { extractProduct, type AiProvider } from "@/lib/ai/product-extractor";
import { audit, createImportJob, saveProduct, updateImportJob, updateProductSourceData } from "@/lib/db-postgres";
import { deleteProductImages, prepareEvidenceImages, saveManualProductImages, saveProductImages } from "@/lib/uploads";
import { frenchAgeLabel } from "@/lib/product-size";

export const runtime = "nodejs";
export const maxDuration = 180;

function slugify(value: string): string {
  const base = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 65);
  return `${base || "produit-importe"}-${crypto.randomBytes(3).toString("hex")}`;
}

export async function POST(request: Request) {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  if (!validCsrf(request, session)) return NextResponse.json({ error: "Requête refusée." }, { status: 403 });
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 100 * 1024 * 1024) return NextResponse.json({ error: "Envoi trop volumineux." }, { status: 413 });

  const jobId = await createImportJob(`upload://ai-${Date.now()}`);
  await updateImportJob(jobId, { status: "running" });
  let gallery: string[] = [];
  let galleryCommitted = false;
  try {
    const form = await request.formData();
    const screenshots = form.getAll("screenshots").filter((value): value is File => value instanceof File);
    const productFiles = form.getAll("productImages").filter((value): value is File => value instanceof File);
    const manualFiles = form.getAll("manualImages").filter((value): value is File => value instanceof File);
    if (productFiles.length + manualFiles.length > 12) throw new Error("Maximum 12 images produit par import.");
    const requestedValue = String(form.get("provider") || "auto");
    const requested: "auto" | AiProvider = requestedValue === "gemini" || requestedValue === "groq" ? requestedValue : "auto";
    const evidence = await prepareEvidenceImages(screenshots);
    gallery = await saveProductImages(productFiles);
    gallery.push(...await saveManualProductImages(manualFiles));
    const result = await extractProduct(evidence, requested);
    const extracted = result.product;
    const ageSizes = [...new Map(extracted.sizes.map((size) => {
      const age = frenchAgeLabel(size);
      return [age.toLocaleLowerCase("fr"), { ...size, label: age, age }];
    })).values()];
    const product = await saveProduct({
      name: extracted.frenchName,
      slug: slugify(extracted.frenchName),
      shortDescription: extracted.shortDescription,
      description: extracted.description,
      priceCents: 0,
      costCents: 0,
      currency: "DZD",
      status: "draft",
      category: extracted.category,
      badge: "Import IA à vérifier",
      color: extracted.color,
      colors: extracted.colors,
      materials: extracted.materials,
      care: extracted.care,
      sourceUrl: `upload://ai-${jobId}`,
      images: gallery,
      sizes: ageSizes.map((size) => ({ ...size, weight: "", height: "", stock: 0 })),
      variants: (extracted.colors.length ? extracted.colors : (extracted.color ? [extracted.color] : [""])).flatMap((color) =>
        ageSizes.map((size) => ({ color, size: size.label, stock: 0, age: size.age, weight: "", height: "" }))),
      features: extracted.features,
      testimonials: extracted.testimonials,
      seoTitle: extracted.frenchName,
      seoDescription: extracted.shortDescription,
    });
    galleryCommitted = true;
    await updateProductSourceData(product.id, { provider: result.provider, fallbackReason: result.fallbackReason, extracted, evidenceFiles: evidence.map((item) => item.sourceName), importedAt: new Date().toISOString() });
    await updateImportJob(jobId, { status: "draft_created", productId: product.id, extracted: { provider: result.provider, title: product.name, images: gallery.length, warnings: extracted.warnings } });
    await audit(session.adminId, "ai.import", "product", String(product.id), { provider: result.provider, screenshots: screenshots.length, images: gallery.length });
    return NextResponse.json({ ok: true, jobId, provider: result.provider, fallbackReason: result.fallbackReason, product, warnings: extracted.warnings, supplierPriceRmb: extracted.supplierPriceRmb, moq: extracted.moq });
  } catch (error) {
    if (!galleryCommitted && gallery.length) await deleteProductImages(gallery);
    const message = error instanceof Error ? error.message : "Analyse impossible.";
    await updateImportJob(jobId, { status: "failed", error: message.slice(0, 800) });
    return NextResponse.json({ error: message, jobId }, { status: 502 });
  }
}
