"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bookmark, Dumbbell, Heart, Share2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { MediaSourceChip } from "@/components/content/media-disclosure";
import {
  shareFeedItemAction,
  startDrillFromFeedItemAction,
  toggleFeedInteractionAction,
} from "@/server/actions/feedActions";
import type { ClipView } from "@/server/services/feedService";

/**
 * The short-form reel (BRD 7.14: "a TikTok/Instagram consumption model
 * applied to basketball development").
 *
 * A native CSS scroll-snap column rather than a JS pager: the browser already
 * does momentum, rubber-banding and snapping better than a hand-rolled
 * implementation, and it keeps the surface keyboard- and screen-reader-
 * reachable as a plain list. The only JS here is what CSS cannot do - deciding
 * which clip is on screen so exactly one video plays.
 *
 * Provenance is not optional chrome. Every slide carries its source label and
 * its disclosure over the video, because BRD 6.4 permits placeholders *only*
 * while they are clearly labeled, and a full-bleed player is the easiest place
 * in the app to accidentally present a stand-in as the real thing.
 */
const VISIBLE_RATIO = 0.6;

export function ClipReel({
  clips,
  startIndex,
  totalAvailable,
}: {
  clips: ClipView[];
  startIndex: number;
  totalAvailable: number;
}) {
  const scrollerRef = useRef<HTMLOListElement>(null);
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const [activeIndex, setActiveIndex] = useState(startIndex);

  // Open on the clip the player actually tapped. Instant (not smooth) so the
  // reel starts where it was asked to rather than visibly scrolling there.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller || startIndex <= 0) return;
    scroller.scrollTo({ top: startIndex * scroller.clientHeight, behavior: "instant" });
  }, [startIndex]);

  // Exactly one clip plays at a time.
  //
  // Filter to the entries that are actually on screen, then take that one -
  // deliberately not "the entry with the highest ratio". Adjacent full-height
  // slides sum to ~1, so neither can exceed the threshold alone, and an
  // IntersectionObserver callback only contains the entries that *crossed* a
  // threshold in that batch. Picking a max over that partial set selects the
  // departing slide, which leaves the wrong video playing under the wrong
  // disclosure.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const onScreen = entries.find(
          (entry) => entry.isIntersecting && entry.intersectionRatio >= VISIBLE_RATIO,
        );
        if (!onScreen) return;
        const index = Number((onScreen.target as HTMLElement).dataset.index);
        if (!Number.isNaN(index)) setActiveIndex(index);
      },
      { root: scroller, threshold: [VISIBLE_RATIO] },
    );

    for (const slide of scroller.querySelectorAll("[data-index]")) {
      observer.observe(slide);
    }
    return () => observer.disconnect();
  }, [clips.length]);

  useEffect(() => {
    videoRefs.current.forEach((video, index) => {
      if (!video) return;
      if (index === activeIndex) {
        // Autoplay is only permitted while muted; the slide offers unmute.
        void video.play().catch(() => {});
      } else {
        video.pause();
        video.currentTime = 0;
      }
    });
  }, [activeIndex]);

  function step(delta: number) {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const next = Math.max(0, Math.min(activeIndex + delta, clips.length - 1));
    scroller.scrollTo({ top: next * scroller.clientHeight });
  }

  /**
   * Keyboard paging lives on the scroller, which is what actually holds focus.
   * Space in particular has to be handled here: the browser treats it as
   * page-down on a focused scrollable element, so a play/pause button that is
   * never focused would never receive it.
   */
  function handleKeyDown(event: React.KeyboardEvent<HTMLOListElement>) {
    if (event.key === "ArrowDown" || event.key === "PageDown") {
      event.preventDefault();
      step(1);
    } else if (event.key === "ArrowUp" || event.key === "PageUp") {
      event.preventDefault();
      step(-1);
    } else if (event.key === " ") {
      event.preventDefault();
      const video = videoRefs.current[activeIndex];
      if (video) {
        if (video.paused) void video.play().catch(() => {});
        else video.pause();
      }
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black">
      <Link
        href="/home"
        aria-label="Close clips"
        className="absolute top-[max(0.75rem,env(safe-area-inset-top))] right-3 z-20 rounded-full bg-black/50 p-2 text-white backdrop-blur-sm transition-colors hover:bg-black/70"
      >
        <X className="size-5" />
      </Link>

      <ol
        ref={scrollerRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        aria-label={`Clips - ${totalAvailable} available`}
        className="h-full snap-y snap-mandatory overflow-y-auto outline-none"
      >
        {clips.map((clip, index) => (
          <ClipSlide
            key={clip.id}
            clip={clip}
            index={index}
            isActive={index === activeIndex}
            registerVideo={(el) => {
              videoRefs.current[index] = el;
            }}
          />
        ))}
      </ol>
    </div>
  );
}

function ClipSlide({
  clip,
  index,
  isActive,
  registerVideo,
}: {
  clip: ClipView;
  index: number;
  isActive: boolean;
  registerVideo: (el: HTMLVideoElement | null) => void;
}) {
  const router = useRouter();
  const [liked, setLiked] = useState(clip.liked);
  const [saved, setSaved] = useState(clip.saved);
  const [muted, setMuted] = useState(true);
  const [isStarting, startTransition] = useTransition();

  function toggle(action: "like" | "save") {
    const next = action === "like" ? !liked : !saved;
    if (action === "like") setLiked(next);
    else setSaved(next);

    startTransition(async () => {
      try {
        await toggleFeedInteractionAction(clip.id, action);
        if (action === "save") router.refresh();
      } catch {
        // Roll back rather than leave the screen claiming a write that failed.
        if (action === "like") setLiked(!next);
        else setSaved(!next);
        toast.error("Couldn't save that - try again.");
      }
    });
  }

  async function share() {
    const text = `${clip.title}\n\n${clip.body}`;
    try {
      if (navigator.share) await navigator.share({ title: clip.title, text });
      else {
        await navigator.clipboard.writeText(text);
        toast.success("Copied to clipboard.");
      }
      void shareFeedItemAction(clip.id);
    } catch {
      // A dismissed share sheet is not an error worth interrupting for.
    }
  }

  function startDrill() {
    const drillId = clip.relatedDrillId;
    if (!drillId) return;
    startTransition(async () => {
      try {
        const { workoutId } = await startDrillFromFeedItemAction(drillId);
        router.push(`/train/${workoutId}`);
      } catch {
        toast.error("Couldn't start that drill right now.");
      }
    });
  }

  const cta = primaryActionFor(clip);

  return (
    <li
      data-index={index}
      className="relative h-full w-full snap-start snap-always"
    >
      <video
        ref={registerVideo}
        src={clip.media.url}
        // Only the current slide and its neighbours are worth fetching; a
        // long reel would otherwise open a connection per clip on mount.
        preload={Math.abs(index) <= 1 ? "metadata" : "none"}
        playsInline
        loop
        muted={muted}
        aria-label={`${clip.media.disclosure.sourceLabel}: ${clip.title}`}
        className="h-full w-full object-contain"
      />

      {/* Scrim: the disclosure and the title have to stay legible over
          arbitrary footage, and a text shadow alone does not survive a
          bright frame. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/85 via-black/40 to-transparent" />

      <div className="absolute top-[max(0.75rem,env(safe-area-inset-top))] left-3 z-10 flex items-center gap-2">
        <MediaSourceChip disclosure={clip.media.disclosure} />
        {clip.media.durationSeconds !== undefined && (
          <span className="rounded-full bg-black/50 px-2 py-0.5 text-[0.6875rem] font-medium text-white/90 backdrop-blur-sm">
            {formatClipDuration(clip.media.durationSeconds)}
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={() => setMuted((m) => !m)}
        aria-label={muted ? "Unmute" : "Mute"}
        className="absolute top-[max(0.75rem,env(safe-area-inset-top))] right-14 z-10 rounded-full bg-black/50 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm"
      >
        {muted ? "Sound off" : "Sound on"}
      </button>

      <div className="absolute right-3 bottom-28 z-10 flex flex-col items-center gap-4">
        {/* A toggle button keeps a stable accessible name and expresses its
            state through aria-pressed - swapping the name to "Unlike" as well
            would announce the change twice and leaves nothing stable to
            address the control by. */}
        <RailButton label="Like" active={liked} onClick={() => toggle("like")}>
          <Heart className={cn("size-6", liked && "fill-current")} />
        </RailButton>
        <RailButton label="Save" active={saved} onClick={() => toggle("save")}>
          <Bookmark className={cn("size-6", saved && "fill-current")} />
        </RailButton>
        <RailButton label="Share" onClick={share}>
          <Share2 className="size-6" />
        </RailButton>
      </div>

      <div className="absolute inset-x-0 bottom-0 z-10 space-y-2 p-4 pr-20 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <h2 className="font-heading text-lg leading-snug font-semibold text-white text-balance">
          {clip.title}
        </h2>
        <p className="line-clamp-3 text-sm leading-relaxed text-white/80">
          {clip.body}
        </p>

        {/* Always visible, never behind a tap. This is the "clearly labeled"
            half of the bargain that lets a placeholder ship at all. */}
        <p className="text-xs text-white/70 italic">
          {clip.media.disclosure.note ?? clip.media.disclosure.sourceLabel}
          {clip.media.disclosure.attribution
            ? ` ${clip.media.disclosure.attribution}`
            : null}
        </p>

        {clip.relatedDrillId ? (
          // A button, not a link to /train?drill=<id>: that route does not read
          // a drill param, so such a link would drop the player on the Train
          // list having done nothing - the dead end BRD v1.1 §8 forbids and the
          // audit already caught once (Bug Feed-2). This runs the same action
          // the feed card runs and lands *inside* the created workout.
          <button
            type="button"
            onClick={startDrill}
            disabled={isStarting}
            className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black disabled:opacity-60"
          >
            <Dumbbell className="size-4" />
            {isStarting ? "Starting…" : "Train this"}
          </button>
        ) : (
          cta && (
            <Link
              href={cta.href}
              className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black"
            >
              <Dumbbell className="size-4" />
              {cta.label}
            </Link>
          )
        )}
      </div>

      {!isActive && <span className="sr-only">Off screen</span>}
    </li>
  );
}

function RailButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "rounded-full bg-black/40 p-2.5 text-white backdrop-blur-sm transition-colors hover:bg-black/60",
        active && "text-brand-ink",
      )}
    >
      {children}
    </button>
  );
}

/**
 * One destination per clip, chosen the same way the feed card chooses its
 * primary button - so a reel never offers a route the card would not.
 *
 * The drill case is deliberately absent: starting a drill is a write, handled
 * by `startDrill` above, not a navigation.
 */
function primaryActionFor(clip: ClipView): { href: string; label: string } | null {
  if (clip.relatedWorkoutId)
    return { href: `/train/${clip.relatedWorkoutId}`, label: "Start workout" };
  if (clip.relatedPlayerId)
    return { href: `/players/${clip.relatedPlayerId}`, label: "View player" };
  if (clip.relatedSessionId)
    return { href: `/analyze/shooting/${clip.relatedSessionId}`, label: "Open report" };
  return null;
}

function formatClipDuration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${(whole % 60).toString().padStart(2, "0")}`;
}
