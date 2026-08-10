import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getProductBySlug, listProducts } from "@/lib/db";
import ProductDetail from "./product-detail";
import { toPublicProduct } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const product = getProductBySlug((await params).slug);
  if (!product) return {};
  return { title: product.seoTitle || product.name, description: product.seoDescription || product.shortDescription, openGraph: { images: product.images[0] ? [product.images[0]] : [] } };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const product = getProductBySlug((await params).slug);
  if (!product) notFound();
  const related = listProducts().filter((item) => item.id !== product.id).slice(0, 3);
  return <ProductDetail product={toPublicProduct(product)} related={related.map(toPublicProduct)} />;
}
