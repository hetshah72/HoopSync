import { ObjectId } from "mongodb";
import Link from "next/link";
import { Clapperboard } from "lucide-react";
import { auth } from "@/server/auth/auth";
import { buttonVariants } from "@/components/ui/button";
import { getClipReel } from "@/server/services/feedService";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { ClipReel } from "@/components/feed/clip-reel";

/**
 * Clips - the short-form surface BRD 7.14 asks for ("a TikTok/Instagram
 * consumption model applied to basketball development").
 *
 * Deliberately NOT a seventh nav destination: the nav is fixed at six by BRD
 * v1.1 §4, so Clips is reached from Home - from the header control, or by
 * tapping a card's clip. Same precedent as Saved.
 *
 * `?start=<feedItemId>` opens on the clip the player tapped rather than at the
 * top, which is what makes tapping a card's video feel like opening *that*
 * clip instead of a different one that happens to be first.
 */
export default async function ClipsPage({
  searchParams,
}: {
  searchParams: Promise<{ start?: string }>;
}) {
  const { start } = await searchParams;
  const session = await auth();
  const userId = session?.user?.id ? new ObjectId(session.user.id) : null;

  const reel = userId
    ? await getClipReel(userId, start)
    : { clips: [], startIndex: 0, totalAvailable: 0 };

  if (reel.clips.length === 0) {
    return (
      <div>
        <PageHeader
          back={{ href: "/home", label: "Back to Home" }}
          eyebrow="Short form"
          title="Clips"
          description="Drill demos and breakdowns, one at a time."
        />
        <EmptyState
          icon={Clapperboard}
          title="No clips yet"
          description="Clips appear here as demo footage is added to your feed. Everything shown carries a label saying where it came from."
          action={
            <Link href="/home" className={buttonVariants({ size: "lg" })}>
              Back to Home
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <ClipReel
      clips={reel.clips}
      startIndex={reel.startIndex}
      totalAvailable={reel.totalAvailable}
    />
  );
}
