import { QueueBoard } from "@/components/product/queue-board";
import { Text } from "@/components/ui/text";
import { requirePermission } from "@/server/auth-context";
import { boardFor } from "@/server/tasks-query";

export const dynamic = "force-dynamic";

export const metadata = { title: "Tasks" };

export default async function TasksPage() {
  // Guarded by capability, not by role name — a new role added later inherits
  // the correct behaviour from the matrix rather than from a list of strings.
  const ctx = await requirePermission("task:read", "/app/tasks");

  // The full history here, unlike the overview: this is the page you open when
  // you want to go back through what has been delivered.
  const board = await boardFor(ctx.organizationId, { shippedLimit: 50 });

  return (
    <>
      <Text variant="eyebrow">Tasks</Text>
      <h1 className="mt-3 font-display text-3xl font-extrabold tracking-[-0.04em] text-ink">
        The queue
      </h1>

      {board.tasks.length === 0 ? (
        <p className="mt-10 rounded-(--radius-lg) border border-dashed border-line bg-raised px-6 py-12 text-center font-sans text-sm text-ink-2">
          No tasks yet.
        </p>
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
    </>
  );
}
