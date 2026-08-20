import { LoadingAnnouncement, Skeleton } from "@/components/ui/skeleton";

/**
 * The densest page in the product — reference, title, status, SLA clock,
 * history and a comment thread — so the skeleton mirrors that shape rather
 * than showing a generic block.
 */
export default function Loading() {
  return (
    <>
      <LoadingAnnouncement what="this task" />
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-2 h-9 w-[28rem] max-w-full" />
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-4 w-28" />
        </div>
      </div>

      <Skeleton className="mt-8 h-32 w-full rounded-(--radius-lg)" />

      <div className="mt-10 flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-16 w-full rounded-(--radius-md)" />
        ))}
      </div>
    </>
  );
}
