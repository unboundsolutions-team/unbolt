import { LoadingAnnouncement, SkeletonHeading, SkeletonList } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <LoadingAnnouncement what="plans" />
      <SkeletonHeading />
      <SkeletonList rows={3} />
    </>
  );
}
