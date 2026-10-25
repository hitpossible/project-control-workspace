import { BoardSkeleton, Skeleton } from '@/components/shared/motion';

/** Shown inside the app shell while the next page's code loads */
export default function Loading() {
  return (
    <div aria-busy="true">
      <div className="mb-5 space-y-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <BoardSkeleton rows={6} />
    </div>
  );
}
