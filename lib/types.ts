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
  /** Bureau ZR choisi par le client quand deliveryType vaut "office". Devine a l'expedition si absent. */
  deliveryHubId: string | null;
  deliveryHubName: string | null;
  /** Fil WhatsApp de confirmation, recopie du Sheet ou l’agent l’ecrit. Lecture seule. */
  /** Etat brut ecrit par l’agent depuis ZR Express (ZR_ERROR, MISSED_ATTEMPT, NO_REPLY…).
   *  Le statut a neuf valeurs ci-dessus l’appauvrit : les KPI lisent celui-ci. */
  sheetState: string | null;
  whatsappLog: string | null;
  whatsappLogAt: string | null;
  deliveryExternalId: string | null;
  /** Numero de suivi ZR Express, recopie de la feuille ou l'agent l'ecrit. */
  deliveryTracking: string | null;
  deliverySyncStatus: "not_configured" | "pending" | "sent" | "failed";
  deliverySyncError: string | null;
  notes: string;
  status: OrderStatus;
  items: OrderItem[];
  subtotalCents: number;
  shippingCents: number;
  totalCents: number;
  statusHistory: OrderStatusHistoryEntry[];
  refunds: OrderRefund[];
  deliveryCost: OrderDeliveryCost | null;
  attribution: OrderAttribution | null;
  sheetSyncedAt: string | null;
  sheetAttempts: number;
  sheetLastError: string | null;
  createdAt: string;
  updatedAt: string;
};

export type OrderAttribution = {
  orderId: number;
  isMetaLastTouch: boolean;
  isMetaFirstTouch: boolean;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  firstUtmCampaign: string | null;
  landingPage: string | null;
  referrer: string | null;
  firstTouchAt: string;
  lastTouchAt: string;
};

export type OrderStatusHistoryEntry = {
  id: number;
  orderId: number;
  status: OrderStatus;
  changedByAdminId: number | null;
  reasonCode: string | null;
  note: string | null;
  createdAt: string;
};

export type OrderRefund = {
  id: number;
  orderId: number;
  amountCents: number;
  reason: string;
  createdByAdminId: number | null;
  createdAt: string;
};

export type OrderDeliveryCost = {
  orderId: number;
  carrierCostCents: number;
  returnCostCents: number;
  source: string;
  updatedAt: string;
};

export type ProductCost = {
  id: number;
  productId: number;
  costCents: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
};

export type ExpenseRecurrence = "one_time" | "recurring";
export type ExpenseCostType = "fixed" | "variable";
export type ExpenseAllocationMethod = "revenue_weighted" | "even_split";

export type Expense = {
  id: number;
  category: string;
  amountCents: number;
  currency: string;
  recurrence: ExpenseRecurrence;
  costType: ExpenseCostType;
  effectiveFrom: string;
  effectiveTo: string | null;
  allocationMethod: ExpenseAllocationMethod;
  notes: string;
  source: string;
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
  /** Charged to the customer — revenue. */
  homeCents: number;
  officeCents: number;
  /**
   * Reserved, not surfaced in the admin and currently always 0.
   * ZR Express charges nothing to send — the customer's delivery fee is passed straight to
   * them — so an order's send cost is derived from its own shipping_cents, not from here.
   * These stay for the day a carrier does bill a separate sending fee.
   */
  carrierHomeCents: number;
  carrierOfficeCents: number;
  /** Billed on a refused or returned parcel. The only thing ZR actually invoices. */
  returnCostCents: number;
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
