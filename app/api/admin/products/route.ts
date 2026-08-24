import { after, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { CATALOG_TAG } from "@/lib/public-cache";
import { requireAdminApi, validCsrf } from "@/lib/auth";
import { audit, deleteProduct, getProductById, saveProduct } from "@/lib/db-postgres";
import { productMetaAutomationPlan, runDeletedProductMetaAutomation, runProductMetaAutomation } from "@/lib/meta/product-automation";
import type { Product, ProductSize, ProductStatus, ProductTestimonial, ProductTranslation, ProductVariant } from "@/lib/types";

const statuses: ProductStatus[] = ["draft", "published", "archived"];
/** Markers the AI importer leaves behind for a human to replace. */
const PLACEHOLDER_COPY = /\b(import(?:é|e)?\s+IA|produit\s+import(?:é|e)?)\b.*\bà\s+v(?:é|e)rifier\b|\bà\s+v(?:é|e)rifier\b/i;
const validImage = (value: string) => (/^\/api\/media\/(products|imports|size-guides)\/[a-zA-Z0-9._/-]+$/.test(value) || /^\/images\/[a-zA-Z0-9._/-]+$/.test(value)) && !value.includes("..") && !value.includes("//");

function cleanVariants(value: unknown): ProductVariant[] {
  if (!Array.isArray(value)) return [];
  return value.filter((variant): variant is ProductVariant => Boolean(variant && typeof variant.size === "string")).map((variant) => ({
    color: String(variant.color ?? "").trim().slice(0, 80),
    size: variant.size.trim().slice(0, 60),
    stock: Math.min(100_000, Math.max(0, Math.floor(Number(variant.stock) || 0))),
    age: String(variant.age ?? "").trim().slice(0, 80),
    weight: String(variant.weight ?? "").trim().slice(0, 80),
    height: String(variant.height ?? "").trim().slice(0, 80),
  })).filter((variant) => variant.size).slice(0, 300);
}

function cleanSizes(value: unknown): ProductSize[] {
  if (!Array.isArray(value)) return [];
  return value.filter((size): size is ProductSize => Boolean(size && typeof size.label === "string")).map((size) => ({
    label: size.label.trim().slice(0, 60),
    stock: Math.min(100_000, Math.max(0, Math.floor(Number(size.stock) || 0))),
    age: String(size.age ?? "").trim().slice(0, 80),
    weight: String(size.weight ?? "").trim().slice(0, 80),
    height: String(size.height ?? "").trim().slice(0, 80),
  })).filter((size) => size.label).slice(0, 80);
}

function sizesFromVariants(variants: ProductVariant[]): ProductSize[] {
  const sizes = new Map<string, ProductSize>();
  for (const variant of variants) {
    const current = sizes.get(variant.size);
    if (current) current.stock += variant.stock;
    else sizes.set(variant.size, { label: variant.size, stock: variant.stock, age: variant.age, weight: variant.weight, height: variant.height });
  }
  return [...sizes.values()];
}

export async function POST(request: Request) {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  if (!validCsrf(request, session)) return NextResponse.json({ error: "Requête refusée." }, { status: 403 });
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 1024 * 1024) return NextResponse.json({ error: "Requête trop volumineuse." }, { status: 413 });

  const body = await request.json().catch(() => ({})) as Partial<Product> & { price?: number };
  const id = body.id == null ? undefined : Number(body.id);
  const name = String(body.name ?? "").trim().slice(0, 140);
  const slug = String(body.slug ?? "").trim().toLowerCase().slice(0, 80);
  const priceCents = Number(body.priceCents ?? Math.round(Number(body.price ?? 0) * 100));
  const costCents = Number(body.costCents ?? 0);
  const compareAtCents = body.compareAtCents == null ? null : Number(body.compareAtCents);
  if ((id !== undefined && (!Number.isInteger(id) || id < 1)) || name.length < 2 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
    || !Number.isInteger(priceCents) || priceCents < 0 || priceCents > 100_000_000
    || !Number.isInteger(costCents) || costCents < 0 || costCents > 100_000_000) {
    return NextResponse.json({ error: "Nom, slug, prix ou coût invalide." }, { status: 400 });
  }
  if (compareAtCents !== null && (!Number.isInteger(compareAtCents) || compareAtCents <= priceCents || compareAtCents > 100_000_000)) {
    return NextResponse.json({ error: "L’ancien prix doit être supérieur au prix de vente." }, { status: 400 });
  }

  const status = statuses.includes(body.status as ProductStatus) ? body.status as ProductStatus : "draft";
  const requestedColors = Array.isArray(body.colors)
    ? [...new Map(body.colors.map(String).map((value) => value.trim().slice(0, 80)).filter(Boolean).map((value) => [value.toLocaleLowerCase("fr"), value])).values()].slice(0, 30)
    : [];
  const variants = cleanVariants(body.variants);
  const variantKeys = variants.map((variant) => `${variant.color.toLocaleLowerCase("fr")}\u0000${variant.size.toLocaleLowerCase("fr")}`);
  if (new Set(variantKeys).size !== variants.length) {
    return NextResponse.json({ error: "Chaque combinaison couleur et taille doit apparaître une seule fois." }, { status: 400 });
  }
  const colors = [...new Map([...requestedColors, ...variants.map((variant) => variant.color).filter(Boolean)].map((value) => [value.toLocaleLowerCase("fr"), value])).values()].slice(0, 30);
  if (colors.length && variants.some((variant) => !variant.color)) {
    return NextResponse.json({ error: "Choisissez une couleur pour chaque taille." }, { status: 400 });
  }

  const requestedSizes = cleanSizes(body.sizes);
  if (new Set(requestedSizes.map((size) => size.label.toLocaleLowerCase("fr"))).size !== requestedSizes.length) {
    return NextResponse.json({ error: "Chaque taille doit apparaître une seule fois." }, { status: 400 });
  }
  const sizes = variants.length ? sizesFromVariants(variants) : requestedSizes;
  const images = Array.isArray(body.images) ? body.images.map(String).filter(validImage).slice(0, 12) : [];
  const colorImages = body.colorImages && typeof body.colorImages === "object" && !Array.isArray(body.colorImages)
    ? Object.fromEntries(Object.entries(body.colorImages).flatMap(([color, image]) => {
      const cleanColor = color.trim().slice(0, 80);
      const cleanImage = String(image ?? "");
      return cleanColor && colors.includes(cleanColor) && images.includes(cleanImage) && validImage(cleanImage) ? [[cleanColor, cleanImage]] : [];
    }))
    : {};
  if (status === "published" && (priceCents < 1 || images.length === 0 || sizes.length === 0)) {
    return NextResponse.json({ error: "Un produit publié doit avoir un prix, une image et au moins une taille." }, { status: 400 });
  }

  // The AI importer stamps drafts with "Import IA à vérifier" and can fall back to
  // "Produit importé à vérifier" for the name. Those are notes to you, not copy for
  // a shopper — and one of them reached a live product page. Publishing is refused
  // until they are gone; saving as a draft stays free.
  if (status === "published") {
    const placeholderFields: Array<[string, string]> = [
      ["le nom", name],
      ["le badge", String(body.badge || "")],
      ["la description courte", String(body.shortDescription || "")],
      ["la description", String(body.description || "")],
    ];
    const offending = placeholderFields.filter(([, value]) => PLACEHOLDER_COPY.test(value)).map(([label]) => label);
    if (offending.length) {
      return NextResponse.json({ error: `Texte d’import automatique encore présent dans ${offending.join(", ")}. Corrigez-le avant de publier.` }, { status: 400 });
    }
  }

  const testimonials = Array.isArray(body.testimonials) ? body.testimonials.flatMap((item) => {
    if (!item || typeof item !== "object" || !String(item.quote || "").trim()) return [];
    return [{ quote: String(item.quote).trim().slice(0, 1_000), author: String(item.author || "").trim().slice(0, 100), rating: Math.min(5, Math.max(0, Number(item.rating) || 0)), source: String(item.source || "").trim().slice(0, 140) } satisfies ProductTestimonial];
  }).slice(0, 20) : [];
  const features = Array.isArray(body.features) ? body.features.map(String).map((value) => value.trim().slice(0, 240)).filter(Boolean).slice(0, 20) : [];
  const translations = Object.fromEntries((["en", "ar"] as const).flatMap((locale) => {
    const source = body.translations?.[locale];
    if (!source || typeof source !== "object") return [];
    const translation: ProductTranslation = {
      name: String(source.name ?? "").trim().slice(0, 140), shortDescription: String(source.shortDescription ?? "").trim().slice(0, 500),
      description: String(source.description ?? "").trim().slice(0, 8_000), materials: String(source.materials ?? "").trim().slice(0, 2_000), care: String(source.care ?? "").trim().slice(0, 2_000),
      features: Array.isArray(source.features) ? source.features.map(String).map((value) => value.trim().slice(0, 240)).filter(Boolean).slice(0, 20) : [],
    };
    return Object.values(translation).some((value) => Array.isArray(value) ? value.length > 0 : Boolean(value)) ? [[locale, translation]] : [];
  }));

  try {
    const previous = id ? await getProductById(id) : null;
    const product = await saveProduct({
      ...body,
      id,
      name,
      slug,
      priceCents,
      costCents,
      compareAtCents,
      currency: "DZD",
      status,
      category: String(body.category || "Ensembles").trim().slice(0, 80),
      badge: String(body.badge || "").trim().slice(0, 80) || null,
      color: colors.join(", "),
      colors,
      shortDescription: String(body.shortDescription || "").trim().slice(0, 500),
      description: String(body.description || "").trim().slice(0, 8_000),
      materials: String(body.materials || "").trim().slice(0, 2_000),
      care: String(body.care || "").trim().slice(0, 2_000),
      images,
      colorImages,
      sizes,
      variants,
      features,
      testimonials,
      translations,
    });
    revalidateTag(CATALOG_TAG);
    await audit(session.adminId, id ? "product.update" : "product.create", "product", String(product.id), { status: product.status });
    const metaAutomation = productMetaAutomationPlan(previous, product);
    if (metaAutomation.catalog || metaAutomation.pagePost || metaAutomation.instagramPost) {
      after(() => runProductMetaAutomation(previous, product));
    }
    return NextResponse.json({ product, metaAutomation });
  } catch (error) {
    const message = error instanceof Error && error.message.includes("UNIQUE") ? "Ce slug est déjà utilisé."
      : error instanceof Error && error.message === "PRODUCT_NOT_FOUND" ? "Produit introuvable."
        : "Enregistrement impossible.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request) {
  const session = await requireAdminApi();
  if (!session) return NextResponse.json({ error: "Non autorisé." }, { status: 401 });
  if (!validCsrf(request, session)) return NextResponse.json({ error: "Requête refusée." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { id?: number };
  const id = Number(body.id);
  if (!Number.isInteger(id) || id < 1) return NextResponse.json({ error: "Produit invalide." }, { status: 400 });
  try {
    const deleted = await deleteProduct(id);
    if (!deleted) return NextResponse.json({ error: "Produit introuvable." }, { status: 404 });
    revalidateTag(CATALOG_TAG);
    await audit(session.adminId, "product.delete", "product", String(id), { name: deleted.name, slug: deleted.slug });
    if (process.env.META_AUTO_CATALOG_SYNC_ENABLED === "true") {
      after(() => runDeletedProductMetaAutomation(deleted));
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.message === "PRODUCT_HAS_RESERVED_ORDERS") {
      return NextResponse.json({ error: "Ce produit appartient à une commande en cours. Archivez-le au lieu de le supprimer." }, { status: 409 });
    }
    return NextResponse.json({ error: "Suppression impossible." }, { status: 500 });
  }
}
