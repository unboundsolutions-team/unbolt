/**
 * Marketing content, in one place.
 *
 * Pages import from here rather than inlining copy, so a price or an SLA is
 * changed once and cannot drift between the home page, the pricing page and the
 * JSON-LD that Google reads.
 *
 * Copy rules, from the brief:
 *  - written from the buyer's side; task titles describe a symptom a merchant
 *    would recognise, never "Bug fix #1"
 *  - active voice; an action keeps the same name through the whole flow
 *  - NO measured claims. Everything asserted here is a contractual commitment
 *    we control, not a statistic we cannot yet defend (§10 of the brief).
 */

export const SITE = {
  name: "Unbolt",
  parent: "Unbound Solutions",
  // Not "on subscription". The model changed in M6 — packs are bought once —
  // and this string survived the rewrite in the most visible place there is:
  // it is the <title> on every page, the Open Graph title on every share, and
  // the line in the footer.
  tagline: "Senior engineering, bought by the task.",
  description:
    "Fixed-price engineering packs for e-commerce brands. Buy the tasks you need, watch senior engineers ship them, no monthly lock-in.",
  url: "https://unbolt.unboundsolutions.in",
  locality: "Ahmedabad, India",
} as const;

export const NAV = [
  { href: "/how-it-works", label: "How it works" },
  { href: "/pricing", label: "Pricing" },
  { href: "/services", label: "Services" },
  { href: "/tools/store-health-scan", label: "Free scan" },
] as const;

/**
 * Only routes that exist. A footer link to an unbuilt page is a 404 for a real
 * visitor, not just console noise — /work, /blog, /about, /status, /security,
 * /docs and /legal/* are added here as each ships (see §9 of the brief).
 */
export const FOOTER_NAV = [
  {
    heading: "Product",
    links: [
      { href: "/how-it-works", label: "How it works" },
      { href: "/pricing", label: "Pricing" },
      { href: "/services", label: "Services" },
      { href: "/tools/store-health-scan", label: "Store Health Scan" },
    ],
  },
  {
    heading: "Company",
    links: [
      { href: "/contact", label: "Contact" },
      { href: "/login", label: "Sign in" },
      { href: "/register", label: "Start a plan" },
    ],
  },
  {
    heading: "Trust",
    links: [
      { href: "/security", label: "Security" },
      { href: "/legal/terms", label: "Terms" },
      { href: "/legal/privacy", label: "Privacy" },
    ],
  },
] as const;

/**
 * Marketing copy for a plan.
 *
 * ── What lives here and what does not ───────────────────────────────
 * The NUMBERS — price, task allowance, concurrency, the hours ceiling — are
 * administered in /admin/plans and read from the database by the pricing page.
 * Duplicating them here would guarantee the site and the product eventually
 * disagree about what someone bought, and the person editing a plan would have
 * no idea a deploy was also required.
 *
 * What stays here is the copy the database has no opinion about: the feature
 * bullets, which plan is highlighted, and the call to action. Matched to a
 * database row by `slug` ↔ `plans.code`.
 */
export interface Plan {
  slug: string;
  name: string;
  /** Prose only. The real ceiling is plans.max_task_hours. */
  sizeLabel: string;
  sla: string;
  features: readonly string[];
  featured: boolean;
  cta: string;
}

export const PLANS: readonly Plan[] = [
  {
    slug: "standard",
    name: "Standard",
    sizeLabel: "Small, well-defined jobs",
    sla: "48-hour response",
    features: [
      "48-hour response SLA",
      "One task worked at a time",
      "One store",
      "Preview link on every task",
    ],
    featured: false,
    cta: "Talk to us about Standard",
  },
  {
    slug: "professional",
    name: "Professional",
    sizeLabel: "Bigger pieces, two at a time",
    sla: "24-hour response",
    features: [
      "Everything in Standard",
      "24-hour response SLA",
      "Two tasks worked at once",
      "Shared Slack channel",
      "Weekly written report",
      "Up to three stores",
    ],
    featured: true,
    cta: "Talk to us about Professional",
  },
  {
    slug: "enterprise",
    name: "Enterprise",
    sizeLabel: "Large work, four at a time",
    sla: "Same-day response",
    features: [
      "Everything in Professional",
      "Same-day response",
      "Four tasks worked at once",
      "Named engineering lead",
      "Shopify Plus, B2B and multi-store",
      "Invoice billing",
    ],
    featured: false,
    cta: "Talk to us",
  },
] as const;

export const STEPS = [
  {
    title: "Describe it like you'd tell a colleague",
    body: "No ticket template, no story points. “Variant swatches drop selection on mobile Safari” is a complete brief. We ask if we need more.",
  },
  {
    title: "Watch it move, with the clock visible",
    body: "Queue position, who picked it up, an SLA countdown, and a preview link before anything touches your live theme.",
  },
  {
    title: "It ships, and the next one starts",
    body: "Merged and deployed. The next task in the queue moves up automatically — you never have to chase a status.",
  },
] as const;

/**
 * The stat strip. Contractual commitments only — §10.4 of the brief blocks any
 * measured claim we cannot defend, so none of these is a statistic.
 *
 * "Unlimited / tasks in your queue" was removed here: packs are finite, and it
 * was the single most direct contradiction between the site and the product.
 */
export const COMMITMENTS = [
  { value: "Fixed price", label: "agreed before we start" },
  { value: "24h", label: "response SLA, in writing" },
  { value: "No lock-in", label: "buy a pack, not a contract" },
] as const;

export const MARQUEE = [
  "Fixed-price task packs",
  "24h response SLA",
  "No monthly lock-in",
  "Senior engineers only",
  "Shopify & headless",
  "Estimate before we start",
] as const;

export const FAQS = [
  {
    q: "What counts as one task?",
    a: "Anything you would write as a single sentence: a bug, a section, a template change, an integration. If it turns out to be three things wearing a coat, we split it and tell you.",
  },
  {
    q: "How many tasks do I get?",
    a: "Each plan is a pack with a set number of tasks. Submit them whenever you like — there is no monthly deadline to use them by. When the pack runs out you buy another or move up a plan.",
  },
  {
    q: "What does concurrency mean?",
    a: "How many of your tasks we work on at the same time. It is separate from how many you have bought: you can submit five today, and on Professional two of them are worked in parallel while the rest queue.",
  },
  {
    q: "What if a task turns out to be bigger than my plan covers?",
    a: "We estimate the effort before anyone starts, and each plan covers tasks up to a size agreed with you. If something comes in over that, we tell you before we begin and show you which plan covers it. Nothing is lost and the task stays exactly as you wrote it.",
  },
  {
    q: "How fast is fast?",
    a: "You get a first response inside your plan's SLA, in writing. Delivery depends on the task, and we tell you the estimate before we start rather than after.",
  },
  {
    q: "Do unused tasks expire?",
    a: "No. A pack is not a subscription — there is nothing to pause and nothing running down in the background. What you bought sits there until you use it.",
  },
  {
    q: "Who actually does the work?",
    a: "Senior engineers at Unbound Solutions in Ahmedabad. Not a marketplace, not a rotating pool of contractors — you see who picked up each task.",
  },
  {
    q: "What if I don't like what shipped?",
    a: "Every task gets a preview link before it touches your live store. Revisions on a shipped task are not a new task.",
  },
] as const;

export const SERVICES = [
  {
    slug: "shopify-development",
    name: "Shopify development",
    summary: "Theme work, custom sections, app integrations, Liquid and Hydrogen.",
  },
  {
    slug: "performance",
    name: "Performance",
    summary: "Core Web Vitals, render-blocking scripts, image and font strategy.",
  },
  {
    slug: "conversion",
    name: "Conversion work",
    summary: "Checkout friction, bundles, upsells, A/B test implementation.",
  },
  {
    slug: "integrations",
    name: "Integrations",
    summary: "ERP, 3PL, subscriptions, CRM and analytics plumbing that stays fixed.",
  },
  {
    slug: "headless",
    name: "Headless builds",
    summary: "Hydrogen and Next.js storefronts, when a theme has run out of road.",
  },
  {
    slug: "maintenance",
    name: "Maintenance",
    summary: "The steady stream of small things that never justify a project.",
  },
] as const;

/** Illustrative queue for the marketing board. Titles follow the copy rule. */
export const DEMO_TASKS = [
  {
    id: "1",
    ref: "UNB-315",
    title: "Bundle builder should carry the parent product's metafields",
    state: "queued",
    store: "havenwear.com",
  },
  {
    id: "2",
    ref: "UNB-312",
    title: "Variant swatches drop selection on mobile Safari",
    state: "in_progress",
    store: "northline.co",
    slaHours: 3.4,
  },
  {
    id: "3",
    ref: "UNB-314",
    title: "Checkout abandons when a discount code is applied twice",
    state: "in_progress",
    store: "northline.co",
    slaHours: 0.6,
  },
  {
    id: "4",
    ref: "UNB-309",
    title: "Collection filters now persist through pagination",
    state: "shipped",
    store: "havenwear.com",
    shippedAt: "2d ago",
  },
] as const;
