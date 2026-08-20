import type { MetadataRoute } from "next";

import { SITE } from "@/content/site";

/**
 * Preview and staging deploys must never be indexed. Netlify sets
 * NEXT_PUBLIC_APP_ENV per deploy context, so a preview serves a blanket
 * disallow while production serves the real policy.
 */
export default function robots(): MetadataRoute.Robots {
  const base = process.env["NEXT_PUBLIC_SITE_URL"] ?? SITE.url;
  const isProduction = process.env["NEXT_PUBLIC_APP_ENV"] === "production";

  if (!isProduction) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/app/", "/admin/", "/api/"] }],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
