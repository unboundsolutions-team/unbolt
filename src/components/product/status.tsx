import { cn } from "@/lib/cn";

/**
 * The queue vocabulary. These four states are the product — they appear on the
 * marketing site, in the portal and in the admin queue, and must be named
 * identically in all three. This map is the single place they are named.
 *
 * `queued` is deliberately colourless. Nothing is happening to the task yet, so
 * nothing should signal. Colour is spent only where there is something to say.
 */
export const TASK_STATES = [
  "queued",
  "in_progress",
  "in_review",
  "shipped",
  "cancelled",
] as const;

export type TaskState = (typeof TASK_STATES)[number];

/**
 * The states that get a column on the board.
 *
 * `cancelled` is a real state but not a destination — giving it a column would
 * put abandoned work permanently in the customer's eyeline, next to the work
 * they are paying for. Cancelled tasks are reachable from the list view.
 */
export const BOARD_STATES = ["queued", "in_progress", "in_review", "shipped"] as const;

export const STATE_LABEL: Record<TaskState, string> = {
  queued: "Queued",
  in_progress: "In progress",
  in_review: "In review",
  shipped: "Shipped",
  cancelled: "Cancelled",
};

const STATE_CLASSES: Record<TaskState, string> = {
  queued: "bg-queued-soft text-queued border-line",
  in_progress: "bg-progress-soft text-progress border-progress/30",
  in_review: "bg-urgent-soft text-urgent border-urgent/30",
  shipped: "bg-shipped-soft text-shipped border-shipped/30",
  cancelled: "bg-queued-soft text-queued border-line line-through decoration-1",
};

export function StatusPill({
  state,
  className,
}: {
  state: TaskState;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-(--radius-sm) border",
        "px-2 py-1 font-mono text-xs font-medium uppercase leading-none tracking-[0.08em]",
        STATE_CLASSES[state],
        className,
      )}
    >
      {/* The dot carries the state redundantly with the label, never alone —
          colour is not the only channel. */}
      <span
        aria-hidden="true"
        className={cn(
          "size-1.5 rounded-full bg-current",
          state === "in_progress" &&
            "motion-safe:animate-[pulse-soft_2s_ease-in-out_infinite]",
        )}
      />
      {STATE_LABEL[state]}
    </span>
  );
}
