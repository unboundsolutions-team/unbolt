import {
  LoadingAnnouncement,
  SkeletonBoard,
  SkeletonHeading,
} from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <LoadingAnnouncement what="the task board" />
      <SkeletonHeading />
      <SkeletonBoard />
    </>
  );
}
