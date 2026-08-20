import { LoadingAnnouncement, SkeletonHeading, SkeletonList } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <LoadingAnnouncement what="the review queue" />
      <SkeletonHeading />
      <SkeletonList rows={3} />
    </>
  );
}
