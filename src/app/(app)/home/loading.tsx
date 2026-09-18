import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Home builds the day's cards on the first view of each day, which can
 * include one call to the copy writer. That is the slowest render this app
 * has, so it gets a real skeleton rather than a blank screen - and every
 * later view of the same day reads the stored cards and is fast.
 */
export default function HomeLoading() {
  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="space-y-3 pt-6">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
          <div className="flex gap-2">
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-5 w-24 rounded-full" />
          </div>
        </CardContent>
      </Card>

      {[0, 1, 2].map((index) => (
        <Card key={index}>
          <CardHeader>
            <Skeleton className="h-5 w-28 rounded-full" />
          </CardHeader>
          <CardContent className="space-y-2">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
