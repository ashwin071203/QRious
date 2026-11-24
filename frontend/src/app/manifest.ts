import type { MetadataRoute } from "next";

/** Web app manifest: installable QRious (needed for push notifications on iOS 16.4+, which only allows them for home-screen apps). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "QRious",
    short_name: "QRious",
    description: "One event. Many connections.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#100B1D",
    theme_color: "#100B1D",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
