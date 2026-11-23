import { PageSkeleton } from "@/components/attendance/Skeleton";

/** Shown at once while the page's data loads (navigations feel instant on a phone). */
export default function Loading() {
  return <PageSkeleton />;
}
