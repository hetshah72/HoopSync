import Link from "next/link";
import { ObjectId } from "mongodb";
import { Bookmark, Brain, ChevronRight, Clapperboard, Quote } from "lucide-react";
import { auth } from "@/server/auth/auth";
import { getProfileByUserId } from "@/server/services/profileService";
import { getPersonalizedFeed } from "@/server/services/feedService";
import { getStartingPlan } from "@/server/services/workoutGenerationService";
import { StartingPlanCard } from "@/components/home/starting-plan-card";
import { SKILL_LABELS, COACH_PERSONALITY_INFO } from "@/lib/onboarding-options";
import { Card, CardContent } from "@/components/ui/card";
import { FeedCard } from "@/components/feed/feed-card";

/**
 * Home is a feed, not a dashboard (BRD 7.2).
 *
 * The welcome block and the daily quote are part of the feed rather than fixed
 * chrome above a list, so scrolling starts in the content instead of past a
 * header the player has already read.
 *
 * Two layouts from one DOM order:
 *
 *   phone    a single snap-scrolling column - hero, plan, confidence, quote,
 *            then the feed. Snapping is native CSS; the container's height
 *            derives from `--app-chrome` (see the app shell) rather than a
 *            hardcoded figure that goes stale whenever the chrome changes.
 *   desktop  the hero spans the full measure, the feed takes the main column,
 *            and the plan/confidence/quote cards become a sticky right rail.
 *            Snapping is off - a viewport-height snap feed is a phone
 *            gesture, and on a desktop it just fights the scroll wheel.
 *
 * The rail and the feed wrapper are `display: contents` on phones so their
 * children flatten back into the single column in source order, which is what
 * lets one markup order serve both layouts without duplicating cards.
 */
export default async function HomePage() {
  const session = await auth();
  // The (app) layout already guarantees a completed profile exists before
  // rendering this page - session/profile are non-null here in practice.
  const userId = session?.user?.id ? new ObjectId(session.user.id) : null;
  const [profile, feed, startingPlan] = userId
    ? await Promise.all([
        getProfileByUserId(userId),
        getPersonalizedFeed(userId),
        getStartingPlan(userId),
      ])
    : [null, { quote: null, items: [] }, null];

  const firstName = session?.user?.name?.split(" ")[0];

  return (
    <div className="-my-2 grid h-[calc(100svh-var(--app-chrome))] snap-y snap-mandatory auto-rows-max gap-3 overflow-y-auto overscroll-contain py-2 lg:my-0 lg:h-auto lg:snap-none lg:grid-cols-[minmax(0,1fr)_19rem] lg:items-start lg:gap-6 lg:overflow-visible lg:py-0">
      {/* The greeting is the one ink-on-dark surface in the app. It anchors
          the top of the feed and keeps every card below it - which are all
          white - from reading as one continuous sheet. */}
      <section className="relative snap-start overflow-hidden rounded-2xl bg-hero px-5 py-6 text-hero-foreground shadow-lg lg:col-span-2 lg:px-8 lg:py-8">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-16 size-64 rounded-full bg-brand/25 blur-3xl"
        />
        <div className="relative flex flex-col gap-3.5">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <p className="text-[0.6875rem] font-semibold tracking-[0.12em] text-hero-foreground/60 uppercase">
                Today
              </p>
              <h1 className="font-heading text-2xl leading-tight font-bold tracking-tight lg:text-3xl">
                Welcome back{firstName ? `, ${firstName}` : ""}
              </h1>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {/* Clips and Saved are both reached from here rather than from
                  the tab bar - the nav is fixed at six by BRD v1.1 §4. */}
              <Link
                href="/clips"
                aria-label="Clips"
                className="press inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-hero-foreground/10 text-hero-foreground outline-none hover:bg-hero-foreground/20 focus-visible:ring-3 focus-visible:ring-hero-foreground/40"
              >
                <Clapperboard className="size-4" />
              </Link>
              <Link
                href="/saved"
                aria-label="Saved items"
                className="press inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-hero-foreground/10 text-hero-foreground outline-none hover:bg-hero-foreground/20 focus-visible:ring-3 focus-visible:ring-hero-foreground/40"
              >
                <Bookmark className="size-4" />
              </Link>
            </div>
          </div>

          {profile ? (
            <>
              {profile.primaryGoal && (
                <p className="text-sm text-hero-foreground/65">
                  Your goal:{" "}
                  <span className="font-medium text-hero-foreground">
                    {profile.primaryGoal}
                  </span>
                </p>
              )}
              <div className="flex flex-wrap gap-1.5">
                {profile.focusAreas.map((area) => (
                  <span
                    key={area}
                    className="rounded-full bg-hero-foreground/12 px-2.5 py-1 text-[0.6875rem] font-semibold text-hero-foreground/90 ring-1 ring-hero-foreground/10"
                  >
                    {SKILL_LABELS[area]}
                  </span>
                ))}
              </div>
              <p className="text-sm text-hero-foreground/65">
                Coach is set to{" "}
                <span className="font-medium text-hero-foreground">
                  {COACH_PERSONALITY_INFO[profile.coachPersonality].label}
                </span>
                .
              </p>
            </>
          ) : (
            <p className="text-sm text-hero-foreground/65">
              Complete onboarding to see your personalized plan here.
            </p>
          )}
        </div>
      </section>

      <aside className="contents lg:col-start-2 lg:row-start-2 lg:block lg:sticky lg:top-9 lg:space-y-4">
        {startingPlan?.status === "pending" && (
          <div className="snap-start">
            <StartingPlanCard workout={startingPlan} />
          </div>
        )}

        {/* Confidence / Mental Game (BRD 7.10). Lives here rather than in the
            nav, which is fixed at six destinations by BRD v1.1 §4. */}
        <Link href="/confidence" className="block snap-start">
          <Card interactive>
            <CardContent className="flex items-center gap-4">
              <span
                aria-hidden
                className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-info-soft text-info-soft-foreground"
              >
                <Brain className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-heading font-semibold tracking-tight">
                  Game today?
                </p>
                <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground text-pretty">
                  Get a routine for how you&apos;re feeling, or a recovery plan
                  built from your own numbers.
                </p>
              </div>
              <ChevronRight
                aria-hidden
                className="size-4 shrink-0 text-muted-foreground/60 lg:hidden"
              />
            </CardContent>
          </Card>
        </Link>

        {feed.quote && (
          <Card className="snap-start border-brand/20 bg-brand-soft/50">
            <CardContent className="flex gap-3.5">
              <Quote
                aria-hidden
                className="size-5 shrink-0 fill-current text-brand/40"
              />
              {/* A real <blockquote>/<cite> rather than two styled <p>s: it is
                  the correct semantics, and it gives the daily-quote e2e check
                  something durable to target instead of a styling class. */}
              <blockquote className="min-w-0">
                <p className="font-heading leading-relaxed font-medium text-balance">
                  {feed.quote.text}
                </p>
                <cite className="mt-2 block text-xs font-medium text-brand-ink not-italic">
                  {feed.quote.author}
                </cite>
              </blockquote>
            </CardContent>
          </Card>
        )}
      </aside>

      <div className="contents lg:col-start-1 lg:row-start-2 lg:block lg:space-y-4">
        {feed.items.map((item) => (
          <FeedCard key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}
