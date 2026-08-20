# Running it on your machine

`.env.local` is gitignored — deliberately, it holds secrets — so a fresh clone
has no database and no auth secret, and `npm run dev` fails on the first page
that reads data. This is that file.

Windows commands are shown as well as macOS/Linux, since that's what you're on.

---

## The fast way: use the Netlify database directly · 3 min

You already have a database provisioned. Point local development straight at it.

**1. Get the connection string**

Netlify → your project → **Database** (it's an item in the project sidebar, not
something you search for under Extensions) → the connection string for the
**production** branch. It looks like:

```
postgresql://neondb_owner:…@ep-something-123456.eu-central-1.aws.neon.tech/neondb?sslmode=require
```

**2. Create `.env.local` in the repository root**

```ini
NETLIFY_DATABASE_URL=postgresql://…paste it here…

# Any 32+ character string. Local only — never reuse this one on Netlify.
BETTER_AUTH_SECRET=local-development-only-not-a-real-secret-000
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

PowerShell, if you'd rather not use an editor:

```powershell
@"
NETLIFY_DATABASE_URL=postgresql://…
BETTER_AUTH_SECRET=local-development-only-not-a-real-secret-000
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_SITE_URL=http://localhost:3000
"@ | Out-File -Encoding utf8 .env.local
```

**3. Create the tables**

```bash
npm run db:migrate
```

The database is empty until this runs — it is what creates all 22 tables and
seeds the three plans. Safe to run repeatedly; it tracks what it has applied.

This one script is plain JavaScript rather than TypeScript, so it works even
when npm has blocked postinstall scripts (see *If npm blocked install scripts*
below).

**4. Run it**

```bash
npm run dev
```

`http://localhost:3000` should now load. `/pricing` will be empty until there
are plan rows — see *Seeding* below.

> **This is your real database.** Fine right now, with no customers on it. Once
> there are, stop doing this: a stray `npm run seed:demo` would wipe live data.
> The two safer options are below.

---

## The linked way: `netlify dev` · 5 min

Pulls the site's environment down instead of you copying values around, so
there's one place they live.

```bash
npm i -g netlify-cli
netlify login
netlify link          # choose the "unbolt" project
netlify dev
```

Serves on `http://localhost:8888`. You still want `BETTER_AUTH_SECRET` in
`.env.local` unless you've set a development-context one in Netlify.

Same caveat: it links the **production** environment, so you are working against
the real database.

---

## The safe way: a local Postgres

What I used throughout the build, and what you'll want once real customers
exist.

**Windows:** install PostgreSQL from
[postgresql.org/download/windows](https://www.postgresql.org/download/windows/),
then in a terminal:

```bash
createdb -U postgres unbolt_dev
createdb -U postgres unbolt_test
```

**macOS:** `brew install postgresql@16 && brew services start postgresql@16`

Then `.env.local`:

```ini
DEVELOPMENT_DATABASE_URL=postgres://postgres@localhost:5432/unbolt_dev
TEST_DATABASE_URL=postgres://postgres@localhost:5432/unbolt_test

BETTER_AUTH_SECRET=local-development-only-not-a-real-secret-000
BETTER_AUTH_URL=http://localhost:3000
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Apply the schema:

```bash
npm run db:migrate
```

It picks up `DEVELOPMENT_DATABASE_URL` on its own. For the test database:

```bash
npm run db:migrate -- --url postgres://postgres@localhost:5432/unbolt_test
```

**Why two variables rather than one that takes any URL:** `NETLIFY_DATABASE_URL`
goes through Neon's HTTP driver, which cannot reach a Postgres on localhost.
`DEVELOPMENT_DATABASE_URL` uses a normal TCP driver and is honoured **only**
outside production, so no value in it can ever point live traffic at a dev box.

---

## Seeding

```bash
npm run seed:demo
```

Three staff, three customers (one deliberately awaiting payment), seven tasks
across every state including one held over its size ceiling, a comment thread
with an internal note, and four leads. Sign in as
`arjun@unboundsolutions.in` / `demo-password-not-for-real-use`.

**It clears the database first.** Never run it against production.

---

## About those Better Auth errors during `npm run build`

You'll have seen this several times in the build output:

```
[Error [BetterAuthError]: You are using the default secret. …]
```

The build still succeeded, and locally that's only noise — Better Auth logs it
and carries on. Setting `BETTER_AUTH_SECRET` in `.env.local` silences it.

**On Netlify it is not noise — the build fails outright.**

```
Error: BETTER_AUTH_SECRET is not set in production.
> Build error occurred
[Error: Failed to collect page data for /api/auth/[...all]]
```

`src/lib/auth-guard.ts` throws rather than let Better Auth sign session tokens
with a public default secret, which would make every session forgeable. Next
evaluates the auth route while collecting page data, so the throw happens during
the build and nothing deploys.

That is the right behaviour: a site where sign-in is silently broken is worse
than a site that refused to ship.

> **I claimed the opposite twice before writing this**, on the strength of a
> build that "passed" — because `.env.local` was sitting in the directory and
> Next loaded it, so the variable was never actually absent. The check that
> settles it is `mv .env.local /tmp && npx next build`. If you are ever testing
> what happens *without* some configuration, move the file rather than trusting
> that you did not set it.

---

## Two things apply these migrations, and they cannot see each other

Netlify applies `netlify/database/migrations/` itself, before it publishes a
deploy — a platform step, so it appears in no file in this repository. You will
see it near the top of a build log as **Netlify Database setup**. It keeps its
own record of what it has run.

`npm run db:migrate` keeps a different record, in a `schema_migrations` table.

Nothing reconciles the two. Applying the schema to the **production** database
from your laptop and then deploying was enough to stop the site going live at
all: Netlify's record was empty, so it began at the first migration against a
database that already had everything, and stopped at

```
Database migration failed: error running migrations:
running migration 20260816000001_identity_and_tenancy: pq: type "org_role"
```

(truncated in the log — the full message is `type "org_role" already exists`).
A failed migration blocks the publish, so every deploy after it failed the same
way, and retrying could not help.

Each migration is now wrapped in a guard that returns early when its work is
already there:

```sql
DO $unbolt_migration$
BEGIN
IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'organizations_set_updated_at') THEN
  RAISE NOTICE '… is already applied — skipping.';
  RETURN;
END IF;
  … the migration …
END
$unbolt_migration$;
```

so "already applied" is a fact about the database rather than about whichever
ledger happens to be asking. The whole file is skipped rather than each
statement being made harmless, which matters: a backfill still runs exactly
once.

**If you write a migration, wrap it the same way** and guard on the last thing
it creates. `npm run db:check` fails without the wrapper, and `npm run test:db`
applies every migration to a scratch database three ways — once, twice, and
once with the guards forced off — and fails if the results differ.

### `--repair`

Because the guard changed all eleven files, any database migrated before it will
refuse the new ones:

```
Refusing to continue — these have already been applied but their contents have changed
```

Once, for that change only:

```bash
npm run db:migrate -- --repair
```

It re-records the hashes and executes no SQL. It is correct only when you can
show the edit cannot change a database that already ran it — for this one, by
dumping the schema of a database migrated each way and finding no difference.
Reach for it because you have that evidence, not because the runner refused.

---

## If npm blocked install scripts

npm 11 refuses to run packages' postinstall scripts by default, and warns:

```
npm warn install-scripts 6 packages had install scripts blocked …
  esbuild@0.28.2 (postinstall: node install.js)
  sharp@0.34.5 (install: node install/check.js || npm run build)
```

That matters more than it looks. **esbuild** fetches a platform binary in that
step, `tsx` runs on esbuild, and most scripts here run through tsx — so
`seed:demo`, `promote:admin`, `db:sync`, `preflight` and `tokens:contrast` all
fail at once with an esbuild error that mentions none of this. **sharp** is what
Next uses to optimise images.

```bash
npm install-scripts approve esbuild sharp unrs-resolver
npm install --legacy-peer-deps
```

`db:migrate` deliberately does not go through tsx, so it works either way — the
deploy runs it, and the deploy should not depend on an optional install step
having succeeded.

## Checking it works

```bash
npm run typecheck
npm test                # 114 unit tests, no database needed
npm run test:db         # 160 integration tests, needs TEST_DATABASE_URL
npm run preflight       # what's still missing and what breaks because of it
```

`npm run preflight` is the quickest way to see where you are.
