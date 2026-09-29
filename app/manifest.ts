import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/admin",
    name: "Lovely Step Administration",
    short_name: "Lovely Step",
    description: "Commandes, stock et administration Lovely Step.",
    start_url: "/admin",
    scope: "/",
    display: "standalone",
    background_color: "#faeee1",
    theme_color: "#1e416a",
    orientation: "portrait-primary",
    icons: [
      { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
      { src: "/favicon.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
