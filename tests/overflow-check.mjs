/**
 * Horizontal-overflow guard.
 *
 * A page that scrolls sideways on a phone is one of the few layout faults that
 * is both very visible and easy to ship without noticing, because it never
 * appears at desktop width. This asserts document scrollWidth never exceeds the
 * viewport across the breakpoints the design system actually targets.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://localhost:3444";
const ROUTES = ["/", "/components"];
const WIDTHS = [320, 390, 768, 1024, 1440];

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
let failed = false;

for (const width of WIDTHS) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  for (const route of ROUTES) {
    await page.goto(`${BASE}${route}`, { waitUntil: "load" });
    await page.waitForTimeout(400);
    /**
     * Test the symptom, not a proxy for it: try to scroll the page sideways and
     * see whether it moves. `documentElement.scrollWidth` is not reliable here —
     * a nested horizontal scroller (the queue board is one by design) inflates
     * it even when the document itself cannot pan, so it produces false
     * failures. Whether the viewport actually shifts is unambiguous.
     */
    const { scrolled, widest } = await page.evaluate(() => {
      window.scrollTo(9999, 0);
      const scrolled = Math.round(window.scrollX);
      window.scrollTo(0, 0);

      // Report the widest element that is NOT inside a scroll container, so a
      // failure names the thing to fix rather than just saying "something".
      const vw = document.documentElement.clientWidth;
      const inScroller = (el) => {
        let n = el.parentElement;
        while (n && n !== document.documentElement) {
          const ox = getComputedStyle(n).overflowX;
          if (ox === "auto" || ox === "scroll" || ox === "hidden") return true;
          n = n.parentElement;
        }
        return false;
      };
      let widest = null;
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.right > vw + 1 && !inScroller(el)) {
          widest = `${el.tagName.toLowerCase()}.${(el.className?.toString?.() ?? "").slice(0, 40)}`;
          break;
        }
      }
      return { scrolled, widest };
    });

    const ok = scrolled === 0 && widest === null;
    if (!ok) failed = true;
    console.log(
      `  ${ok ? "✓" : "✗"} ${String(width).padStart(4)}px ${route.padEnd(12)}` +
        (ok ? " no sideways pan" : ` panned ${scrolled}px${widest ? ` — widest: ${widest}` : ""}`),
    );
  }
  await page.close();
}

await browser.close();
if (failed) {
  console.error("\nHorizontal overflow detected.");
  process.exit(1);
}
console.log("\nNo horizontal overflow at any tested width.");
