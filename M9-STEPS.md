# M9 — exactly what to do, in order

Nine steps. Roughly 90 minutes, most of it waiting for a build.

I've marked each one **[you]** or **[me]**. The **[me]** ones I can do right now
through the Netlify connection — say the word and they're done in a minute. Don't
do those yourself unless you'd rather.

Steps 1–5 get the site live. Steps 6–9 make it a real product. Do them in order:
each one depends on the last.

---

## 1. Get the code into a repo · **[you]** · 10 min

The code was only ever in my sandbox. I've sent you `unbolt-source.zip` — it's
the full source with git history already committed, `node_modules` excluded.

```bash
unzip unbolt-source.zip && cd unbolt
npm install --legacy-peer-deps
```

`--legacy-peer-deps` is required: Better Auth is ESM-only and npm's peer
resolution refuses it otherwise.

Then push it somewhere Netlify can see:

```bash
gh repo create unbound-solutions/unbolt --private --source=. --push
```

Or make the repo in the GitHub UI and `git remote add origin … && git push -u origin main`.

**Check it worked:** `npm run build` finishes without errors.

---

## 2. The database — **already done** ✅

You've done this one. Your Database page shows *"Your database is ready!"* with a
production branch active.

**My instructions were wrong about where to find it**, which is why searching
Extensions for "netlify DB" returned nothing. It isn't in the extension
directory at all — **Database** is its own item in the project sidebar, below
Blobs. Sorry for the detour.

Netlify injects `NETLIFY_DATABASE_URL` into every deploy context from here, each
with its own branch. **Never set that variable by hand on the site** — a
hand-written value points production, previews and branches at the same database.

## 2b. Run it locally · **[you]** · 3 min

`.env.local` is gitignored, so a fresh clone has no database and no auth secret.
That's the error you hit. Create `.env.local` in the repository root:

```ini
# Netlify → your project → Database → connection string
NETLIFY_DATABASE_URL=postgresql://…

BETTER_AUTH_SECRET=local-development-only-not-a-real-secret-000
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Then `npm run dev`. **LOCAL-DEV.md** has the full version, including a local
Postgres if you'd rather not develop against the real database — which you'll
want once there are customers on it, but is fine today.

I've also rewritten the error message you saw, so the next person gets told
where the value comes from instead of just which variable is missing.

---

## 3. Set the secrets · **[me]** · 1 min

Two secrets need generating. I can generate and set them directly, which is
better than either of us pasting them into a chat window — they'd be in your
scrollback forever.

| Variable | Why |
|---|---|
| `BETTER_AUTH_SECRET` | Without it the build succeeds and the marketing site looks perfect, but **sign in and register return 500** — the app refuses to sign session tokens with Better Auth's public default secret, which would make every session forgeable. I verified this against a real production build. Set it before the first deploy, not after. |
| `SHOPIFY_TOKEN_KEY` | Encrypts merchant access tokens at rest. **Must be set before the first store connects** — changing it later makes every stored token undecryptable and every merchant has to reinstall. |
| `BETTER_AUTH_URL` | Your final domain. Needs step 8 decided first, or set it to `https://unbolt.netlify.app` for now and change it later. |

They will be different values, deliberately. Sharing one welds two independent
rotation schedules together: rotating either would sign everyone out *and* force
every merchant to reconnect.

If you'd rather do it yourself: **Site configuration → Environment variables →
Add a variable**, and generate each with `openssl rand -base64 32`.

---

## 4. Connect the repo and deploy · **[you]** · 15 min

1. **https://app.netlify.com/projects/unbolt** → **Site configuration** →
   **Build & deploy** → **Link repository**
2. Pick the repo from step 1. Build command and publish directory come from
   `netlify.toml` — don't override them.
3. **Deploy site**.

The first deploy applies all 10 migrations before it publishes. If a migration
fails the deploy does not go live, which is the behaviour you want.

**Check it worked, in this order:**
1. `/pricing` shows three plans with real prices — if not, the database isn't connected.
2. **`/login` loads and you can register.** Check this specifically: a missing
   `BETTER_AUTH_SECRET` leaves the rest of the site looking perfectly fine and
   breaks only this.

---

## 5. Make yourself an admin · **[you]** · 5 min

There is deliberately no way to make yourself an admin from inside the product.
So, once:

1. Register at `https://unbolt.netlify.app/register` with your real email.
2. Copy `NETLIFY_DATABASE_URL` from Netlify (Environment variables → the value
   is hidden; click to reveal).
3. From your local checkout:

```bash
NETLIFY_DATABASE_URL='postgres://…' npm run promote:admin -- you@unboundsolutions.in
```

That sets both `is_internal` and `internal_role` together — the schema requires
them to move as a pair — and writes the grant to the audit trail, which a
hand-written `UPDATE` would not.

**Check it worked:** `/admin` loads instead of redirecting you to `/welcome`.
Everyone else you add from **/admin/team** — this script shouldn't need running
twice.

---

## 6. Put in your real numbers · **[you]** · 10 min

**This is the most important step on the page, and only you can do it.**

Go to **/admin/plans**. Every number there is a placeholder I invented:

| | Standard | Professional | Enterprise |
|---|---|---|---|
| Tasks in the pack | 5 | 10 | 20 |
| Worked at once | 1 | 2 | 3 |
| Hours ceiling per task | 8 | 16 | 40 |
| Response SLA | 48h | 24h | 8h |
| Price | *placeholder* | *placeholder* | *placeholder* |

The **hours ceiling** is the one to think hardest about. It's what decides
whether a task gets held pending an upgrade, so it's the number that will
generate the most customer conversations. Too low and you're constantly telling
people to upgrade; too high and you're absorbing work you didn't price for.

Changes apply to **new** purchases only. Existing accounts keep the terms copied
to them at purchase, so you can adjust pricing without touching anyone who has
already bought.

The pricing page reads these live — no deploy needed.

---

## 7. Shopify Partner app · **[you]** · 15 min

Only you can do this; it needs your Partner login.

1. **https://partners.shopify.com** → **Apps** → **Create app** → **Create app manually**
2. Name it Unbolt.
3. In **Configuration** → **URLs**, set **Allowed redirection URL(s)** to exactly:

   ```
   https://<your-domain>/api/shopify/callback
   ```

   Exactly. A mismatch is refused by Shopify with an error that names nothing
   useful, and it's the single most common thing to get wrong here.

4. Copy the **Client ID** and **Client secret**.
5. Send them to me and I'll set them as `SHOPIFY_API_KEY` and
   `SHOPIFY_API_SECRET` **[me]** — or add them yourself in Netlify.

**Check it worked:** `/app/stores` → Connect store → you reach Shopify's consent
screen rather than an error.

---

## 8. Decide the domain · **[you]** · 5 min, then up to 24h for DNS

`netlify.toml` declares `https://unbolt.unboundsolutions.in`. The site is
currently on `unbolt.netlify.app`. **Until those agree, every canonical URL,
sitemap entry and social preview points somewhere that doesn't resolve** — which
search engines treat badly.

**Either** use the subdomain:
1. At your DNS provider, add a CNAME: `unbolt` → `unbolt.netlify.app`
2. Netlify → **Domain management** → **Add a domain** → `unbolt.unboundsolutions.in`
3. Wait for the certificate (usually minutes).

**Or** stay on `unbolt.netlify.app` and I'll change the one line in
`netlify.toml` **[me]**.

Whichever you pick, `BETTER_AUTH_URL` and the Shopify redirect URL must match it.

---

## 9. Legal review · **[you]** · however long your lawyer takes

`/legal/terms`, `/legal/privacy` and `/security` are drafted from what the
product actually does — not boilerplate. But they haven't been reviewed, and
they carry your company's name and describe your obligations to people paying
you.

Each page shows a visible **"Draft — not yet reviewed by a lawyer"** notice. It
disappears when a real date is set in the page source, so they can't ship
unreviewed by accident.

Once reviewed, tell me the date and I'll set it **[me]**, or change
`lastReviewed={null}` to `lastReviewed="2026-08-25"` in the three page files.

The privacy policy is the one to read closely — it lists exactly what you hold
and who processes it, and it needs to stay true as the product changes.

---

## Optional, whenever

| | What it gets you |
|---|---|
| **PageSpeed API key** | Google Cloud Console → APIs → enable *PageSpeed Insights API* → create key. Without it the free scan confirms a store is live and honestly says the scanner is being set up. It never invents scores, so running without it is fine. |
| **Stripe** | Dashboard → Developers → API keys. Then add a webhook endpoint at `https://<domain>/api/stripe/webhook` for `checkout.session.completed` and `checkout.session.async_payment_succeeded`, and copy the signing secret. Both `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` or neither — a secret key alone means payments succeed and grant no credits, so checkout stays disabled until both are present. This only enables **repurchase**; onboarding stays sales-led either way. |

---

## After every step: check it

```bash
npm run preflight
```

It tells you what's still missing and what breaks because of it. Right now it
reports two blockers — steps 2 and 3 above. When it says **Ready to deploy**, you
are.

Then walk the 22-step UAT script in `DEPLOY.md` against the live site.
