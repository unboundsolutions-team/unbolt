import { cn } from "@/lib/cn";

/**
 * Placeholder shapes for a page that is still loading.
 *
 * ── Why these exist ─────────────────────────────────────────────────
 * Every database-backed route here is `force-dynamic`, so navigating to one
 * means waiting for the server to render it. Without a `loading.tsx` the App
 * Router shows the PREVIOUS page, unchanged and fully interactive, until the
 * new one arrives. Nothing indicates anything is happening, so the natural
 * response is to click again.
 *
 * That gap is wider than it looks in this product: the database is remote, and
 * a page like the portal makes several round trips before it can render
 * anything.
 *
 * ── Why shapes rather than a spinner ────────────────────────────────
 * A skeleton in roughly the layout of the real content means the page does not
 * jump when it arrives, and it tells you *what* is coming. A centred spinner
 * tells you only that something is happening, and then everything moves.
 *
 * `aria-hidden` throughout, with one live region announcing "Loading" once —
 * a screen reader should hear that the page is loading, not a description of
 * fourteen grey rectangles.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "block rounded-(--radius-sm) bg-inset",
        // Pulse only where motion is welcome. Under prefers-reduced-motion the
        // shapes are still visible and still communicate the layout.
        "motion-safe:animate-[pulse-soft_1.8s_ease-in-out_infinite]",
        className,
      )}
    />
  );
}

/** Announces the load once, for anyone not looking at the shapes. */
export function LoadingAnnouncement({ what }: { what: string }) {
  return (
    <span role="status" aria-live="polite" className="sr-only">
      Loading {what}
    </span>
  );
}

/** A page heading and its eyebrow. */
export function SkeletonHeading() {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <Skeleton className="h-3 w-20" />
        <Skeleton className="mt-3 h-9 w-64" />
      </div>
      <div className="hidden sm:block">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="mt-2 h-3 w-36" />
      </div>
    </div>
  );
}

/** The queue board: four columns of cards. */
export function SkeletonBoard() {
  return (
    <div className="mt-10 overflow-hidden rounded-(--radius-lg) border border-line bg-raised">
      <div className="border-b border-line px-4 py-3">
        <Skeleton className="h-3 w-24" />
      </div>
      <div className="grid gap-px bg-line" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
        {[0, 1, 2, 3].map((column) => (
          <div key={column} className="bg-raised p-3">
            <Skeleton className="mb-3 h-3 w-20" />
            <div className="flex flex-col gap-2">
              {/* Uneven counts, because a real board is uneven and a grid of
                  identical blocks reads as a broken table rather than a load. */}
              {Array.from({ length: [2, 1, 2, 1][column] ?? 1 }).map((_, card) => (
                <Skeleton key={card} className="h-24 w-full rounded-(--radius-md)" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A stack of list rows — customers, leads, staff. */
export function SkeletonList({ rows = 4 }: { rows?: number }) {
  return (
    <div className="mt-10 flex flex-col gap-4">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="flex flex-wrap items-start justify-between gap-4 rounded-(--radius-lg) border border-line bg-raised p-5"
        >
          <div className="min-w-0 flex-1">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="mt-2 h-3 w-64" />
            <Skeleton className="mt-2 h-3 w-40" />
          </div>
          <Skeleton className="h-9 w-28 rounded-(--radius-md)" />
        </div>
      ))}
    </div>
  );
}
