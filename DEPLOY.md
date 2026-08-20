# Deploying Unbolt, and testing it once it's up

Two documents in one: the runbook for getting it live, and the UAT script your
team walks through afterwards. They're together because the second is how you
find out whether the first worked.

The Netlify site already exists — **unbolt**, id
`9b03e3bd-c9e1-4569-bd43-83d0ee4e8f28` — with no deploy and no environment
variables yet.

---

## Before you start: run the preflight

```bash
npm run preflight
```

It checks the environment, the migration lockfile, `netlify.toml`, the functions
on disk and the production build, and it says what breaks for each thing that's
missing rather than just naming it. Only genuine blockers fail the run; a
missing PageSpeed key doesn't, because the scan already degrades honestly
without one.

To check the **production** context rather than your machine, put those values
in a file and point at it:

```bash
npm run preflight -- --env-file .env.production
```

As of now that reports **2 blockers**: no database, no auth secret. Both are
step 2 below.

---

## 1. Enable the database

In the Netlify UI: the site → **Database** in the sidebar. (It is a sidebar
item, not something you search for under Extensions — the extension of that
name is deprecated and errors on every build.)

This is what injects `NETLIFY_DATABASE_URL`. Nothing else sets it, and setting it
by hand is a mistake — every deploy context gets its own branch, and a
hand-written value points them all at the same one.

The first deploy after this will apply all 11 migrations before it publishes. If
a migration fails the deploy does not go live, which is the behaviour you want.

**Netlify keeps its own record of which migrations it has run, and cannot see
ours.** `npm run db:migrate` keeps a separate one, in a `schema_migrations`
table. Applying the schema to the production database from a laptop and then
deploying used to wedge the site permanently: Netlify's record was empty, so it
started again from the first migration against a database that already had
everything, and stopped at

```
Database migration failed: … pq: type "org_role" already exists
```

with every retry failing identically, because the disagreement was between two
ledgers rather than inside either one. Every migration is now wrapped in a
guard that returns early when its work is already present, so either system can
run them in any order. `npm run test:db` proves it against a real database on
every run — see `tests/integration/migrations.test.ts`.

## 2. Set the environment variables

Site → **Environment variables**. Generate the two secrets rather than choosing
them, and **do not use the same value for both** — they're on independent
rotation schedules and sharing one means rotating either signs everybody out
*and* forces every merchant to reconnect.

```bash
openssl rand -base64 32     # BETTER_AUTH_SECRET
openssl rand -base64 32     # SHOPIFY_TOKEN_KEY
```

| Variable | Scope | Notes |
|---|---|---|
| `BETTER_AUTH_SECRET` | production, branch, preview | **Blocker.** Without it the app refuses to start, deliberately — Better Auth's fallback secret is public and would make every session token forgeable. |
| `BETTER_AUTH_URL` | production | `https://<your-domain>` |
| `SHOPIFY_TOKEN_KEY` | production | **Set this before the first store connects.** Changing it later makes every stored token undecryptable and every merchant has to reinstall. |
| `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` | production | From the Shopify Partner dashboard. |
| `PAGESPEED_API_KEY` | production | Optional. Without it the scan says it's being set up rather than inventing scores. |
| `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` | production | Optional, and **both or neither** — a secret key with no webhook secret means payments succeed and grant no credits. |

`NEXT_PUBLIC_APP_ENV` and `NEXT_PUBLIC_SITE_URL` come from `netlify.toml` per
context. `NEXT_PUBLIC_APP_ENV` is the highest-consequence value in the whole
configuration, because a wrong one looks exactly like a right one: anything
other than `production` serves the security policy report-only and disables the
auth-secret guard.

## 3. Shopify Partner app

The **Allowed redirection URL** must be exactly:

```
https://<your-domain>/api/shopify/callback
```

A mismatch is refused by Shopify with an error that names nothing useful.

## 4. The domain

`netlify.toml` currently declares `https://unbolt.unboundsolutions.in` as the
production site URL, but the Netlify site is on `unbolt.netlify.app`. Either
attach that domain to the site or change the value — until they agree, every
canonical URL, sitemap entry and Open Graph tag points somewhere that doesn't
resolve.

## 5. Deploy, then create the first admin

Deploy from a machine with Netlify access (`netlify deploy --prod`, or connect
the repo). Then:

1. Register an account at `/register` with your own email.
2. Promote it to superadmin — this one is a SQL statement, because there is
   deliberately no way to grant yourself admin from inside the product:

   ```sql
   UPDATE users
      SET is_internal = true, internal_role = 'superadmin'
    WHERE email = 'you@unboundsolutions.in';
   ```

   Both columns together: a CHECK constraint requires `internal_role` whenever
   `is_internal` is set, so "staff with no role" isn't a state the schema allows.

3. Everyone else after you gets added at `/admin/team`.

## 6. If Stripe is on

Add an endpoint in the Stripe dashboard pointing at
`https://<your-domain>/api/stripe/webhook`, subscribed to
`checkout.session.completed` and `checkout.session.async_payment_succeeded`.
Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

Verify with `stripe trigger checkout.session.completed`. Then **send it twice** —
a redelivery must grant exactly one pack. That's covered by tests, but it's the
one behaviour worth confirming against the real dashboard.

---

# UAT script

Walk this on the branch deploy before production. Each step says what should
happen; anything else is worth reporting even if it seems small.

### As a visitor

1. **`/pricing`** — three plans, real numbers, prices marked "one-off". No
   mention of a subscription or an unlimited queue anywhere.
2. **Change a plan in `/admin/plans`, reload `/pricing`.** The new number is
   there with no deploy. This is the point of reading plans from the database.
3. **Click a plan's CTA.** Lands on `/contact` with that plan pre-selected.
4. **Submit the form.** Confirmation names you. The enquiry appears in
   `/admin/leads`.
5. **Submit it six times.** The sixth is refused — the form is rate limited per
   caller. Expected behaviour, not a bug.
6. **`/tools/store-health-scan`** with a real store URL. Without a PageSpeed key
   it should confirm the store is live and say the scanner is being set up. It
   must never show a made-up score.
7. **Turn JavaScript off and reload `/`.** The page is still readable. If it's
   blank, that's the failure `npm run test:nojs` guards against.

### As an admin

8. **`/admin`** — the review queue, unestimated work first.
9. **`/admin/customers` → create an account.** Note the generated handover
   password. The workspace exists with **zero credits**.
10. **Confirm the payment.** Credits appear, and the plan's concurrency, SLA and
    size ceiling are copied onto the workspace.
11. **Estimate a task above the customer's ceiling.** It's held, and the reason
    names *both* numbers — the estimate and what their plan covers.
12. **Re-estimate it lower.** The hold clears by itself.
13. **Post an internal note and a customer-visible comment.** Check from the
    customer's side that the internal one is not there.

### As a customer

14. **Sign in with the handover credentials.**
15. **Queue tasks until the pack is empty.** The counter goes down each time.
16. **Try one more.** You get "You've used every task in your pack" and a route
    to buying again — not a form that refuses.
17. **Move more tasks into progress than the plan allows.** The cap holds. This
    is enforced by a unique index, so it holds under concurrency too.
18. **Open a task.** Full history in plain language, the SLA clock, the comment
    thread. No internal notes.
19. **`/app/stores` → connect a Shopify store.** Then disconnect it and confirm
    reconnecting works.

### Worth trying to break

20. **Sign in as customer A, and edit the URL to a task id belonging to
    customer B.** You should be refused. Tenant isolation is checked on the
    server, not in the UI.
21. **Two people queue tasks at the same moment on a nearly-empty pack.** The
    balance must not go negative.
22. **View a page source.** No secrets, no tokens, no internal ids that aren't
    already visible.

---

## Running the checks yourself

The full gate, in the order it's worth running:

```bash
npm run typecheck && npm run lint
npm test                    # 114 unit
npm run test:db             # 160 integration, needs TEST_DATABASE_URL
npm run preflight
```

Browser checks need a server. **The production ones need a production build**,
which is what `scripts/neon-http-proxy.mjs` exists for — `next start` forces
`NODE_ENV=production`, where the local-database escape hatch is deliberately
off, so without the proxy no database-backed page can be served locally at all.

```bash
node scripts/neon-http-proxy.mjs --setup     # once: certs + hosts entry
npm run db:proxy &

npx next build
NETLIFY_DATABASE_URL='postgresql://unbolt@db.unbolt.local/unbolt_dev' \
NODE_EXTRA_CA_CERTS=/tmp/unbolt-ca/ca.pem \
NEXT_PUBLIC_APP_ENV=production npx next start

npm run test:csp            # the enforcing policy, in a browser
npm run test:nojs           # every page readable with scripts off
npm run test:lighthouse     # the performance and SEO budget
npm run test:e2e:m6         # the whole sales-led lifecycle, 31 checks
npm run test:e2e:flow       # the task engine, 17 checks
```

The accessibility and hydration checks want a **dev** server, because React only
reports hydration mismatches in development:

```bash
npm run dev
npm run test:a11y           # WCAG 2.1 A/AA over 24 pages, signed in as both roles
npm run test:hydration
```

**Do not run `next dev` and `next start` from the same checkout at once.**
`next dev` rewrites `.next/` underneath the running production server, which
then serves chunks that no longer exist. Every page fails to hydrate and it
reads exactly like a CSP failure.
