# M9 — what's left, in order

Local is working. Six things stand between that and a live site.

**[you]** = only you can do it. **[me]** = say the word and it's done in a minute.

---

## 1. Update your code · **[you]** · 3 min

Extract the new zip to a **new empty folder**, copy your `.env.local` across,
then:

```powershell
npm install --legacy-peer-deps
npm install-scripts approve esbuild sharp unrs-resolver
npm run db:migrate
npm run dev
```

There's a new migration in this one (the third plan), so `db:migrate` is not
optional.

---

## 2. Push to GitHub · **[you]** · 10 min

Netlify needs somewhere to build from. Git history is already committed in the
zip, so:

```powershell
gh repo create unbound-solutions/unbolt --private --source=. --push
```

Or create the repo in the GitHub UI and:

```powershell
git remote add origin https://github.com/unbound-solutions/unbolt.git
git push -u origin main
```

**Done when:** you can see your files on github.com.

---

## 3. Set the secrets · **[me]** · 1 min

Two values need generating. I'll set them straight on the site so they never
pass through this chat.

| | |
|---|---|
| `BETTER_AUTH_SECRET` | Without it the site deploys, looks perfect, and **sign-in returns 500**. Nothing else breaks, so you'd only find out when someone tried to log in. |
| `SHOPIFY_TOKEN_KEY` | Encrypts merchant tokens. **Must exist before the first store connects** — changing it later forces every merchant to reinstall. |
| `BETTER_AUTH_URL` | Your final domain (step 6). |

**Just reply "do the secrets"** and it's done.

If you'd rather: Netlify → Site configuration → Environment variables → Add,
and generate each with `openssl rand -base64 32`. Use two different values.

---

## 4. Connect the repo and deploy · **[you]** · 15 min

1. https://app.netlify.com/projects/unbolt → **Site configuration** →
   **Build & deploy** → **Link repository**
2. Pick your repo. Don't override the build command — `netlify.toml` sets it.
3. **Deploy site**.

Migrations run automatically before the build publishes. If one fails, nothing
goes live.

**Done when, in this order:**
1. `/pricing` shows three plans with real prices.
2. **You can register and sign in.** Check this one specifically — it's the part
   that breaks silently if step 3 was skipped.

---

## 5. Make yourself an admin on the live site · **[you]** · 5 min

1. Register at `https://unbolt.netlify.app/register`.
2. From your local folder:

```powershell
$env:NETLIFY_DATABASE_URL="postgresql://netlifydb_owner:PASSWORD@ep-calm-waterfall-aya7fxmo.c-5.us-east-2.db.netlify.com/netlifydb?sslmode=require"
npm run promote:admin -- you@unboundsolutions.in
```

**Done when:** signing in takes you to `/admin`, or shows an **Admin** button in
the header if you also made yourself a workspace.

Everyone else on your team you add from `/admin/team` — this script is only for
the first person.

---

## 6. Your real plan numbers · **[you]** · 10 min

**The most important thing on this page.** Every number at `/admin/plans` is a
placeholder I made up:

| | Standard | Professional | Enterprise |
|---|---|---|---|
| Tasks in the pack | 5 | 10 | 20 |
| Worked at once | 1 | 2 | 3 |
| **Hours ceiling per task** | **8** | **16** | **40** |
| Response SLA | 48h | 24h | 8h |
| Price | $499 | $799 | $1,499 |

The **hours ceiling** deserves the most thought. It decides when a task gets
held pending an upgrade, so it drives most of your customer conversations. Too
low and you're always asking people to upgrade; too high and you absorb work you
didn't price for.

Changes affect **new** purchases only — existing customers keep the terms they
bought.

---

## 7. Shopify Partner app · **[you]** · 15 min

1. https://partners.shopify.com → **Apps** → **Create app** → **Create app manually**
2. **Configuration** → **URLs** → **Allowed redirection URL(s)**, exactly:

   ```
   https://<your-domain>/api/shopify/callback
   ```

   Exactly. A mismatch gives an error that explains nothing.

3. Send me the Client ID and secret and I'll set them **[me]**.

---

## 8. Your domain · **[you]** · 5 min + DNS wait

`netlify.toml` says `unbolt.unboundsolutions.in`; the site is on
`unbolt.netlify.app`. Until they match, every canonical URL and social preview
points somewhere that doesn't resolve.

**Either** add a CNAME `unbolt` → `unbolt.netlify.app` at your DNS provider,
then Netlify → Domain management → Add a domain.

**Or** tell me to change the one line to `unbolt.netlify.app` **[me]**.

---

## 9. Legal review · **[you]**

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
