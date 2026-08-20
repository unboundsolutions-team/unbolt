
import { QueueBoard } from "@/components/product/queue-board";
import { NewTaskForm } from "@/components/product/new-task-form";
import { Text } from "@/components/ui/text";
import { requireAuth } from "@/server/auth-context";
import { can } from "@/server/rbac";
import { boardFor } from "@/server/tasks-query";
import { balanceFor } from "@/server/billing/allowance";
import { isStripeEnabled } from "@/server/billing/stripe";
import { OutOfTasks } from "@/components/product/out-of-tasks";

export const dynamic = "force-dynamic";

export const metadata = { title: "Overview" };

export default async function PortalOverview() {
  const ctx = await requireAuth("/app");
  const [board, balance] = await Promise.all([
    boardFor(ctx.organizationId),
    balanceFor(ctx.organizationId),
  ]);

  const mayCreate = can(ctx.role, "task:create");

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Text variant="eyebrow">Overview</Text>
          <h1 className="mt-3 font-display text-3xl font-extrabold tracking-[-0.04em] text-ink">
            {ctx.name ? `Hello, ${ctx.name.split(" ")[0]}.` : "Your queue"}
          </h1>
        </div>

        <div className="text-right">
          <p data-numeric className="font-mono text-xs text-ink-3">
            {/* Allowance first. It is the number that decides whether they can
                do anything at all, and the one they paid for. */}
            <span
              className={
                balance.remaining === 0 ? "font-medium text-urgent" : "font-medium text-accent"
              }
            >
              {balance.remaining}
            </span>{" "}
            {balance.remaining === 1 ? "task left" : "tasks left"}
          </p>
          <p data-numeric className="mt-1 font-mono text-xs text-ink-3">
            <span className="font-medium text-ink">
              {board.inFlight}/{board.concurrencyLimit}
            </span>{" "}
            running &middot;{" "}
            <span className="font-medium text-ink">
              {board.tasks.filter((t) => t.state === "queued").length}
            </span>{" "}
            queued
          </p>
        </div>
      </div>

      {board.tasks.length === 0 ? (
        <EmptyQueue canCreate={mayCreate} />
      ) : (
        <div className="mt-10">
          <QueueBoard
            headingLevel={2}
            tasks={board.tasks}
            concurrencyLimit={board.concurrencyLimit}
            linkTasks
          />
        </div>
      )}

      {/*
        One panel for "you cannot file a task", not two.
        
        There was a second copy of this inline, and it rendered "You've used all
        0 tasks in your plan" to anybody who had never bought one — a
        self-registered account, or one provisioned before payment cleared. That
        is the first screen a new customer sees, and it read as an error about
        something they had not done.
      */}
      {mayCreate && balance.remaining === 0 ? (
        <OutOfTasks
          planCode={balance.planCode}
          planName={balance.planName}
          grantedTotal={balance.grantedTotal}
          canBuy={can(ctx.role, "billing:manage")}
          stripeEnabled={isStripeEnabled()}
        />
      ) : mayCreate ? (
        <section className="mt-12 max-w-2xl rounded-(--radius-lg) border border-line bg-raised p-6">
          <Text variant="eyebrow">Queue a task</Text>
          <p className="mt-2 font-mono text-xs text-ink-3">
            <span data-numeric className="font-medium text-ink">{balance.remaining}</span> of{" "}
            <span data-numeric>{balance.grantedTotal}</span> tasks left in your plan.
          </p>
          <div className="mt-5">
            <NewTaskForm slaHours={board.slaHours} />
          </div>
        </section>
      ) : (
        <p className="mt-8 font-mono text-xs text-ink-3">
          Read-only access — ask an admin in your workspace to queue work.
        </p>
      )}
    </>
  );
}

/**
 * An empty queue is a good state, not an error, and it is the first thing a new
 * customer sees. It should read like an invitation.
 */
function EmptyQueue({ canCreate }: { canCreate: boolean }) {
  return (
    <div className="mt-10 rounded-(--radius-lg) border border-dashed border-line bg-raised px-6 py-12 text-center">
      <p className="font-display text-xl font-bold tracking-[-0.02em] text-ink">
        Nothing in the queue yet.
      </p>
      <p className="mx-auto mt-2 max-w-md text-pretty font-sans text-sm leading-[1.6] text-ink-2">
        {canCreate
          ? "File the first thing that's been bothering you about the store. Anything from a broken checkout to a font that never looked right."
          : "Once someone on your team files work, it shows up here."}
      </p>
    </div>
  );
}
