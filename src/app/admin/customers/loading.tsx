import { LoadingAnnouncement, SkeletonHeading, SkeletonList } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <LoadingAnnouncement what="customers" />
      <SkeletonHeading />
      <SkeletonList rows={4} />
    </>
  );
}
