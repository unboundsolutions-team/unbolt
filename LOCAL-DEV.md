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

**3. Apply the schema**

The database is empty until the migrations run. On Netlify that happens
automatically before each deploy; locally, run them once with `psql`, or just
deploy first and let Netlify do it.

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
psql -U postgres -d unbolt_dev -f netlify/database/migrations/20260816000001_identity_and_tenancy/migration.sql
```

…and so on for each directory under `netlify/database/migrations/`, in name
order. They're numbered to sort correctly. On Linux/macOS:

```bash
for f in netlify/database/migrations/*/migration.sql; do psql -U postgres -d unbolt_dev -f "$f"; done
```

PowerShell:

```powershell
Get-ChildItem netlify/database/migrations/*/migration.sql | Sort-Object FullName |
  ForEach-Object { psql -U postgres -d unbolt_dev -f $_.FullName }
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

**On Netlify it is not noise, and the failure is quieter than you'd want.**

I checked this by running a production build with the variable genuinely absent.
What happens is *not* a failed build:

| | |
|---|---|
| `npm run build` | **succeeds** |
| The marketing site | **200, looks perfect** |
| Sign in / register | **500** |

`src/lib/auth-guard.ts` refuses to let Better Auth start rather than sign session
tokens with a public default secret, which would make every session forgeable.
It fails closed, and only auth is affected — the rest of the site stays up.

That's the right trade-off, and it means a deploy without the secret **looks
fine** until the first person tries to sign in. So set `BETTER_AUTH_SECRET`
before the first deploy rather than after, and make signing in the first thing
you check once it's live.

---

## Checking it works

```bash
npm run typecheck
npm test                # 114 unit tests, no database needed
npm run test:db         # 160 integration tests, needs TEST_DATABASE_URL
npm run preflight       # what's still missing and what breaks because of it
```

`npm run preflight` is the quickest way to see where you are.
