import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getProductById, recordVisit } from "@/lib/db";

const COOKIE_NAME = "lovelystep_visitor";

export async function POST(request: NextRequest) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 4 * 1024) return NextResponse.json({ error: "Requête trop volumineuse." }, { status: 413 });
  const body = await request.json().catch(() => ({})) as { path?: string; productId?: number };
  const visitPath = String(body.path ?? "").slice(0, 200);
  if (!/^\/(?:$|produits\/[a-z0-9-]+$)/.test(visitPath)) return NextResponse.json({ error: "Page invalide." }, { status: 400 });
  const requestedProductId = body.productId == null ? null : Number(body.productId);
  const productId = requestedProductId && Number.isInteger(requestedProductId) && getProductById(requestedProductId) ? requestedProductId : null;
  const existing = request.cookies.get(COOKIE_NAME)?.value;
  const visitorToken = existing && /^[a-f0-9]{32}$/.test(existing) ? existing : crypto.randomBytes(16).toString("hex");
  const visitorHash = crypto.createHash("sha256").update(visitorToken).digest("hex");
  recordVisit(visitorHash, visitPath, productId);
  const response = NextResponse.json({ ok: true });
  if (visitorToken !== existing) response.cookies.set(COOKIE_NAME, visitorToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true" || (process.env.COOKIE_SECURE !== "false" && process.env.NODE_ENV === "production"),
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}
