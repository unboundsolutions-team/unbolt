import {
  LoadingAnnouncement,
  SkeletonBoard,
  SkeletonHeading,
} from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <LoadingAnnouncement what="your queue" />
      <SkeletonHeading />
      <SkeletonBoard />
    </>
  );
}
