import localFont from "next/font/local";

/**
 * Fonts are self-hosted from /public/fonts via next/font/local, never fetched
 * from Google.
 *
 *  1. No third-party origin in the CSP. Middleware emits a nonce-based policy;
 *     adding fonts.googleapis.com and fonts.gstatic.com to it just to render
 *     body copy is a poor trade.
 *  2. The build does not depend on a network call to a service we don't own.
 *     netlify.toml already caches /fonts/* as immutable for a year, which only
 *     makes sense for files we ship.
 *  3. One fewer DNS lookup and TLS handshake on the critical path.
 *
 * The .woff2 files come from the Fontsource packages pinned in devDependencies.
 * They are not fetched at runtime or at build time.
 *
 * All three display faces load because a theme swap (src/lib/theme.ts) must be
 * a one-line change. They cost ~120 KB combined, cached immutably, and only the
 * active theme's face is ever painted — but see §10 of the brief: once a theme
 * is final for good, drop the other two `localFont` calls to reclaim that.
 */

/** Nightshift — geometric, slightly odd, carries the character. */
export const syne = localFont({
  src: [{ path: "../../public/fonts/syne.woff2", weight: "400 800", style: "normal" }],
  variable: "--font-syne",
  display: "swap",
  preload: true,
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
  adjustFontFallback: "Arial",
});

/** Meridian — wide, premium, expensive-looking. */
export const unbounded = localFont({
  src: [{ path: "../../public/fonts/unbounded.woff2", weight: "200 900", style: "normal" }],
  variable: "--font-unbounded",
  display: "swap",
  preload: false,
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
  adjustFontFallback: "Arial",
});

/** Flux — condensed, loud, poster-scale. */
export const bigShoulders = localFont({
  src: [{ path: "../../public/fonts/big-shoulders.woff2", weight: "300 900", style: "normal" }],
  variable: "--font-shoulders",
  display: "swap",
  preload: false,
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
  adjustFontFallback: "Arial",
});

/** Reading copy and UI, every theme. */
export const spaceGrotesk = localFont({
  src: [{ path: "../../public/fonts/space-grotesk.woff2", weight: "300 700", style: "normal" }],
  variable: "--font-space",
  display: "swap",
  preload: true,
  fallback: ["ui-sans-serif", "system-ui", "sans-serif"],
  adjustFontFallback: "Arial",
});

/**
 * Ticket refs, timestamps, SLA clocks, section markers. Two static weights
 * rather than a variable face — the mono is used at small sizes in exactly two
 * weights, so a variable file would be dead bytes.
 */
export const plexMono = localFont({
  src: [
    { path: "../../public/fonts/plex-mono-400.woff2", weight: "400", style: "normal" },
    { path: "../../public/fonts/plex-mono-500.woff2", weight: "500", style: "normal" },
  ],
  variable: "--font-plex-mono",
  display: "swap",
  preload: true,
  fallback: ["ui-monospace", "monospace"],
});

export const fontVariables = [
  syne.variable,
  unbounded.variable,
  bigShoulders.variable,
  spaceGrotesk.variable,
  plexMono.variable,
].join(" ");
