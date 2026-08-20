import { Container } from "@/components/layout/container";
import { SiteShell } from "@/components/layout/site-shell";
import { LoadingAnnouncement, Skeleton } from "@/components/ui/skeleton";

/**
 * /pricing reads live plan rows, so it cannot be prerendered and every visit
 * waits on the database. The header and footer come from SiteShell here rather
 * than from a layout, so this has to render them itself — otherwise the loading
 * state is a bare page with no navigation, which looks more broken than a
 * blank one.
 */
export default function Loading() {
  return (
    <SiteShell>
      <LoadingAnnouncement what="plans" />
      <section className="border-b border-line pb-16 pt-36 sm:pb-20 sm:pt-44">
        <Container>
          <Skeleton className="h-3 w-16" />
          <Skeleton className="mt-5 h-12 w-[34rem] max-w-full" />
          <Skeleton className="mt-6 h-4 w-[44rem] max-w-full" />
          <Skeleton className="mt-2 h-4 w-[38rem] max-w-full" />
        </Container>
      </section>

      <section className="py-20 sm:py-24">
        <Container>
          <div className="grid gap-px border border-line bg-line lg:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex flex-col gap-4 bg-base p-8">
                <Skeleton className="h-7 w-32" />
                <Skeleton className="h-3 w-24" />
                <Skeleton className="mt-4 h-12 w-40" />
                <Skeleton className="h-3 w-36" />
                <div className="mt-4 flex flex-col gap-2">
                  {[0, 1, 2, 3].map((line) => (
                    <Skeleton key={line} className="h-3 w-full" />
                  ))}
                </div>
                <Skeleton className="mt-4 h-11 w-full rounded-(--radius-md)" />
              </div>
            ))}
          </div>
        </Container>
      </section>
    </SiteShell>
  );
}
