# M9 — what's left, in order

**[you]** = only you can do it. **[me]** = say the word and it's done in a minute.

---

## Done already

| | |
|---|---|
| Code on GitHub | `unboundsolutions-team/unbolt` ✓ |
| Netlify linked to the repo | ✓ |
| `BETTER_AUTH_SECRET` | set on the site, production context ✓ |
| `SHOPIFY_TOKEN_KEY` | set on the site, production context ✓ |
| `BETTER_AUTH_URL` | `https://unbolt.netlify.app` ✓ |

Three deploys have failed. The first two were mine to fix and are fixed. The
third is fixed by step 1.

---

## 1. Push the migration fix · **[you]** · 2 min

**This is the only thing between you and a live site.**

### What went wrong

Two separate systems apply the database migrations, and neither can see the
other's record of what it has already run:

- **Netlify** applies them itself, before it publishes a deploy.
- **`npm run db:migrate`** applies them from your laptop — which is what you
  ran during local setup, against the production database, because I told you
  to.

So Netlify's record was empty while the database already had everything. It
started again from the first migration and stopped at

```
Database migration failed: … running migration 20260816000001_identity_and_tenancy: pq: type "org_role"
```

The full message is *type "org_role" already exists*. A failed migration blocks
the publish, which is the correct behaviour — but it meant no retry could ever
succeed, because the disagreement was between two ledgers rather than inside
either one.

That was my mistake twice over: I had you apply migrations by hand, having
earlier concluded that nothing applied them on deploy.

### The fix

Every migration now skips itself when its work is already present, so either
system can run them in any order, any number of times. Nothing about the schema
changes — I built one database the old way and one the new way and diffed
them, and there is no difference.

### What you do

From your project folder:

```powershell
git pull https://github.com/unboundsolutions-team/unbolt.git main
```

If you're pulling from the bundle I sent instead:

```powershell
git pull C:\path\to\unbolt-migration-fix.bundle main
git push
```

Then **Netlify → Deploys → Trigger deploy → Deploy site**.

**Done when:** the build log shows *Netlify Database setup* followed by eleven
`already applied — skipping` notices, and the deploy publishes.

---

## 2. Repair your local migration record · **[you]** · 1 min

Only if you run `npm run db:migrate` again. The fix changed all eleven files,
so the runner will refuse them:

```
Refusing to continue — these have already been applied but their contents have changed
```

Once, and only for this change:

```powershell
npm run db:migrate -- --repair
```

It updates the recorded fingerprints and runs no SQL.

---

## 3. Check the site actually works · **[you]** · 5 min

In this order — the second one is what breaks silently:

1. `https://unbolt.netlify.app/pricing` shows three plans with prices.
2. **You can register and sign in.**

---

## 4. Make yourself an admin on the live site · **[you]** · 5 min

1. Register at `https://unbolt.netlify.app/register`.
2. From your project folder:

```powershell
$env:NETLIFY_DATABASE_URL="postgresql://netlifydb_owner:PASSWORD@ep-calm-waterfall-aya7fxmo.c-5.us-east-2.db.netlify.com/netlifydb?sslmode=require"
npm run promote:admin -- you@unboundsolutions.in
```

**Done when:** signing in takes you to `/admin`, or an **Admin** link appears in
the header if you also made yourself a workspace.

Everyone else you add from `/admin/team` — this script is only for the first
person.

---

## 5. Remove the deprecated `neon` extension · **[you]** · 2 min

It errors on every build with *"New database creation via the Netlify DB
extension is no longer available."* Harmless, but it is noise in every log and
it is not the thing providing your database — the **Database** item in the
project sidebar is.

Netlify → team **Extensions** → **Neon** → remove.

---

## 6. Your real plan numbers · **[you]** · 10 min

**The most important thing on this page.** Every number at `/admin/plans` is a
placeholder I made up:

| | Standard | Professional | Enterprise |
|---|---|---|---|
| Tasks in the pack | 5 | 10 | 20 |
| Worked at once | 1 | 2 | 4 |
| **Hours ceiling per task** | **8** | **16** | **40** |
| Response SLA | 48h | 24h | 8h |
| Price | $499 | $799 | $1,499 |

The **hours ceiling** deserves the most thought. It decides when a task gets
held pending an upgrade, so it drives most of your customer conversations. Too
low and you're always asking people to upgrade; too high and you absorb work
you didn't price for.

Changes affect **new** purchases only — existing customers keep the terms they
bought.

---

## 7. Rotate the database password · **[you]** · 5 min

You pasted both connection strings into our chat, including the owner one.
Nothing has happened to them, but they should not survive contact with real
customer data. Netlify → **Database** → reset the password, then update
`.env.local`.

Do it before step 4, or you'll just have to redo `.env.local` afterwards.

---

## 8. Shopify Partner app · **[you]** · 15 min

1. https://partners.shopify.com → **Apps** → **Create app** → **Create app manually**
2. **Configuration** → **URLs** → **Allowed redirection URL(s)**, exactly:

   ```
   https://<your-domain>/api/shopify/callback
   ```

   Exactly. A mismatch gives an error that explains nothing.

3. Send me the Client ID and secret and I'll set them **[me]**.

---

## 9. Your domain · **[you]** · 5 min + DNS wait

`netlify.toml` says `unbolt.unboundsolutions.in`; the site is on
`unbolt.netlify.app`. Until they match, every canonical URL and social preview
points somewhere that doesn't resolve.

**Either** add a CNAME `unbolt` → `unbolt.netlify.app` at your DNS provider,
then Netlify → Domain management → Add a domain.

**Or** tell me to change the one line to `unbolt.netlify.app` **[me]**.

---

## 10. Legal review · **[you]**

`/legal/terms`, `/legal/privacy` and `/security` are drafted from what the
product actually does, and each shows a visible **"not yet reviewed by a
lawyer"** notice until a real date is set. Send me the date once reviewed and
I'll set it **[me]**.

---

## Optional

| | |
|---|---|
| **PageSpeed key** | Google Cloud Console → enable *PageSpeed Insights API* → create key. Without it the free scan says the scanner isn't set up rather than inventing scores. |
| **Stripe** | Only enables *repurchase* — buying a second pack without a call. Onboarding stays sales-led either way. Needs both `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`, plus a webhook at `/api/stripe/webhook`. |

---

## Checking where you are

```powershell
npm run preflight
```

Tells you what's missing and what breaks because of it. When it says **Ready to
deploy**, you are. Then walk the 22-step UAT script in `DEPLOY.md`.
