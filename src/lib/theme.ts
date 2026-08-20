/**
 * The active visual theme.
 *
 * Three themes are approved and fully specified in globals.css. Changing this
 * one constant swaps the entire site — palette, accent, display typeface and
 * the animated background field — because every component resolves from tokens
 * and never hardcodes a value.
 *
 * `npm run tokens:contrast` holds all three to the same WCAG 2.2 AA contract,
 * so a swap cannot quietly drop the site below AA.
 *
 *   nightshift  near-black · lime drift · Syne          ← active
 *   meridian    near-black · vermilion  · Unbounded
 *   flux        near-black · acid       · Big Shoulders
 */
export const THEMES = ["nightshift", "meridian", "flux"] as const;

export type Theme = (typeof THEMES)[number];

export const ACTIVE_THEME: Theme = "nightshift";

/** Browser-chrome colour. Must match --color-base for the active theme;
 *  asserted by scripts/check-contrast.ts so it cannot drift. */
export const THEME_COLOR: Record<Theme, string> = {
  // eslint-disable-next-line no-restricted-syntax -- meta theme-color cannot reference a CSS variable
  nightshift: "#050608",
  // eslint-disable-next-line no-restricted-syntax -- see above
  meridian: "#08090d",
  // eslint-disable-next-line no-restricted-syntax -- see above
  flux: "#0a070d",
};
