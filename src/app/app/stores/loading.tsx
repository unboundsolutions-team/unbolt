import { LoadingAnnouncement, SkeletonHeading, SkeletonList } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <LoadingAnnouncement what="your stores" />
      <SkeletonHeading />
      <SkeletonList rows={2} />
    </>
  );
}
