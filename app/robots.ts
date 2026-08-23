import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  const origin = siteUrl() || "https://lovelystep.com";
  return {
    rules: [{
      userAgent: "*",
      allow: "/",
      // The admin area and every API route are useless to a crawler and the
      // admin one is actively undesirable in an index.
      disallow: ["/admin", "/admin/", "/api/"],
    }],
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
