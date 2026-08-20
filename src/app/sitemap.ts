import type { MetadataRoute } from "next";

import { SITE } from "@/content/site";

/**
 * Only routes that actually exist and are indexable.
 *
 * Deliberately absent: the component gallery (a `(dev)` route group), and
 * /login and /register, which are noindex — a sign-in page has no business in
 * search results.
 */
const ROUTES = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/pricing", priority: 0.9, changeFrequency: "monthly" },
  { path: "/how-it-works", priority: 0.8, changeFrequency: "monthly" },
  { path: "/services", priority: 0.7, changeFrequency: "monthly" },
  { path: "/tools/store-health-scan", priority: 0.8, changeFrequency: "monthly" },
  { path: "/contact", priority: 0.6, changeFrequency: "yearly" },
  { path: "/security", priority: 0.5, changeFrequency: "yearly" },
  { path: "/legal/terms", priority: 0.3, changeFrequency: "yearly" },
  { path: "/legal/privacy", priority: 0.3, changeFrequency: "yearly" },
] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  const base = process.env["NEXT_PUBLIC_SITE_URL"] ?? SITE.url;
  return ROUTES.map((r) => ({
    url: `${base}${r.path}`,
    lastModified: now,
    changeFrequency: r.changeFrequency,
    priority: r.priority,
  }));
}
