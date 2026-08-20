import { cn } from "@/lib/cn";

import { BOARD_STATES, STATE_LABEL, type TaskState } from "./status";
import { TaskCard, type Task } from "./task-card";

/**
 * The signature element.
 *
 * The thesis has survived every design direction because it was never the
 * palette: we show the product working on a public page, which is exactly the
 * asset the competitor hides behind a login wall.
 *
 * This is the presentational shell. It takes tasks and renders them; it does
 * not fetch, poll or own state. The portal passes live data, the marketing hero
 * passes a scripted set.
 */
export function QueueBoard({
  tasks,
  columns = BOARD_STATES,
  concurrencyLimit,
  linkTasks = false,
  headingLevel = 3,
  className,
}: {
  tasks: readonly Task[];
  columns?: readonly TaskState[];
  /** The plan's concurrency cap. Shown against in-flight work, not the queue. */
  concurrencyLimit?: number;
  /** Portal boards link to task detail; the marketing hero must not. */
  linkTasks?: boolean;
  /**
   * Level for the per-column headings.
   *
   * The board sits under a section h2 on the marketing pages and directly under
   * the page h1 in the portal, where h3 skipped a level. Which is right depends
   * on the surrounding document, so the page decides.
   */
  headingLevel?: 2 | 3;
  className?: string;
}) {
  const Heading = `h${headingLevel}` as "h2" | "h3";
  const inFlight = tasks.filter(
    (t) => t.state === "in_progress" || t.state === "in_review",
  ).length;

  return (
    <div
      className={cn(
        // max-w-full/min-w-0 is load-bearing: grid and flex items default to
        // min-width:auto, so without it the board's intrinsic width sizes its
        // ancestor and the whole page pans sideways on a phone.
        "min-w-0 max-w-full overflow-hidden rounded-(--radius-lg)",
        "border border-line bg-raised shadow-(--shadow-panel)",
        className,
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full bg-accent motion-safe:animate-[pulse-soft_2s_ease-in-out_infinite]"
          />
          <span className="font-mono text-xs font-medium uppercase tracking-[0.15em] text-ink-3">
            Live queue
          </span>
        </div>

        {concurrencyLimit !== undefined ? (
          <span data-numeric className="font-mono text-xs text-ink-3">
            <span className="font-medium text-ink">
              {inFlight}/{concurrencyLimit}
            </span>{" "}
            running
          </span>
        ) : null}
      </header>

      {/* Horizontal scroll on narrow viewports rather than a collapsed single
          column — the point of the board is seeing work move across it.
          `contain: paint` stops this scroller's content contributing to the
          document's scrollable region, which would otherwise pan the page. */}
      <div className="max-w-full overflow-x-auto [contain:paint]">
        <div
          className="grid gap-px bg-line"
          style={{
            gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))`,
            // Tracks column count so a three-column hero board and a
            // four-column portal board each get a sensible floor.
            minWidth: `${columns.length * 11}rem`,
          }}
        >
          {columns.map((state) => {
            const column = tasks.filter((t) => t.state === state);
            return (
              <section key={state} className="bg-raised p-3" aria-label={STATE_LABEL[state]}>
                <Heading className="mb-3 flex items-baseline justify-between gap-2">
                  <span className="font-mono text-xs font-medium uppercase tracking-[0.12em] text-ink-3">
                    {STATE_LABEL[state]}
                  </span>
                  <span data-numeric className="font-mono text-xs tabular-nums text-ink-3">
                    {column.length}
                  </span>
                </Heading>

                <div className="flex flex-col gap-2">
                  {column.length === 0 ? (
                    // No /70 on the colour. ink-3 is the quietest text in the
                    // palette and clears AA at 5.15:1; at 70% alpha it composites
                    // to 3.06:1 and fails. Alpha modifiers and opacity are the
                    // same trap — the palette check passes because the palette is
                    // fine, and the rendered pixels are not.
                    <p className="rounded-(--radius-md) border border-dashed border-line px-3 py-4 text-center font-mono text-xs text-ink-3">
                      Empty
                    </p>
                  ) : (
                    column.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        {...(linkTasks ? { href: `/app/tasks/${task.id}` } : {})}
                      />
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
