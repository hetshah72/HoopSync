"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Bookmark,
  Dumbbell,
  Heart,
  ListPlus,
  MessageCircle,
  Share2,
  Sparkles,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FEED_KIND_LABELS, FEED_TYPE_LABELS } from "@/lib/feed-options";
import {
  MediaDisclosureNote,
  MediaSourceChip,
} from "@/components/content/media-disclosure";
import type { MediaView } from "@/server/services/mediaProvenanceService";
import type { FeedItemView } from "@/server/services/feedService";
import {
  addDrillToWorkoutFromFeedItemAction,
  askCoachAboutFeedItemAction,
  shareFeedItemAction,
  startDrillFromFeedItemAction,
  toggleFeedInteractionAction,
} from "@/server/actions/feedActions";

/**
 * A feed card's clip (BRD 7.14 "short-form and engaging").
 *
 * `preload="metadata"` rather than autoplay: several of these can be on
 * screen at once in the Home column, and fetching every clip's bytes on
 * render would be a connection storm for content the player may never tap.
 *
 * The disclosure below is not decoration - it is the "clearly labeled"
 * half of the bargain BRD 6.4 strikes to let the product demo before a
 * league licence exists. It is derived from the asset, so if licensed
 * footage replaces the placeholder the label changes with it.
 */
function FeedCardMedia({
  media,
  title,
  feedItemId,
}: {
  media: MediaView;
  title: string;
  feedItemId: string;
}) {
  if (media.type !== "video") return null;

  return (
    <div className="space-y-1.5">
      <video
        src={media.url}
        controls
        playsInline
        muted
        loop
        preload="metadata"
        aria-label={`${media.disclosure.sourceLabel} for ${title}`}
        className="aspect-video w-full rounded-lg bg-black"
      />
      <div className="flex items-start justify-between gap-3">
        <MediaDisclosureNote disclosure={media.disclosure} />
        {/* Opens the reel *on this clip* - see getClipReel, which resolves the
            index against the full list before windowing so the deep link can
            never land on a different clip under a different disclosure. */}
        <Link
          href={`/clips?start=${feedItemId}`}
          className="shrink-0 text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          Watch in Clips
        </Link>
      </div>
    </div>
  );
}

function ActionButton({
  onClick,
  disabled,
  active,
  activeClassName,
  icon: Icon,
  label,
}: {
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  activeClassName?: string;
  icon: typeof Heart;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "press inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-xs font-medium transition-colors outline-none hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
        active
          ? activeClassName
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className={cn("size-4", active && "fill-current")} />
      {label}
    </button>
  );
}

export function FeedCard({ item }: { item: FeedItemView }) {
  const router = useRouter();
  const [liked, setLiked] = useState(item.liked);
  const [saved, setSaved] = useState(item.saved);
  const [showRelated, setShowRelated] = useState(false);
  const [isPending, startTransition] = useTransition();

  const badge =
    item.kind === "library"
      ? FEED_TYPE_LABELS[item.type]
      : FEED_KIND_LABELS[item.kind];

  function handleToggle(action: "like" | "save") {
    const current = action === "like" ? liked : saved;
    const setter = action === "like" ? setLiked : setSaved;
    setter(!current);
    startTransition(async () => {
      try {
        const { active } = await toggleFeedInteractionAction(item.id, action);
        setter(active);
      } catch {
        setter(current);
        toast.error("Something went wrong. Please try again.");
      }
    });
  }

  function handleShare() {
    startTransition(async () => {
      try {
        const { shareText } = await shareFeedItemAction(item.id);
        if (typeof navigator !== "undefined" && navigator.share) {
          await navigator.share({ title: item.title, text: shareText });
        } else if (typeof navigator !== "undefined" && navigator.clipboard) {
          await navigator.clipboard.writeText(shareText);
          toast.success("Copied to clipboard.");
        } else {
          // An insecure origin has neither API. Saying so beats a button that
          // records a share and then appears to do nothing (audit FEED-05).
          toast.error("Sharing isn't available in this browser.");
        }
      } catch {
        // A user cancelling the native share sheet also rejects the
        // promise - don't show an error toast for that.
      }
    });
  }

  function handleAskCoach() {
    startTransition(async () => {
      try {
        const { conversationId } = await askCoachAboutFeedItemAction(item.id);
        router.push(`/coach/${conversationId}`);
      } catch {
        toast.error("Couldn't reach Coach right now.");
      }
    });
  }

  function handleStartDrill() {
    if (!item.relatedDrillId) return;
    const drillId = item.relatedDrillId;
    startTransition(async () => {
      try {
        const { workoutId } = await startDrillFromFeedItemAction(drillId);
        // Straight into the workout, not the Train list (audit Bug Feed-2).
        router.push(`/train/${workoutId}`);
      } catch {
        toast.error("Couldn't start that drill right now.");
      }
    });
  }

  function handleAddToWorkout() {
    if (!item.relatedDrillId) return;
    const drillId = item.relatedDrillId;
    startTransition(async () => {
      try {
        const { alreadyIncluded } = await addDrillToWorkoutFromFeedItemAction(drillId);
        toast.success(
          alreadyIncluded
            ? "Already in your next workout."
            : "Added to your next workout.",
        );
      } catch {
        toast.error("Couldn't add that drill right now.");
      }
    });
  }

  return (
    <Card id={`card-${item.id}`} className="snap-start scroll-mt-2">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <Badge variant="brand">{badge}</Badge>
        {item.media && <MediaSourceChip disclosure={item.media.disclosure} />}
      </CardHeader>
      <CardContent className="space-y-4">
        {item.media && (
          <FeedCardMedia
            media={item.media}
            title={item.title}
            feedItemId={item.id}
          />
        )}

        <div>
          <h3 className="font-heading text-[1.0625rem] leading-snug font-semibold tracking-tight text-balance">
            {item.title}
          </h3>
          <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground text-pretty">
            {item.body}
          </p>
        </div>

        {item.relatedWorkoutId && (
          <Link
            href={`/train/${item.relatedWorkoutId}`}
            className={buttonVariants({ size: "lg", className: "w-full" })}
          >
            Start workout
          </Link>
        )}

        {item.relatedPlayerId && !item.relatedWorkoutId && (
          <Link
            href={`/players/${item.relatedPlayerId}`}
            className={buttonVariants({
              variant: "outline",
              size: "lg",
              className: "w-full",
            })}
          >
            View player
          </Link>
        )}

        {item.relatedSessionId && (
          <Link
            href={`/analyze/shooting/${item.relatedSessionId}`}
            className={buttonVariants({
              variant: "outline",
              size: "lg",
              className: "w-full",
            })}
          >
            Open the shooting report
          </Link>
        )}

        {/* The measured numbers behind the card, shown verbatim so the copy
            can always be checked against the records it came from. */}
        {item.provenance && item.provenance.facts.length > 0 && (
          <ul className="space-y-1 rounded-xl border border-border/60 bg-muted/50 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            {item.provenance.facts.map((fact) => (
              <li key={fact} className="tabular">
                Based on your data: {fact}
              </li>
            ))}
          </ul>
        )}

        {/* Same disclosure discipline as the simulated mechanical analysis in
            Analyze: generated wording is always labeled as generated. */}
        {item.provenance?.copySource === "ai" && (
          <p className="text-[11px] italic text-muted-foreground">
            Wording written by AI from the real numbers above. The numbers
            themselves come from your own logged sessions and workouts.
          </p>
        )}

        <div className="-mx-1 flex flex-wrap items-center gap-0.5 border-t border-border/60 pt-2.5">
          <ActionButton
            onClick={() => handleToggle("like")}
            disabled={isPending}
            active={liked}
            activeClassName="text-destructive"
            icon={Heart}
            label="Like"
          />
          <ActionButton
            onClick={() => handleToggle("save")}
            disabled={isPending}
            active={saved}
            activeClassName="text-brand-ink"
            icon={Bookmark}
            label="Save"
          />
          <ActionButton
            onClick={handleShare}
            disabled={isPending}
            icon={Share2}
            label="Share"
          />
          <ActionButton
            onClick={handleAskCoach}
            disabled={isPending}
            icon={MessageCircle}
            label="Ask Coach"
          />
          {item.relatedDrillId && (
            <>
              <ActionButton
                onClick={handleStartDrill}
                disabled={isPending}
                icon={Dumbbell}
                label="Start Drill"
              />
              <ActionButton
                onClick={handleAddToWorkout}
                disabled={isPending}
                icon={ListPlus}
                label="Add to Workout"
              />
            </>
          )}
          {item.related.length > 0 && (
            <ActionButton
              onClick={() => setShowRelated((v) => !v)}
              active={showRelated}
              activeClassName="text-brand-ink"
              icon={Sparkles}
              label="Related"
            />
          )}
        </div>

        {showRelated && (
          <ul className="animate-pop space-y-1.5 rounded-xl border border-border/60 bg-muted/50 px-3 py-2.5 text-xs">
            {item.related.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
