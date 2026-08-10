export type ProductStatus = "draft" | "published" | "archived";

export type ProductSize = {
  label: string;
  stock: number;
  age?: string;
  weight?: string;
  height?: string;
};

export type ProductVariant = {
  color: string;
  size: string;
  stock: number;
  age?: string;
  weight?: string;
  height?: string;
};

export type ProductTestimonial = {
  quote: string;
  author?: string;
  rating?: number;
  source?: string;
};

export type ProductTranslation = {
  name?: string;
  shortDescription?: string;
  description?: string;
  materials?: string;
  care?: string;
  features?: string[];
};

export type Product = {
  id: number;
  slug: string;
  name: string;
  shortDescription: string;
  description: string;
  priceCents: number;
  costCents: number;
  compareAtCents: number | null;
  currency: string;
  status: ProductStatus;
  category: string;
  badge: string | null;
  color: string;
  colors: string[];
  materials: string;
  care: string;
  sourceUrl: string | null;
  images: string[];
  colorImages: Record<string, string>;
  sizes: ProductSize[];
  variants: ProductVariant[];
  features: string[];
  testimonials: ProductTestimonial[];
  translations: { en?: ProductTranslation; ar?: ProductTranslation };
  sizeGuideImage: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PublicProduct = Omit<Product, "costCents">;

export function toPublicProduct(product: Product): PublicProduct {
  const { costCents: _privateCost, ...publicProduct } = product;
  void _privateCost;
  return publicProduct;
}

export type OrderStatus = "new" | "to_confirm" | "confirmed" | "preparing" | "shipped" | "delivered" | "refused" | "returned" | "cancelled";

export type OrderItem = {
  productId: number;
  slug: string;
  name: string;
  image: string;
  size: string;
  color?: string;
  quantity: number;
  unitPriceCents: number;
  unitCostCents?: number;
};

export type Order = {
  id: number;
  orderNumber: string;
  customerId: number | null;
  firstName: string;
  lastName: string;
  customerName: string;
  phone: string;
  city: string;
  wilayaCode: string;
  wilayaName: string;
  commune: string;
  address: string;
  deliveryType: DeliveryType;
  deliveryExternalId: string | null;
  deliverySyncStatus: "not_configured" | "pending" | "sent" | "failed";
  deliverySyncError: string | null;
  notes: string;
  status: OrderStatus;
  items: OrderItem[];
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  createdAt: string;
  updatedAt: string;
};

export type DeliveryType = "home" | "office";

export type AlgeriaCommune = {
  code: string;
  nameFr: string;
  nameAr: string;
};

export type AlgeriaWilaya = {
  code: string;
  nameFr: string;
  nameAr: string;
  communes: AlgeriaCommune[];
};

export type Customer = {
  id: number;
  firstName: string;
  lastName: string;
  phone: string;
  wilayaCode: string;
  wilayaName: string;
  commune: string;
  address: string;
  createdAt: string;
  updatedAt: string;
};

export type LocalizedText = { fr: string; en: string; ar: string };

export type StoreSettings = {
  announcement: LocalizedText;
  heroEyebrow: LocalizedText;
  heroTitle: LocalizedText;
  heroAccent: LocalizedText;
  heroDescription: LocalizedText;
  primaryCta: LocalizedText;
  storyTitle: LocalizedText;
  storyDescription: LocalizedText;
  heroImage: string | null;
  theme: {
    navy: string;
    coral: string;
    cream: string;
    sand: string;
    background: string;
  };
};

export type DeliveryRate = {
  wilayaCode: string;
  wilayaNameFr: string;
  wilayaNameAr: string;
  homeCents: number;
  officeCents: number;
  active: boolean;
};

export type DeliveryIntegration = {
  enabled: boolean;
  providerName: string;
  baseUrl: string;
  createShipmentPath: string;
  apiTokenEnv: string;
};

export type ImportJob = {
  id: number;
  sourceUrl: string;
  status: "queued" | "running" | "draft_created" | "needs_login" | "failed";
  error: string | null;
  productId: number | null;
  extracted: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};
