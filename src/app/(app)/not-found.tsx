import Link from "next/link";
import { SearchX } from "lucide-react";

import { ErrorState } from "@/components/layout/error-state";
import { buttonVariants } from "@/components/ui/button";

/**
 * Where every `notFound()` in the app now lands: a bad id in the URL, a workout
 * that was deleted, or - just as often - a record that belongs to somebody
 * else, since the `get*ForUser` services return null rather than admitting the
 * row exists.
 *
 * The copy covers both without distinguishing them, because telling the player
 * which one it was is exactly the leak those services are avoiding.
 *
 * A Server Component with no props, per the file convention. It renders inside
 * `(app)/layout.tsx`, so the nav is still there to leave by.
 */
export default function AppNotFound() {
  return (
    <ErrorState
      icon={SearchX}
      title="We couldn't find that"
      description="The workout, session, player or conversation you opened isn't there any more. Everything you've saved is still on your nav."
      actions={
        <>
          <Link href="/home" className={buttonVariants({ variant: "brand" })}>
            Back to Home
          </Link>
          <Link
            href="/train"
            className={buttonVariants({ variant: "outline" })}
          >
            Your workouts
          </Link>
        </>
      }
    />
  );
}
