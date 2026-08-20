/**
 * Populate a local database with a realistic working state.
 *
 * For looking at the product, showing it to someone, and taking screenshots
 * that are not all empty states. It is NOT test fixture data — the integration
 * suite builds its own, deliberately, so a change here can never quietly alter
 * what a test asserts.
 *
 * Refuses to run against anything but a local development database.
 *
 * ── Do not point this at the test database ──────────────────────────
 * The integration suite TRUNCATEs users and organizations on every reset, so a
 * shared database means running the tests silently wipes the demo data — and
 * running the seed mid-suite would be worse. Keep them separate:
 *
 *   DEVELOPMENT_DATABASE_URL  → unbolt_dev   (this script, the dev server)
 *   TEST_DATABASE_URL         → unbolt_test  (vitest)
 *
 *   npm run seed:demo
 */
// MUST be first: Next loads .env.local, a script run through tsx does not.
import "./env-first.mjs";

import { sql } from "drizzle-orm";

import { db } from "../src/db/client";
import { grantFromPurchase } from "../src/server/billing/allowance";
import { estimateTask } from "../src/server/billing/review";
import { postComment } from "../src/server/comments";
import { queueTask, transitionTask } from "../src/server/task-engine";

async function main(): Promise<void> {
  // A seed script that can point at production is a seed script that eventually
  // does. There is no flag to override this.
  if (process.env["NETLIFY_DATABASE_URL"] || process.env.NODE_ENV === "production") {
    throw new Error("seed:demo refuses to run against anything but DEVELOPMENT_DATABASE_URL.");
  }

  console.log("Clearing…");
  await db.execute(sql`TRUNCATE users, organizations, leads RESTART IDENTITY CASCADE`);

  const { auth } = await import("../src/lib/auth");

  // ── The team ──────────────────────────────────────────────────────
  const staff = [
    { email: "arjun@unboundsolutions.in", name: "Arjun Mehta", role: "superadmin" },
    { email: "leila@unboundsolutions.in", name: "Leila Haddad", role: "engineer" },
    { email: "sam@unboundsolutions.in", name: "Sam Okoye", role: "pm" },
  ];

  const staffIds: Record<string, string> = {};
  for (const person of staff) {
    const created = await auth.api.signUpEmail({
      body: { email: person.email, password: "demo-password-not-for-real-use", name: person.name },
    });
    staffIds[person.email] = created.user.id;
    await db.execute(sql`
      UPDATE users SET is_internal = true, internal_role = ${person.role}::internal_role
      WHERE id = ${created.user.id}::uuid
    `);
  }
  const engineer = staffIds["leila@unboundsolutions.in"]!;
  const admin = staffIds["arjun@unboundsolutions.in"]!;
  console.log(`  ${staff.length} staff`);

  // ── Customers ─────────────────────────────────────────────────────
  const customers = [
    {
      org: "Northline Supply",
      slug: "northline-supply",
      owner: "priya@northline.co",
      ownerName: "Priya Raman",
      plan: "professional",
      paid: true,
      tasks: [
        {
          title: "Variant swatches drop selection on mobile Safari",
          body: "Pick a colour, then a size, and the colour resets. Only on iPhone — desktop Chrome is fine. Started after the theme update last month.",
          hours: 5, state: "in_progress",
        },
        {
          title: "Checkout loses the discount code on the payment step",
          body: "Code applies on the cart page and shows the reduction, then the payment step charges full price. Two customers have emailed about it.",
          hours: 3, state: "in_review",
        },
        {
          title: "Collection page images load at full resolution",
          body: "The sale collection is about 8MB on a phone. I think the images were uploaded straight from the photographer.",
          hours: 2, state: "shipped",
        },
        {
          title: "Rebuild the whole account area with a new design system",
          body: "Orders, addresses, returns — all of it. We want it to match the new brand work rather than the default theme.",
          hours: 26, state: "blocked",
        },
        {
          title: "Add a size guide modal to product pages",
          body: "A link under the size picker that opens our measurements table. We have the table as a PDF already.",
          hours: null, state: "queued",
        },
      ],
    },
    {
      org: "Fernwood Goods",
      slug: "fernwood-goods",
      owner: "dan@fernwood.com",
      ownerName: "Dan Ellery",
      plan: "standard",
      paid: true,
      tasks: [
        {
          title: "Newsletter signup fires twice on the footer form",
          body: "Everyone who signs up gets two welcome emails. Only from the footer form — the popup is fine.",
          hours: 1.5, state: "in_progress",
        },
        {
          title: "Product grid jumps as images load",
          body: "On a slow connection the whole grid shifts down as each image arrives, and you end up tapping the wrong product.",
          hours: null, state: "queued",
        },
      ],
    },
    {
      org: "Cove & Co",
      slug: "cove-and-co",
      owner: "maya@coveandco.shop",
      ownerName: "Maya Bertrand",
      plan: "standard",
      // Deliberately unpaid: the "awaiting payment" state is one of the most
      // important things for the team to see, so it should be in the demo.
      paid: false,
      tasks: [],
    },
  ];

  for (const customer of customers) {
    const created = await auth.api.signUpEmail({
      body: {
        email: customer.owner,
        password: "demo-password-not-for-real-use",
        name: customer.ownerName,
      },
    });
    const ownerId = created.user.id;

    const orgRows = await db.execute<{ id: string; purchase_id: string }>(sql`
      WITH plan AS (SELECT * FROM plans WHERE code = ${customer.plan}),
      org AS (
        INSERT INTO organizations (name, slug, billing_type, provisioned_by, status)
        SELECT ${customer.org}, ${customer.slug}, 'invoice', ${admin}::uuid, 'active' FROM plan
        RETURNING id
      ),
      member AS (
        INSERT INTO memberships (organization_id, user_id, role)
        SELECT org.id, ${ownerId}::uuid, 'owner' FROM org
      ),
      purchase AS (
        INSERT INTO plan_purchases (
          organization_id, plan_id, status, method, tasks_granted, price_cents_paid,
          concurrency_at_purchase, max_task_hours_at_purchase, sla_hours_at_purchase,
          recorded_by, paid_at
        )
        SELECT org.id, plan.id,
               ${customer.paid ? "paid" : "pending"}::purchase_status, 'invoice',
               plan.task_allowance, plan.price_cents,
               plan.concurrency_limit, plan.max_task_hours, plan.sla_hours,
               ${admin}::uuid,
               ${customer.paid ? sql`now()` : sql`NULL`}
        FROM org, plan
        RETURNING id
      )
      SELECT org.id, purchase.id AS purchase_id FROM org, purchase
    `);

    const row = firstRow<{ id: string; purchase_id: string }>(orgRows);
    if (!row) throw new Error(`Could not create ${customer.org}`);

    if (customer.paid) {
      await grantFromPurchase({ purchaseId: row.purchase_id, actorId: admin });
    }

    // Shipped work first, then review, then in-progress. Ordering matters: a
    // shipped task releases its concurrency slot when it completes, so seeding
    // in narrative order hits the cap and the seed fails — which is the cap
    // doing its job, not a bug.
    const order: Record<string, number> = { shipped: 0, in_review: 1, in_progress: 2, blocked: 3, queued: 4 };
    const ordered = [...customer.tasks].sort(
      (a, b) => (order[a.state] ?? 9) - (order[b.state] ?? 9),
    );

    for (const task of ordered) {
      const queued = await queueTask({
        organizationId: row.id,
        actorId: ownerId,
        title: task.title,
        body: task.body,
      });

      if (task.hours !== null) {
        await estimateTask({ taskId: queued.id, actorId: engineer, hours: task.hours });
      }

      if (task.state === "in_progress" || task.state === "in_review" || task.state === "shipped") {
        await transitionTask({
          taskId: queued.id, organizationId: row.id, actorId: engineer, next: "in_progress",
        });
      }
      if (task.state === "in_review" || task.state === "shipped") {
        await transitionTask({
          taskId: queued.id, organizationId: row.id, actorId: engineer, next: "in_review",
        });
      }
      if (task.state === "shipped") {
        await transitionTask({
          taskId: queued.id, organizationId: row.id, actorId: engineer, next: "shipped",
        });
      }

      if (task.state === "in_progress") {
        await postComment({
          taskId: queued.id, organizationId: row.id, authorId: engineer,
          body: "Which collection page is this on? I can see it on /collections/all but not on the sale page.",
          authorIsInternal: true,
        });
        await postComment({
          taskId: queued.id, organizationId: row.id, authorId: ownerId,
          body: "It's the sale page — /collections/sale. Only when you pick a size first.",
          authorIsInternal: false,
        });
        await postComment({
          taskId: queued.id, organizationId: row.id, authorId: engineer,
          body: "Reproduced. It's the variant script the old theme left behind.",
          isInternal: true, authorIsInternal: true,
        });
      }
    }

    console.log(`  ${customer.org} — ${customer.tasks.length} tasks`);
  }

  // ── Leads ─────────────────────────────────────────────────────────
  const leads = [
    ["Tomas Ek", "tomas@brightsidegoods.se", "Brightside Goods", "professional", true, "new",
      "We're migrating to Shopify Plus in March and need help with the theme."],
    ["Renee Okafor", "renee@theloomstudio.com", "The Loom Studio", "standard", false, "contacted",
      "Site feels slow on mobile and our agency has gone quiet."],
    ["Marcus Bell", "marcus@harborandpine.com", "Harbor & Pine", "enterprise", true, "demo_booked",
      "Four stores, B2B pricing, need a named contact."],
    ["Ines Costa", "ines@verdeliving.pt", "Verde Living", null, false, "lost",
      "Went with a freelancer."],
  ] as const;

  for (const [name, email, company, plan, demo, stage, message] of leads) {
    await db.execute(sql`
      INSERT INTO leads (name, email, company, interested_plan_id, wants_demo, message, stage)
      VALUES (
        ${name}, ${email}, ${company},
        (SELECT id FROM plans WHERE code = ${plan}),
        ${demo}::boolean, ${message}, ${stage}::lead_stage
      )
    `);
  }
  console.log(`  ${leads.length} leads`);

  console.log("\nDone. Sign in as arjun@unboundsolutions.in / demo-password-not-for-real-use");
}

function firstRow<T>(rows: unknown): T | undefined {
  const result = (rows as { rows?: unknown[] }).rows ?? rows;
  return (Array.isArray(result) ? (result[0] as T | undefined) : undefined) ?? undefined;
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
