import Link from "next/link";
import { notFound } from "next/navigation";

import { CommentThread } from "@/components/product/comment-thread";
import { SlaClock } from "@/components/product/sla-clock";
import { StatusPill } from "@/components/product/status";
import { Button } from "@/components/ui/button";
import { formatRef } from "@/lib/format";
import { requirePermission } from "@/server/auth-context";
import { commentsFor } from "@/server/comments";
import { can } from "@/server/rbac";
import { taskDetail } from "@/server/tasks-query";

export const dynamic = "force-dynamic";

export const metadata = { title: "Task" };

/**
 * One task, from the customer's side.
 *
 * Everything about the task in one place: what it says, where it is, what we
 * estimated, whether it is held, the full history, and the conversation.
 *
 * The timeline and the thread are both here rather than on separate tabs
 * because the question a customer actually has is "what is happening with this"
 * — and answering that with two places to look is how they end up emailing
 * instead.
 */
export default async function TaskDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await requirePermission("task:read", `/app/tasks/${id}`);

  // Scoped to the caller's organisation inside the query, so another tenant's
  // task id is indistinguishable from one that does not exist.
  const task = await taskDetail(ctx.organizationId, id);
  if (!task) notFound();

  const comments = await commentsFor({
    taskId: id,
    organizationId: ctx.organizationId,
    // Never true on a customer surface. Internal notes exist so the team can
    // talk without performing for the customer.
    includeInternal: false,
  });

  return (
    <>
      <Link
        href="/app/tasks"
        className="font-mono text-xs uppercase tracking-[0.12em] text-ink-3 hover:text-ink"
      >
        &larr; All tasks
      </Link>

      <div className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <span data-numeric className="font-mono text-xs font-medium text-ink-3">
            {formatRef(task.ref)}
          </span>
          <h1 className="mt-2 max-w-[40ch] text-pretty font-display text-3xl font-extrabold tracking-[-0.04em] text-ink">
            {task.title}
          </h1>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <StatusPill state={task.state} />
          {task.slaDeadline && task.state !== "shipped" ? (
            <SlaClock deadline={task.slaDeadline} />
          ) : null}
        </div>
      </div>

      {/* ── Held for size ──────────────────────────────────────── */}
      {task.blockedAt ? (
        <section
          role="alert"
          className="mt-8 rounded-(--radius-lg) border border-urgent/40 bg-urgent/5 p-6"
        >
          {/* An h2, not a styled <p>. It is the heading of this section, and a
              screen reader user skimming by heading needs to find the one
              message on the page that explains why nothing is happening. */}
          <h2 className="font-display text-lg font-bold tracking-[-0.02em] text-ink">
            This one needs a bigger plan before we start.
          </h2>
          <p className="mt-2 max-w-prose text-pretty font-sans text-sm leading-[1.6] text-ink-2">
            {task.blockedReason}
          </p>
          <div className="mt-5">
            <Button asChild variant="primary">
              <Link href="/contact?plan=professional">Talk to us about upgrading</Link>
            </Button>
          </div>
        </section>
      ) : null}

      {/* ── What it says ───────────────────────────────────────── */}
      {task.body ? (
        <section className="mt-8">
          <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-ink-3">
            What you wrote
          </h2>
          <p className="mt-3 max-w-prose whitespace-pre-wrap text-pretty font-sans text-sm leading-[1.7] text-ink-2">
            {task.body}
          </p>
        </section>
      ) : null}

      {/* ── Facts ──────────────────────────────────────────────── */}
      <dl className="mt-8 grid gap-px overflow-hidden rounded-(--radius-lg) border border-line bg-line sm:grid-cols-3">
        <Fact
          label="Queue position"
          value={task.position === null ? "Not queued" : `#${task.position}`}
        />
        <Fact
          label="Our estimate"
          value={task.estimatedHours === null ? "Not yet sized" : `${task.estimatedHours} hours`}
        />
        <Fact label="Store" value={task.store ?? "—"} />
      </dl>

      <CommentThread
        taskId={task.id}
        comments={comments}
        canReply={can(ctx.role, "task:comment")}
      />

      {/* ── History ────────────────────────────────────────────── */}
      <section className="mt-10">
        <h2 className="font-mono text-xs uppercase tracking-[0.14em] text-ink-3">History</h2>
        <ol className="mt-4 flex flex-col gap-2.5 border-l border-line pl-5">
          {task.timeline.map((event) => (
            <li key={event.id} className="relative">
              <span
                aria-hidden="true"
                className="absolute -left-[1.55rem] top-2 size-1.5 rounded-full bg-line-strong"
              />
              <p className="font-sans text-sm text-ink-2">
                {describe(event)}
                {event.actor ? (
                  <span className="text-ink-3"> &middot; {event.actor}</span>
                ) : null}
              </p>
              <time
                dateTime={event.at}
                data-numeric
                className="font-mono text-xs text-ink-3"
              >
                {event.at.slice(0, 16).replace("T", " ")}
              </time>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-raised px-4 py-4">
      <dt className="font-mono text-xs uppercase tracking-[0.12em] text-ink-3">{label}</dt>
      <dd data-numeric className="mt-1.5 font-sans text-sm text-ink">
        {value}
      </dd>
    </div>
  );
}

/**
 * Timeline events in the customer's vocabulary.
 *
 * The database stores `transition` / `in_progress`; a customer reads "We
 * started work". Rendering the raw enum would leak the state machine onto a
 * page written for someone who does not have one.
 */
function describe(event: {
  type: string;
  fromState: string | null;
  toState: string | null;
}): string {
  if (event.type === "queued") return "Filed and queued";
  if (event.type === "comment") return "A message on this task";
  if (event.type === "estimated") return "We sized the work";
  if (event.type === "blocked") return "Held — bigger than the current plan covers";
  if (event.type === "unblocked") return "Hold lifted, we're picking it up";

  switch (event.toState) {
    case "in_progress":
      return "We started work";
    case "in_review":
      return "In review before it ships";
    case "shipped":
      return "Shipped";
    case "cancelled":
      return "Cancelled";
    case "queued":
      return "Back in the queue";
    default:
      return "Updated";
  }
}
