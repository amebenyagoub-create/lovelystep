import "server-only";

import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type Response } from "playwright";
import { db, saveProduct } from "../db";

const SOURCE_HOSTS = ["1688.com"];
const IMAGE_HOSTS = ["1688.com", "alicdn.com", "tbcdn.cn", "tbcdn.com"];

function allowedHost(hostname: string, roots: string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return roots.some((root) => host === root || host.endsWith(`.${root}`));
}

export function assert1688Url(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("L’URL n’est pas valide."); }
  if (url.protocol !== "https:" || !allowedHost(url.hostname, SOURCE_HOSTS)) throw new Error("Seules les URLs HTTPS de 1688.com sont autorisées.");
  url.username = "";
  url.password = "";
  return url;
}

function slugify(value: string): string {
  const slug = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 70);
  return slug || `produit-1688-${Date.now().toString(36)}`;
}

async function safeJson(response: Response): Promise<unknown | null> {
  try {
    const length = Number(response.headers()["content-length"] ?? 0);
    if (length > 2_000_000) return null;
    const type = response.headers()["content-type"] ?? "";
    if (!type.includes("json") && !response.url().includes("offer")) return null;
    return await response.json();
  } catch { return null; }
}

async function downloadImage(urlValue: string, destination: string): Promise<string | null> {
  try {
    const url = new URL(urlValue.startsWith("//") ? `https:${urlValue}` : urlValue);
    if (url.protocol !== "https:" || !allowedHost(url.hostname, IMAGE_HOSTS)) return null;
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { "user-agent": "Mozilla/5.0 LovelyStepImporter/1.0" } });
    if (!response.ok) return null;
    const type = response.headers.get("content-type")?.split(";")[0] ?? "";
    const extensions: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
    const extension = extensions[type];
    if (!extension) return null;
    const data = Buffer.from(await response.arrayBuffer());
    if (data.byteLength > 10_000_000) return null;
    await fs.writeFile(`${destination}${extension}`, data, { flag: "wx" });
    return `${destination}${extension}`;
  } catch { return null; }
}

export type ScrapedProduct = {
  title: string;
  priceText: string;
  description: string;
  imageUrls: string[];
  localImages: string[];
  skuText: string[];
  privateSourceNotes: {
    networkPayloads: unknown[];
    jsonLd: unknown[];
    specifications: string[];
    supplierReviewExcerpts: string[];
    pageTextExcerpt: string;
    pageUrl: string;
    capturedAt: string;
  };
};

export async function scrape1688Product(sourceValue: string, jobId: number): Promise<ScrapedProduct> {
  const source = assert1688Url(sourceValue);
  const profile = path.join(process.cwd(), "data", "1688-profile");
  await fs.mkdir(profile, { recursive: true });
  const context = await chromium.launchPersistentContext(profile, {
    headless: true,
    locale: "zh-CN",
    viewport: { width: 1440, height: 1000 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36",
  });
  const page = context.pages()[0] ?? await context.newPage();
  const payloads: unknown[] = [];
  page.on("response", async (response) => {
    if (payloads.length >= 12 || !["xhr", "fetch"].includes(response.request().resourceType())) return;
    const value = await safeJson(response);
    if (value) payloads.push(value);
  });
  try {
    await page.goto(source.toString(), { waitUntil: "domcontentloaded", timeout: 45_000 });
    const finalUrl = new URL(page.url());
    if (!allowedHost(finalUrl.hostname, SOURCE_HOSTS)) throw new Error("1688 a redirigé vers un domaine non autorisé.");
    await page.waitForTimeout(2500);
    const text = (await page.locator("body").innerText({ timeout: 8_000 })).slice(0, 80_000);
    if (/验证码|滑动验证|请登录|login|captcha/i.test(text.slice(0, 5000))) {
      const error = new Error("Connexion ou vérification 1688 requise. Lancez d’abord npm run 1688:login.");
      error.name = "Needs1688Login";
      throw error;
    }
    const extracted = await page.evaluate(() => {
      const meta = (key: string) => document.querySelector<HTMLMetaElement>(`meta[property='${key}'],meta[name='${key}']`)?.content?.trim() ?? "";
      const images = Array.from(document.images).map((img) => img.currentSrc || img.src).filter(Boolean);
      const title = meta("og:title") || document.querySelector("h1")?.textContent?.trim() || document.title;
      const description = meta("og:description") || document.querySelector("[class*='description'],[class*='detail']")?.textContent?.trim() || "";
      const priceCandidates = Array.from(document.querySelectorAll("[class*='price'],[data-price]"))
        .map((el) => el.textContent?.trim() ?? "").filter((value) => /\d/.test(value)).slice(0, 10);
      const skuText = Array.from(document.querySelectorAll("[class*='sku'],[class*='spec'],[class*='prop']"))
        .map((el) => el.textContent?.trim() ?? "").filter((value) => value.length > 0 && value.length < 200).slice(0, 30);
      const jsonLd = Array.from(document.querySelectorAll<HTMLScriptElement>("script[type='application/ld+json']")).map((script) => {
        try { return JSON.parse(script.textContent || "null"); } catch { return null; }
      }).filter(Boolean).slice(0, 10);
      const specifications = Array.from(document.querySelectorAll("table tr,[class*='attribute'],[class*='parameter'],[class*='property']"))
        .map((el) => el.textContent?.replace(/\s+/g, " ").trim() ?? "").filter((value) => value.length > 2 && value.length < 500).slice(0, 120);
      const supplierReviewExcerpts = Array.from(document.querySelectorAll("[class*='review'],[class*='comment'],[class*='evaluate']"))
        .map((el) => el.textContent?.replace(/\s+/g, " ").trim() ?? "").filter((value) => value.length > 5 && value.length < 1000).slice(0, 60);
      return { title, description, images, priceCandidates, skuText, jsonLd, specifications, supplierReviewExcerpts };
    });
    const imageUrls = [...new Set(extracted.images)].filter((value) => {
      try { return allowedHost(new URL(value.startsWith("//") ? `https:${value}` : value).hostname, IMAGE_HOSTS); } catch { return false; }
    }).slice(0, 12);
    const uploadDir = path.join(process.cwd(), "public", "uploads", "imports", String(jobId));
    await fs.mkdir(uploadDir, { recursive: true });
    const localImages: string[] = [];
    for (let index = 0; index < Math.min(8, imageUrls.length); index += 1) {
      const base = path.join(uploadDir, `image-${index + 1}`);
      const saved = await downloadImage(imageUrls[index], base);
      if (saved) localImages.push(`/uploads/imports/${jobId}/${path.basename(saved)}`);
    }
    return {
      title: extracted.title.slice(0, 180), priceText: extracted.priceCandidates[0] ?? "", description: extracted.description.slice(0, 5000),
      imageUrls, localImages, skuText: [...new Set(extracted.skuText)],
      privateSourceNotes: {
        networkPayloads: payloads,
        jsonLd: extracted.jsonLd,
        specifications: [...new Set(extracted.specifications)],
        supplierReviewExcerpts: [...new Set(extracted.supplierReviewExcerpts)],
        pageTextExcerpt: text.slice(0, 30_000),
        pageUrl: page.url(), capturedAt: new Date().toISOString(),
      },
    };
  } finally { await context.close(); }
}

export function createDraftFromScrape(sourceUrl: string, scraped: ScrapedProduct) {
  const numericPrice = Number((scraped.priceText.match(/[\d.,]+/)?.[0] ?? "0").replace(",", "."));
  const product = saveProduct({
    name: scraped.title || "Produit importé 1688",
    slug: `${slugify(scraped.title)}-${Date.now().toString(36).slice(-5)}`,
    shortDescription: "Brouillon importé depuis 1688 — à traduire et valider avant publication.",
    description: scraped.description,
    priceCents: Number.isFinite(numericPrice) ? Math.round(numericPrice * 100) : 0,
    status: "draft", category: "À classer", sourceUrl,
    images: scraped.localImages, sizes: [], features: [],
  });
  db.prepare("UPDATE products SET source_data_json=? WHERE id=?").run(JSON.stringify(scraped), product.id);
  return product;
}
