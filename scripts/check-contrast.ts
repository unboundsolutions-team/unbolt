/**
 * WCAG 2.2 contrast gate — run against EVERY approved theme.
 *
 * Reads real values out of src/app/globals.css so the stylesheet stays the
 * single source of truth. Each theme is a complete override of the `:root`
 * token set, so each is resolved separately and held to the same contract.
 *
 * This is what makes `ACTIVE_THEME` safe to change: you cannot swap the site
 * to a theme that fails AA, because CI checks all of them on every commit.
 *
 *   npm run tokens:contrast
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CSS = join("src", "app", "globals.css");
const THEME_TS = join("src", "lib", "theme.ts");
const BUTTON_TSX = join("src", "components", "ui", "button.tsx");

/* ── Colour maths ───────────────────────────────────────────── */

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "").trim();
  const full =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  const r = Number.parseInt(full.slice(0, 2), 16);
  const g = Number.parseInt(full.slice(2, 4), 16);
  const b = Number.parseInt(full.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) throw new Error(`Unparseable colour: ${hex}`);
  return [r / 255, g / 255, b / 255];
}

function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/* ── Token extraction, per theme ────────────────────────────── */

const HEX = /(--color-[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g;

function tokensFrom(block: string): Map<string, string> {
  const out = new Map<string, string>();
  let m: RegExpExecArray | null;
  HEX.lastIndex = 0;
  while ((m = HEX.exec(block)) !== null) {
    const [, name, value] = m;
    if (name && value) out.set(name, value);
  }
  return out;
}

/** `@theme { … }` is the base; each `[data-theme="x"] { … }` overrides it. */
function readThemes(): Map<string, Map<string, string>> {
  const css = readFileSync(CSS, "utf8");

  const baseStart = css.indexOf("@theme {");
  if (baseStart === -1) throw new Error("@theme block not found");
  const base = tokensFrom(css.slice(baseStart, css.indexOf("\n}", baseStart)));
  if (base.size === 0) throw new Error("no colour tokens in @theme");

  const themes = new Map<string, Map<string, string>>();
  themes.set("nightshift", base);

  const re = /\[data-theme="([a-z-]+)"\]\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const name = m[1];
    if (!name) continue;
    const end = css.indexOf("\n}", m.index);
    const overrides = tokensFrom(css.slice(m.index, end));
    themes.set(name, new Map([...base, ...overrides]));
  }
  return themes;
}

/* ── The contract ───────────────────────────────────────────── */

type Level = "AA-text" | "AA-ui";
const THRESHOLD: Record<Level, number> = { "AA-text": 4.5, "AA-ui": 3 };

interface Pair {
  fg: string;
  bg: string;
  level: Level;
  note: string;
}

/** Every surface a component is allowed to sit on. */
const SURFACES = [
  "--color-base",
  "--color-raised",
  "--color-card",
  "--color-inset",
] as const;

const PAIRS: Pair[] = [
  ...SURFACES.flatMap((bg): Pair[] => [
    { fg: "--color-ink", bg, level: "AA-text", note: "body ink" },
    { fg: "--color-ink-2", bg, level: "AA-text", note: "secondary ink" },
    { fg: "--color-ink-3", bg, level: "AA-text", note: "tertiary ink" },
    { fg: "--color-accent", bg, level: "AA-text", note: "accent text / link" },
    { fg: "--color-accent", bg, level: "AA-ui", note: "focus ring" },
  ]),

  // The accent as a filled control — the only colour allowed on it.
  { fg: "--color-accent-ink", bg: "--color-accent", level: "AA-text", note: "primary button" },
  {
    fg: "--color-accent-ink",
    bg: "--color-accent-hover",
    level: "AA-text",
    note: "primary button hover",
  },
  {
    fg: "--color-accent-ink",
    bg: "--color-accent-pressed",
    level: "AA-text",
    note: "primary button pressed",
  },

  // Status pills: each hue on its own soft fill, and bare on the base.
  { fg: "--color-queued", bg: "--color-queued-soft", level: "AA-text", note: "queued pill" },
  { fg: "--color-progress", bg: "--color-progress-soft", level: "AA-text", note: "in-progress pill" },
  { fg: "--color-shipped", bg: "--color-shipped-soft", level: "AA-text", note: "shipped pill" },
  { fg: "--color-urgent", bg: "--color-urgent-soft", level: "AA-text", note: "urgent pill" },
  { fg: "--color-progress", bg: "--color-base", level: "AA-text", note: "in-progress text" },
  { fg: "--color-shipped", bg: "--color-base", level: "AA-text", note: "shipped text" },
  { fg: "--color-urgent", bg: "--color-base", level: "AA-text", note: "urgent text" },
  { fg: "--color-accent", bg: "--color-accent-soft", level: "AA-text", note: "accent on soft" },

  // Cards sit on raised surfaces; ink must survive that too.
  { fg: "--color-ink", bg: "--color-card", level: "AA-text", note: "card ink" },
  { fg: "--color-ink-2", bg: "--color-card", level: "AA-text", note: "card secondary ink" },
];

/* ── theme-color assertion ──────────────────────────────────── */

function checkThemeColors(themes: Map<string, Map<string, string>>): string[] {
  const src = readFileSync(THEME_TS, "utf8");
  const issues: string[] = [];
  for (const [name, tokens] of themes) {
    const re = new RegExp(`${name}:\\s*"(#[0-9a-fA-F]{3,8})"`);
    const found = re.exec(src);
    if (!found?.[1]) {
      issues.push(`THEME_COLOR is missing an entry for "${name}"`);
      continue;
    }
    const base = tokens.get("--color-base");
    if (base && found[1].toLowerCase() !== base.toLowerCase()) {
      issues.push(
        `THEME_COLOR.${name} (${found[1]}) does not match --color-base (${base})`,
      );
    }
  }
  return issues;
}

/* ── Disabled-state assertion ───────────────────────────────── */

/**
 * A disabled control still has to be readable.
 *
 * ── What this caught ────────────────────────────────────────
 * Disabled buttons were `opacity-45`. Fading a filled button composites both
 * its background and its label toward the page, and they converge: the primary
 * button's label measured 3.92:1 in Nightshift and 2.02:1 in Meridian — under
 * AA, on a control that stays disabled for the ~30 seconds a store scan takes.
 * Nothing in the pairing table above could see it, because every pairing there
 * assumes full opacity.
 *
 * The fix was to stop using opacity on filled controls. So this asserts two
 * things: that the disabled tokens actually pair to AA, and that opacity has
 * not crept back in — because an opacity-faded control is a contrast this gate
 * cannot reason about from tokens alone.
 */
function checkDisabledStates(themes: Map<string, Map<string, string>>): string[] {
  const src = readFileSync(BUTTON_TSX, "utf8");
  const issues: string[] = [];

  // Strip comments first: this file explains why opacity was removed, and the
  // explanation contains the very pattern being searched for.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const opacity = /disabled:opacity-(\d+)/.exec(code);
  if (opacity) {
    issues.push(
      `button.tsx uses disabled:opacity-${opacity[1]}. Fading a filled control ` +
        `converges its label and its background; use disabled: tokens instead.`,
    );
  }

  const fgMatch = /disabled:text-([a-z0-9-]+)/.exec(src);
  const bgMatch = /disabled:bg-([a-z0-9-]+)/.exec(src);
  if (!fgMatch?.[1] || !bgMatch?.[1]) {
    return [...issues, "button.tsx declares no disabled: text/bg token pair"];
  }

  const fgToken = `--color-${fgMatch[1]}`;
  const bgToken = `--color-${bgMatch[1]}`;

  for (const [name, tokens] of themes) {
    const fg = tokens.get(fgToken);
    const bg = tokens.get(bgToken);
    if (!fg || !bg) {
      issues.push(`${name}: disabled pairing references unknown token ${!fg ? fgToken : bgToken}`);
      continue;
    }
    const ratio = contrast(fg, bg);
    if (ratio < THRESHOLD["AA-text"]) {
      issues.push(
        `${name}: disabled button label is ${ratio.toFixed(2)}:1 ` +
          `(min ${THRESHOLD["AA-text"]}) [${fgMatch[1]} on ${bgMatch[1]}]`,
      );
    }
  }
  return issues;
}

/* ── Run ────────────────────────────────────────────────────── */

function main(): void {
  const themes = readThemes();
  const failures: string[] = [];

  console.log(
    `Design token contrast — ${themes.size} theme(s) × ${PAIRS.length} pairings, WCAG 2.2\n`,
  );

  for (const [theme, tokens] of themes) {
    let worst = Number.POSITIVE_INFINITY;
    let worstNote = "";
    const themeFailures: string[] = [];

    for (const { fg, bg, level, note } of PAIRS) {
      const fgv = tokens.get(fg);
      const bgv = tokens.get(bg);
      if (!fgv || !bgv) {
        themeFailures.push(`  ✗ ${theme}: missing token ${!fgv ? fg : bg}`);
        continue;
      }
      const ratio = contrast(fgv, bgv);
      if (ratio < THRESHOLD[level]) {
        themeFailures.push(
          `  ✗ ${theme}: ${ratio.toFixed(2)}:1 (min ${THRESHOLD[level]}) ${note} ` +
            `[${fg.replace("--color-", "")} on ${bg.replace("--color-", "")}]`,
        );
      }
      if (ratio < worst) {
        worst = ratio;
        worstNote = note;
      }
    }

    const ok = themeFailures.length === 0;
    console.log(
      `  ${ok ? "✓" : "✗"} ${theme.padEnd(11)} ${PAIRS.length} pairings · ` +
        `tightest ${worst.toFixed(2)}:1 (${worstNote})`,
    );
    for (const f of themeFailures) console.log(f);
    failures.push(...themeFailures);
  }

  const disabledIssues = checkDisabledStates(themes);
  console.log(
    `\n  ${disabledIssues.length === 0 ? "✓" : "✗"} disabled controls stay readable in every theme`,
  );
  for (const i of disabledIssues) console.log(`    ✗ ${i}`);
  failures.push(...disabledIssues);

  const themeColorIssues = checkThemeColors(themes);
  console.log(
    `\n  ${themeColorIssues.length === 0 ? "✓" : "✗"} theme-color matches --color-base in every theme`,
  );
  for (const i of themeColorIssues) console.log(`    ✗ ${i}`);
  failures.push(...themeColorIssues);

  if (failures.length > 0) {
    console.error(`\n${failures.length} failure(s).`);
    process.exit(1);
  }
  console.log(`\nAll ${themes.size * PAIRS.length} pairings pass across every theme.`);
}

main();
