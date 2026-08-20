import Link from "next/link";

import { ReviewCard } from "@/components/admin/review-card";
import { Text } from "@/components/ui/text";
import { reviewQueue } from "@/server/admin-queries";
import { assignableStaff, teamWorkload, unassignedCount } from "@/server/assignment";
import { requireInternal } from "@/server/auth-context";
import { cn } from "@/lib/cn";

export const dynamic = "force-dynamic";

export const metadata = { title: "Queue" };

/**
 * The review queue — the page the team actually works from.
 *
 * Ordered by what is blocking delivery rather than by recency: unestimated
 * tasks first, then held ones, then by SLA deadline. A newest-first list would
 * bury the task whose clock is about to run out.
 *
 * The workload strip sits above it because the first question on a shared queue
 * is not "what is there" but "who is on what" — and without an answer, work
 * silently piles onto whoever picks things up fastest.
 */
export default async function AdminQueuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [me, params] = await Promise.all([requireInternal(), searchParams]);

  const view = typeof params["view"] === "string" ? params["view"] : "all";
  const filter =
    view === "mine"
      ? { assignedTo: me.userId }
      : view === "unassigned"
        ? { unassignedOnly: true }
        : undefined;

  const [tasks, workload, staff, unowned] = await Promise.all([
    reviewQueue(100, filter),
    teamWorkload(),
    assignableStaff(),
    unassignedCount(),
  ]);

  const needsEstimate = tasks.filter((t) => t.estimatedHours === null && t.state === "queued");
  const held = tasks.filter((t) => t.blockedAt !== null);
  const rest = tasks.filter((t) => !needsEstimate.includes(t) && !held.includes(t));

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Text variant="eyebrow">Queue</Text>
          <h1 className="mt-3 font-display text-3xl font-extrabold tracking-[-0.04em] text-ink">
            {view === "mine" ? "Your work" : "Everything, across every customer"}
          </h1>
        </div>
        <p data-numeric className="font-mono text-xs text-ink-3">
          <span className="font-medium text-ink">{needsEstimate.length}</span> to estimate &middot;{" "}
          <span className="font-medium text-ink">{held.length}</span> held &middot;{" "}
          <span className="font-medium text-ink">{rest.length}</span> in flight
        </p>
      </div>

      {/* ── Who is on what ─────────────────────────────────────── */}
      <section className="mt-8">
        <div className="grid gap-px overflow-hidden rounded-(--radius-lg) border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
          {workload.map((person) => (
            <div key={person.userId} className="min-w-0 bg-raised px-4 py-3.5">
              <p className="truncate font-sans text-sm font-medium text-ink">
                {person.name ?? person.email}
                {person.userId === me.userId ? (
                  <span className="ml-1.5 font-normal text-ink-3">(you)</span>
                ) : null}
              </p>
              <p data-numeric className="mt-1.5 font-mono text-xs text-ink-3">
                <span className={cn("font-medium", person.open === 0 ? "text-ink-3" : "text-ink")}>
                  {person.open}
                </span>{" "}
                open &middot; <span className="font-medium text-ink">{person.inFlight}</span>{" "}
                running
                {person.estimatedHours > 0 ? (
                  <>
                    {" "}
                    &middot; <span className="font-medium text-ink">{person.estimatedHours}h</span>
                  </>
                ) : null}
              </p>
            </div>
          ))}
        </div>

        {/* Work with no owner is the number that should stay near zero — it is
            the work nobody has decided is theirs. */}
        {unowned > 0 ? (
          <p className="mt-3 font-mono text-xs text-ink-3">
            <Link href="/admin?view=unassigned" className="text-urgent hover:underline">
              <span data-numeric className="font-medium">
                {unowned}
              </span>{" "}
              {unowned === 1 ? "task has" : "tasks have"} no owner
            </Link>
          </p>
        ) : null}
      </section>

      {/* ── Filters ────────────────────────────────────────────── */}
      <nav aria-label="Queue filter" className="mt-8 flex flex-wrap gap-1">
        {[
          { key: "all", label: "Everything" },
          { key: "mine", label: "Mine" },
          { key: "unassigned", label: "Unassigned" },
        ].map((tab) => (
          <Link
            key={tab.key}
            href={tab.key === "all" ? "/admin" : `/admin?view=${tab.key}`}
            aria-current={view === tab.key ? "page" : undefined}
            className={cn(
              "rounded-(--radius-sm) px-3 py-1.5 font-mono text-xs uppercase tracking-[0.12em]",
              "transition-colors duration-(--duration-fast)",
              view === tab.key
                ? "bg-accent text-accent-ink"
                : "border border-line text-ink-3 hover:text-ink",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {tasks.length === 0 ? (
        <p className="mt-10 rounded-(--radius-lg) border border-dashed border-line bg-raised px-6 py-12 text-center font-sans text-sm text-ink-2">
          {view === "mine"
            ? "Nothing assigned to you right now."
            : view === "unassigned"
              ? "Everything has an owner."
              : "Nothing in the queue. Every customer is up to date."}
        </p>
      ) : null}

      <Section
        title="Waiting on an estimate"
        note="Nothing can start until these are sized, and the customer's SLA clock is already running."
        tasks={needsEstimate}
        staff={staff}
      />
      <Section
        title="Held — over the customer's plan"
        note="The customer has been told which plan covers it. Nothing happens until they upgrade, or someone here absorbs it."
        tasks={held}
        staff={staff}
      />
      <Section title="In flight" note="" tasks={rest} staff={staff} />
    </>
  );
}

function Section({
  title,
  note,
  tasks,
  staff,
}: {
  title: string;
  note: string;
  tasks: Awaited<ReturnType<typeof reviewQueue>>;
  staff: Awaited<ReturnType<typeof assignableStaff>>;
}) {
  if (tasks.length === 0) return null;

  return (
    <section className="mt-12">
      <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-ink-3">
        {title} <span data-numeric>({tasks.length})</span>
      </h2>
      {note ? <p className="mt-2 max-w-prose font-sans text-sm text-ink-3">{note}</p> : null}
      <div className="mt-5 flex flex-col gap-4">
        {tasks.map((task) => (
          <ReviewCard key={task.id} task={task} staff={staff} />
        ))}
      </div>
    </section>
  );
}
