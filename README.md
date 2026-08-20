# Unbolt

Productized engineering subscription for e-commerce brands, by Unbound Solutions.
**Read `unbolt-brief.md` in the Claude project first** — it is the source of truth
for product, architecture and current state.

Deployed to `unbolt.unboundsolutions.in`. Portal at `/app` on the same origin.

## Status

- **M0** — repo, tokens, CI, DB provisioning · complete
- **M1** — design system + component library · complete
- **M2** — marketing site + SEO + perf budgets · next

## Getting started

```bash
npm install
netlify dev        # links NETLIFY_DATABASE_URL from the site
```

`npm run dev` alone will fail on a missing `NETLIFY_DATABASE_URL`. That is
deliberate — the connection string is provisioned per deploy context and is
never managed by hand.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck` | `tsc --noEmit`, strict + `noUncheckedIndexedAccess` |
| `npm run lint` | ESLint 9 flat config |
| `npm run test` | Vitest unit tests |
| `npm run test:overflow` | Horizontal-overflow guard across 5 viewport widths |
| `npm run test:e2e` | Playwright |
| `npm run tokens:contrast` | **WCAG 2.2 AA gate on the design tokens** |
| `npm run db:generate` | drizzle-kit → `drizzle/` |
| `npm run db:sync` | Reshape to Netlify layout + record hashes |
| `npm run db:check` | Migration integrity (CI) |

All of the above block CI.

## Design system (M1)

Direction B — *warm uncoated canvas, cold ultramarine accent.*

Everything visual resolves from `src/app/globals.css`. **No component may
hardcode a colour, radius or duration**; `no-restricted-syntax` in the ESLint
config fails the build if one does, because a value outside the token set is
invisible to the contrast gate and can silently ship below AA.

### Palette

| Role | Token | Value |
|---|---|---|
| Canvas | `--color-canvas` | `#F4F1EA` uncoated paper |
| Raised | `--color-raised` | `#FBF9F5` — cards lift *toward* light |
| Sunk | `--color-sunk` | `#E9E4DA` |
| Panel | `--color-panel` | `#17181C` — the one dark surface |
| Accent | `--color-accent` | `#1B34C9` ultramarine |
| Shipped | `--color-shipped` | `#186040` |
| Urgent | `--color-urgent` | `#A82F17` |

Warm/cold tension is the thesis. It is what keeps this off the warm-cream +
terracotta palette that is currently the most common look in AI-generated
design — the risk the brief flags in §7. Terracotta was measured, not assumed:
`#C4633F` is **3.58:1** on this canvas and cannot legally carry text.

`--color-ink-3` (`#666570`) is the quietest tone in the system, chosen so it
clears 4.5:1 on the *darkest* light surface. There is deliberately nothing
below it, so there is no tone a component can reach for that fails.

### Type

- **Newsreader** — display serif, optical-size axis 6–72, weight fixed at 400
- **Instrument Sans** — body and UI, variable 400–700
- **IBM Plex Mono** — ticket refs, timestamps, SLA clocks, section markers

Self-hosted from `public/fonts` via `next/font/local` (see `src/app/fonts.ts`).
Not fetched from Google: keeps `fonts.googleapis.com` out of the CSP, keeps the
build off a third-party network call, and matches the immutable `/fonts/*`
cache header already in `netlify.toml`.

Newsreader over Playfair Display deliberately — Playfair is the default AI
display serif. Mono is what keeps an editorial page reading as an engineering
product; it is reserved for machine-generated values, never prose.

### Components

```
src/components/
  ui/        button text card badge avatar field select checkbox radio-group
             switch dialog tooltip tabs table rule skeleton
  layout/    container section header footer
  product/   status sla-clock task-card queue-board
  motion/    motion-provider smooth-scroll reveal
```

Review them all at **`/components`** (noindex, route group `(dev)`).

**The queue board** is the signature element and it survived the switch from
Direction A, because the idea was never the palette — it is showing the product
working on a public page, which is exactly the asset the competitor hides behind
a login wall. In Direction B it sits in the one dark surface, inset into the
paper canvas like a machine display set into a workbench.

### Rules

- Only `transform` and `opacity` animate. `prefers-reduced-motion` is honoured,
  and Lenis does not initialise at all when it is set.
- Visible focus ring everywhere (7.82:1 on canvas), lifted inside `.u-panel`.
- Status is never carried by colour alone — every pill has a dot *and* a label.
- Copy is written from the buyer's side: "Variant swatches drop selection on
  mobile Safari," not "Bug fix #1."
