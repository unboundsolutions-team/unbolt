import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { Cursor } from "@/components/motion/cursor";
import { MotionProvider } from "@/components/motion/motion-provider";
import { Preloader } from "@/components/motion/preloader";
import { ScrollProgress } from "@/components/motion/scroll-progress";
import { SmoothScroll } from "@/components/motion/smooth-scroll";
import { SITE } from "@/content/site";
import { ACTIVE_THEME, THEME_COLOR } from "@/lib/theme";

import { fontVariables } from "./fonts";

import "./globals.css";

const isProduction = process.env["NEXT_PUBLIC_APP_ENV"] === "production";
const siteUrl = process.env["NEXT_PUBLIC_SITE_URL"] ?? SITE.url;

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: `${SITE.name} — ${SITE.tagline}`,
    template: `%s · ${SITE.name}`,
  },
  description: SITE.description,
  applicationName: SITE.name,
  authors: [{ name: SITE.parent }],
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
    url: siteUrl,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE.name} — ${SITE.tagline}`,
    description: SITE.description,
  },
  alternates: { canonical: "/" },
  // Preview and staging deploys must never reach the index. Runtime metadata
  // rather than a netlify.toml header, because a static header would also hit
  // production.
  robots: isProduction
    ? { index: true, follow: true }
    : { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = {
  themeColor: THEME_COLOR[ACTIVE_THEME],
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme={ACTIVE_THEME} className={fontVariables}>
      <body>
        <a href="#main" className="u-skip-link">
          Skip to content
        </a>
        <Preloader />
        <Cursor />
        <ScrollProgress />
        <MotionProvider>
          <SmoothScroll />
          {children}
        </MotionProvider>
      </body>
    </html>
  );
}
