export type Product = {
  id: string;
  name: string;
  price: number;
  compareAt?: number;
  badge?: string;
  category: "Sets" | "Tops" | "Playwear" | "Accessories";
  ageMin: number;
  ageMax: number;
  image: string;
  alt: string;
  color: string;
  sizes: string[];
};

export const PRODUCTS: Product[] = [
  {
    id: "sunny-day-set",
    name: "Sunny Day Set",
    price: 34,
    compareAt: 42,
    badge: "Bestseller",
    category: "Sets",
    ageMin: 3,
    ageMax: 8,
    image: "/images/sunny-set.jpg",
    alt: "Child smiling in a bright blue cardigan and shorts",
    color: "Pool blue",
    sizes: ["3–4Y", "5–6Y", "7–8Y"],
  },
  {
    id: "little-artist-overall",
    name: "Little Artist Overall",
    price: 29,
    badge: "New",
    category: "Playwear",
    ageMin: 2,
    ageMax: 7,
    image: "/images/playtime.jpg",
    alt: "Child in overalls enjoying colorful creative play",
    color: "Cloud wash",
    sizes: ["2–3Y", "4–5Y", "6–7Y"],
  },
  {
    id: "explorer-stripe-tee",
    name: "Explorer Stripe Tee",
    price: 22,
    badge: "Soft cotton",
    category: "Tops",
    ageMin: 2,
    ageMax: 8,
    image: "/images/cozy-knit.jpg",
    alt: "Child wearing a soft blue striped top",
    color: "Ocean stripe",
    sizes: ["2–3Y", "4–5Y", "6–8Y"],
  },
  {
    id: "mini-muse-set",
    name: "Mini Muse Set",
    price: 27,
    category: "Sets",
    ageMin: 1,
    ageMax: 5,
    image: "/images/little-explorer.jpg",
    alt: "Young child playing in a striped everyday outfit",
    color: "Pebble stripe",
    sizes: ["1–2Y", "3–4Y", "4–5Y"],
  },
  {
    id: "weekend-move-top",
    name: "Weekend Move Top",
    price: 24,
    badge: "Easy care",
    category: "Tops",
    ageMin: 5,
    ageMax: 10,
    image: "/images/weekend-club.jpg",
    alt: "Child wearing a comfortable red weekend top",
    color: "Cherry pop",
    sizes: ["5–6Y", "7–8Y", "9–10Y"],
  },
  {
    id: "adventure-daypack",
    name: "Adventure Daypack",
    price: 18,
    badge: "Few left",
    category: "Accessories",
    ageMin: 4,
    ageMax: 10,
    image: "/images/soft-days.jpg",
    alt: "Child heading out with a playful everyday backpack",
    color: "Hero blue",
    sizes: ["One size"],
  },
];

export const PRODUCT_BY_ID = new Map(
  PRODUCTS.map((product) => [product.id, product]),
);
