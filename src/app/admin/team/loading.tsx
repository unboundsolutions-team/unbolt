import { LoadingAnnouncement, SkeletonHeading, SkeletonList } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <LoadingAnnouncement what="the team" />
      <SkeletonHeading />
      <SkeletonList rows={3} />
    </>
  );
}
