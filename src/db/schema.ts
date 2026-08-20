import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* ============================================================
   M0 SCHEMA SLICE — identity & tenancy
   Tasks, stores, scans, billing and jobs land in M3–M6.
   Every tenant-scoped table carries organization_id and is
   additionally protected by Postgres RLS (see migration).
   ============================================================ */

export const orgRole = pgEnum("org_role", ["owner", "admin", "member", "viewer"]);
export const internalRole = pgEnum("internal_role", ["engineer", "pm", "superadmin"]);
export const billingType = pgEnum("billing_type", ["stripe", "invoice", "trial", "comped"]);
export const orgStatus = pgEnum("org_status", ["active", "past_due", "paused", "cancelled"]);
export const taskState = pgEnum("task_state", [
  "queued",
  "in_progress",
  "in_review",
  "shipped",
  "cancelled",
]);

/* ── Organizations ──────────────────────────────────────── */
export const organizations = pgTable(
  "organizations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    status: orgStatus("status").notNull().default("active"),
    billingType: billingType("billing_type").notNull().default("trial"),
    stripeCustomerId: text("stripe_customer_id"),
    /** null for self-serve; set to the admin user who provisioned an Enterprise org */
    provisionedBy: uuid("provisioned_by"),
    trialEndsAt: timestamp("trial_ends_at", { withTimezone: true }),
    /**
     * What the plan actually buys. On the organisation rather than a plans
     * table so an Enterprise customer can be sold a bespoke cap without
     * inventing a new plan row.
     */
    concurrencyLimit: smallint("concurrency_limit").notNull().default(1),
    /** Response SLA in BUSINESS hours: 48 / 24 / 8. */
    slaHours: smallint("sla_hours").notNull().default(48),
    /**
     * Estimation ceiling in hours. A task estimated above this cannot proceed
     * on the current plan. NULL means no ceiling.
     */
    maxTaskHours: numeric("max_task_hours"),
    currentPlanId: uuid("current_plan_id"),
    /**
     * THE BALANCE — task credits left to spend.
     *
     * A counter, not a SUM over credit_ledger, because spending has to be
     * race-safe without transactions. See server/billing/allowance.ts.
     */
    creditsRemaining: integer("credits_remaining").notNull().default(0),
    creditsGrantedTotal: integer("credits_granted_total").notNull().default(0),
    creditsUsedTotal: integer("credits_used_total").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("organizations_slug_key").on(t.slug),
    index("organizations_status_idx").on(t.status),
  ],
);

/* ── Users ──────────────────────────────────────────────── */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    /** Better Auth requires a boolean; emailVerifiedAt keeps the richer "when". */
    emailVerified: boolean("email_verified").notNull().default(false),
    /** Argon2id. Null when the account is OAuth- or magic-link-only. */
    passwordHash: text("password_hash"),
    name: text("name"),
    avatarUrl: text("avatar_url"),
    /** Unbound staff. Gates /admin entirely. */
    isInternal: boolean("is_internal").notNull().default(false),
    internalRole: internalRole("internal_role"),
    twoFactorEnabledAt: timestamp("two_factor_enabled_at", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_email_key").on(t.email),
    index("users_internal_idx").on(t.isInternal),
  ],
);

/* ── Memberships (user ↔ org, many-to-many) ─────────────── */
export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: orgRole("role").notNull().default("member"),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("memberships_org_user_key").on(t.organizationId, t.userId),
    index("memberships_user_idx").on(t.userId),
  ],
);

/* ── Invitations ────────────────────────────────────────── */
export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: orgRole("role").notNull().default("member"),
    /** SHA-256 of the emailed token. The raw token is never stored. */
    tokenHash: text("token_hash").notNull(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("invitations_token_key").on(t.tokenHash),
    index("invitations_org_email_idx").on(t.organizationId, t.email),
  ],
);

/* ── Sessions ───────────────────────────────────────────── */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Issued by Better Auth, which looks sessions up by this value. */
    token: text("token"),
    /** M0 stored only a hash. Retained nullable until Better Auth is proven in
     *  production, then dropped in its own migration. */
    tokenHash: text("token_hash"),
    /** Which org this session is currently acting within. */
    activeOrganizationId: uuid("active_organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("sessions_token_value_key").on(t.token),
    index("sessions_user_idx").on(t.userId),
    index("sessions_expiry_idx").on(t.expiresAt),
  ],
);

/* ── Accounts — credentials & OAuth links ───────────────── */
/* Better Auth stores the password hash here, not on `users`, so one human can
   hold a password and any number of provider links without the user row
   growing a column per provider. */
export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Provider's own id for the user. Equals userId for credential accounts. */
    accountId: text("account_id").notNull(),
    /** "credential", "google", "github", … */
    providerId: text("provider_id").notNull(),
    /** Argon2id, managed by Better Auth. Null for OAuth-only accounts. */
    password: text("password"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("accounts_provider_account_key").on(t.providerId, t.accountId),
    index("accounts_user_idx").on(t.userId),
  ],
);

/* ── Verifications — email confirm & password reset ─────── */
export const verifications = pgTable(
  "verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("verifications_identifier_idx").on(t.identifier),
    index("verifications_expiry_idx").on(t.expiresAt),
  ],
);

/* ── Stores ─────────────────────────────────────────────── */
export const stores = pgTable(
  "stores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    platform: text("platform").notNull().default("shopify"),
    /**
     * AES-256-GCM envelope, never the raw token. See server/shopify/crypto.ts —
     * this is standing access to a merchant's storefront, not our credential.
     */
    accessTokenEncrypted: text("access_token_encrypted"),
    /** What the merchant actually granted, which can be narrower than we asked. */
    grantedScopes: text("granted_scopes"),
    shopName: text("shop_name"),
    shopEmail: text("shop_email"),
    planName: text("plan_name"),
    currency: text("currency"),
    connectedAt: timestamp("connected_at", { withTimezone: true }),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    connectedBy: uuid("connected_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("stores_org_idx").on(t.organizationId)],
);

/**
 * CSRF nonces for the Shopify install flow.
 *
 * A table rather than a cookie: the callback is a top-level cross-site GET from
 * Shopify, and depending on SameSite semantics that subtle for the only CSRF
 * defence in the flow is how these break silently.
 */
export const oauthStates = pgTable(
  "oauth_states",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    state: text("state").notNull(),
    shop: text("shop").notNull(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    returnTo: text("return_to"),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("oauth_states_state_key").on(t.state)],
);

export const scanStatus = pgEnum("scan_status", ["queued", "running", "complete", "failed"]);

export const scans = pgTable(
  "scans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Both nullable: the scan is a public, no-account lead magnet. */
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "set null" }),
    /** The normalised origin we fetched, never the raw string submitted. */
    targetUrl: text("target_url").notNull(),
    status: scanStatus("status").notNull().default("queued"),
    performanceScore: smallint("performance_score"),
    accessibilityScore: smallint("accessibility_score"),
    seoScore: smallint("seo_score"),
    bestPracticesScore: smallint("best_practices_score"),
    metrics: jsonb("metrics"),
    findings: jsonb("findings"),
    leadEmail: text("lead_email"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("scans_recent_idx").on(t.createdAt)],
);

/**
 * Durable background work.
 *
 * A scan takes ~30s; a synchronous Netlify function times out at ~10s. Attempt
 * count and last error live here rather than in a queue service — that is the
 * trade the addendum made to avoid a fourth SaaS bill.
 */
export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull().default({}),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    claimedUntil: timestamp("claimed_until", { withTimezone: true }),
    attempts: smallint("attempts").notNull().default(0),
    maxAttempts: smallint("max_attempts").notNull().default(3),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("jobs_kind_idx").on(t.kind)],
);

/* ── Tasks — the product ────────────────────────────────── */
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "set null" }),
    /** Human-facing reference, e.g. UNB-312. Unique per organisation. */
    reference: text("reference").notNull(),
    /**
     * Written from the buyer's side: a symptom the merchant would recognise,
     * never "Bug fix #1".
     */
    title: text("title").notNull(),
    body: text("body"),
    state: taskState("state").notNull().default("queued"),
    /**
     * Position in the organisation's queue. Null once the task has left it —
     * a stale number would make "you are 3rd" wrong for everyone behind.
     */
    position: integer("position"),
    /**
     * Which concurrency slot this task occupies, 1..concurrency_limit.
     * NULL unless in_progress or in_review.
     *
     * Uniqueness of (organization_id, slot) among in-flight tasks is what
     * enforces the plan cap. Counting cannot: the HTTP driver has no
     * transactions, and every CTE in a single statement shares one snapshot, so
     * a concurrent claimant reads a stale in-flight count and overruns the cap.
     * Verified against a real Postgres in tests/integration/task-engine.test.ts.
     */
    slot: smallint("slot"),
    /** Entered by the team on review, in hours. */
    estimatedHours: numeric("estimated_hours"),
    estimatedBy: uuid("estimated_by"),
    estimatedAt: timestamp("estimated_at", { withTimezone: true }),
    /** Set when an estimate exceeds the customer's ceiling. Not a cancellation. */
    blockedReason: text("blocked_reason"),
    blockedAt: timestamp("blocked_at", { withTimezone: true }),
    /** Which pack paid for this task. */
    purchaseId: uuid("purchase_id"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
    queuedAt: timestamp("queued_at", { withTimezone: true }),
    /** Response deadline, computed in business hours at queue time. */
    slaDeadline: timestamp("sla_deadline", { withTimezone: true }),
    /** The SLA is met or missed here — at first response, not at delivery. */
    firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    shippedAt: timestamp("shipped_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    previewUrl: text("preview_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("tasks_org_reference_key").on(t.organizationId, t.reference),
    index("tasks_org_state_idx").on(t.organizationId, t.state),
  ],
);

/* ── Task events — append-only timeline ─────────────────── */
export const taskEvents = pgTable(
  "task_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    type: text("type").notNull(),
    fromState: taskState("from_state"),
    toState: taskState("to_state"),
    body: text("body"),
    /** Internal triage notes. Never serialised to a customer. */
    internal: boolean("internal").notNull().default(false),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("task_events_task_created_idx").on(t.taskId, t.createdAt)],
);

/* ── Notifications — a durable outbox ───────────────────── */
/* Not sent inline: providers fail, and a failed send must never roll back the
   state change that caused it. The task did ship, whether or not the email
   went out. */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    failedAt: timestamp("failed_at", { withTimezone: true }),
    attempts: smallint("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.createdAt)],
);

/* ── Audit log (append-only) ────────────────────────────── */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    resourceType: text("resource_type"),
    resourceId: text("resource_id"),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_org_created_idx").on(t.organizationId, t.createdAt.desc()),
    index("audit_logs_actor_idx").on(t.actorId),
  ],
);

/* ── Relations ──────────────────────────────────────────── */
export const organizationsRelations = relations(organizations, ({ many }) => ({
  memberships: many(memberships),
  invitations: many(invitations),
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
  sessions: many(sessions),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  organization: one(organizations, {
    fields: [memberships.organizationId],
    references: [organizations.id],
  }),
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
}));

export type Organization = typeof organizations.$inferSelect;
export type Account = typeof accounts.$inferSelect;
export type TaskRow = typeof tasks.$inferSelect;
export type TaskEventRow = typeof taskEvents.$inferSelect;
export type StoreRow = typeof stores.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type User = typeof users.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type OrgRole = (typeof orgRole.enumValues)[number];
export type ScanRow = typeof scans.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
export type ScanStatus = (typeof scanStatus.enumValues)[number];

/* ── Billing — plans, packs and the credit ledger (M6) ───── */

export const purchaseStatus = pgEnum("purchase_status", [
  "pending",
  "paid",
  "refunded",
  "void",
]);
export const paymentMethod = pgEnum("payment_method", [
  "stripe",
  "invoice",
  "manual",
  "comped",
]);
export const creditEvent = pgEnum("credit_event", [
  "grant",
  "consume",
  "refund",
  "adjust",
  "expire",
]);
export const leadStage = pgEnum("lead_stage", [
  "new",
  "contacted",
  "demo_booked",
  "won",
  "lost",
]);

/**
 * Plans are data, not constants.
 *
 * Every limit the product enforces is a column here so it can be administered
 * rather than deployed — the explicit requirement was "settings for everything
 * in admin".
 */
export const plans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    priceCents: integer("price_cents").notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    /** How many tasks one purchase of this pack grants. */
    taskAllowance: integer("task_allowance").notNull(),
    /** How many of those may be worked on at once. */
    concurrencyLimit: smallint("concurrency_limit").notNull().default(1),
    /** Estimation ceiling per task, in hours. NULL means no ceiling. */
    maxTaskHours: numeric("max_task_hours"),
    slaHours: smallint("sla_hours").notNull().default(48),
    isPublic: boolean("is_public").notNull().default(true),
    isCustom: boolean("is_custom").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    sortOrder: smallint("sort_order").notNull().default(0),
    stripePriceId: text("stripe_price_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("plans_code_key").on(t.code)],
);

/**
 * One row per pack bought.
 *
 * The terms are snapshotted rather than read back through the plan, because a
 * later edit to a plan must not rewrite what somebody was charged.
 */
export const planPurchases = pgTable(
  "plan_purchases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    planId: uuid("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "restrict" }),
    status: purchaseStatus("status").notNull().default("pending"),
    method: paymentMethod("method").notNull().default("manual"),
    tasksGranted: integer("tasks_granted").notNull(),
    priceCentsPaid: integer("price_cents_paid").notNull().default(0),
    currency: text("currency").notNull().default("USD"),
    concurrencyAtPurchase: smallint("concurrency_at_purchase"),
    maxTaskHoursAtPurchase: numeric("max_task_hours_at_purchase"),
    slaHoursAtPurchase: smallint("sla_hours_at_purchase"),
    stripeCheckoutSessionId: text("stripe_checkout_session_id"),
    stripePaymentIntentId: text("stripe_payment_intent_id"),
    invoiceNumber: text("invoice_number"),
    poNumber: text("po_number"),
    recordedBy: uuid("recorded_by").references(() => users.id, { onDelete: "set null" }),
    note: text("note"),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("plan_purchases_org_idx").on(t.organizationId)],
);

/** Append-only. Enforced by DO INSTEAD NOTHING rules, not by convention. */
export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    type: creditEvent("type").notNull(),
    delta: integer("delta").notNull(),
    balanceAfter: integer("balance_after").notNull(),
    purchaseId: uuid("purchase_id").references(() => planPurchases.id, {
      onDelete: "set null",
    }),
    taskId: uuid("task_id"),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("credit_ledger_org_idx").on(t.organizationId)],
);

/** The clarification loop between a customer and the engineer on their task. */
export const taskComments = pgTable(
  "task_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    /** Internal notes the customer never sees. */
    isInternal: boolean("is_internal").notNull().default(false),
    editedAt: timestamp("edited_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("task_comments_task_idx").on(t.taskId)],
);

/** Plan interest is now a conversation, not a checkout, so leads are records. */
export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    company: text("company"),
    phone: text("phone"),
    storeUrl: text("store_url"),
    interestedPlanId: uuid("interested_plan_id").references(() => plans.id, {
      onDelete: "set null",
    }),
    wantsDemo: boolean("wants_demo").notNull().default(false),
    message: text("message"),
    qualification: jsonb("qualification").notNull().default({}),
    stage: leadStage("stage").notNull().default("new"),
    assignedTo: uuid("assigned_to").references(() => users.id, { onDelete: "set null" }),
    nextActionAt: timestamp("next_action_at", { withTimezone: true }),
    convertedOrganizationId: uuid("converted_organization_id").references(
      () => organizations.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("leads_stage_idx").on(t.stage)],
);

export type Plan = typeof plans.$inferSelect;
export type PlanPurchase = typeof planPurchases.$inferSelect;
export type CreditLedgerRow = typeof creditLedger.$inferSelect;
export type TaskComment = typeof taskComments.$inferSelect;
export type Lead = typeof leads.$inferSelect;
