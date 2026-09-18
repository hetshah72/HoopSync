import { ObjectId } from "mongodb";
import Link from "next/link";
import { ChevronRight, LineChart, Target, Video } from "lucide-react";
import { auth } from "@/server/auth/auth";
import { listSessionsForUser } from "@/server/services/shotSessionService";
import { listAnalysesForUser } from "@/server/services/gameFootageService";
import { Badge } from "@/components/ui/badge";
import { PageHeader, SectionHeading } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { cn } from "@/lib/utils";

/**
 * Analyze is a standalone top-level section, not a Coach feature (BRD v1.1 §4).
 * Its two entry points are the whole point of the screen, so they lead as a
 * pair of large targets rather than as buttons stacked above a list.
 */
const ENTRY_POINTS = [
  {
    id: "shooting",
    href: "/analyze/shooting/new",
    label: "Shooting Session",
    description: "Record, then tap-log every make and miss by zone.",
    icon: LineChart,
    tone: "brand",
  },
  {
    id: "game-film",
    href: "/analyze/game-film",
    label: "Game Film",
    description: "Upload a clip and get a breakdown of what happened.",
    icon: Video,
    tone: "info",
  },
] as const;

export default async function AnalyzePage() {
  const session = await auth();
  const userId = session?.user?.id ? new ObjectId(session.user.id) : null;
  const [sessions, analyses] = userId
    ? await Promise.all([
        listSessionsForUser(userId),
        listAnalysesForUser(userId),
      ])
    : [[], []];

  return (
    <div>
      <PageHeader
        eyebrow="Analyze"
        title="Break down your game"
        description="Your shooting numbers come from what you logged yourself. Game film reviews say on each report where their findings came from."
      />

      <div className="mb-7 grid gap-3 sm:grid-cols-2">
        {ENTRY_POINTS.map(
          ({ id, href, label, description, icon: Icon, tone }) => (
            // Name from the title, description from the blurb: without this the
            // link's accessible name would be the title *and* the sentence run
            // together, which is both worse to hear and no longer "Shooting
            // Session" for the founder-loop e2e walk.
            <Link
              key={href}
              href={href}
              aria-labelledby={`${id}-title`}
              aria-describedby={`${id}-desc`}
              className="press lift group relative flex flex-col gap-3 overflow-hidden rounded-2xl border border-border/70 bg-card p-5 shadow-sm outline-none hover:border-brand/35 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span
                aria-hidden
                className={cn(
                  "inline-flex size-11 items-center justify-center rounded-xl",
                  tone === "brand"
                    ? "bg-brand-soft text-brand-soft-foreground"
                    : "bg-info-soft text-info-soft-foreground",
                )}
              >
                <Icon className="size-5" />
              </span>
              <span>
                <span
                  id={`${id}-title`}
                  className="block font-heading text-base font-semibold tracking-tight"
                >
                  {label}
                </span>
                <span
                  id={`${id}-desc`}
                  className="mt-1 block text-sm leading-relaxed text-muted-foreground text-pretty"
                >
                  {description}
                </span>
              </span>
            </Link>
          ),
        )}
      </div>

      {sessions.length === 0 ? (
        <EmptyState
          icon={Target}
          title="No shooting sessions yet"
          description="Upload a clip to log your first one - makes, misses, and locations are entered by you as you watch the video back, not detected automatically."
        />
      ) : (
        <>
          <SectionHeading
            title="Shooting sessions"
            count={sessions.length}
            className="mb-3"
          />
          <ul className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm md:grid md:grid-cols-2 md:gap-3 md:overflow-visible md:rounded-none md:border-0 md:bg-transparent md:shadow-none">
            {sessions.map((s) => {
              const analyzed = s.status === "completed";
              return (
                <li
                  key={s._id.toString()}
                  className="border-b border-border/60 last:border-b-0 md:overflow-hidden md:rounded-2xl md:border md:border-border/70 md:bg-card md:shadow-sm md:transition-colors md:hover:border-brand/35"
                >
                  <Link
                    href={`/analyze/shooting/${s._id}`}
                    className="press flex h-full items-center gap-3.5 px-4 py-3.5 transition-colors outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset md:py-4"
                  >
                    <span
                      aria-hidden
                      className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"
                    >
                      <Target className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-heading font-semibold tracking-tight">
                        Shooting Session - {s.recordedAt.toLocaleDateString()}
                      </p>
                      <p className="tabular mt-0.5 text-[0.8125rem] text-muted-foreground">
                        {s.totalMakes}/{s.totalAttempts}
                        {analyzed ? ` - ${s.fgPercent}% FG` : " logged so far"}
                      </p>
                    </div>
                    <Badge
                      variant={analyzed ? "success" : "outline"}
                      className="shrink-0"
                    >
                      {analyzed ? "Analyzed" : "Logging"}
                    </Badge>
                    <ChevronRight
                      aria-hidden
                      className="size-4 shrink-0 text-muted-foreground/60"
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/* Both entry points produce history, so both belong on the hub - a
          review that only exists behind its own index page is one a player has
          to remember to go looking for. */}
      {analyses.length > 0 && (
        <>
          <SectionHeading
            title="Game film"
            count={analyses.length}
            className="mt-7 mb-3"
          />
          <ul className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm md:grid md:grid-cols-2 md:gap-3 md:overflow-visible md:rounded-none md:border-0 md:bg-transparent md:shadow-none">
            {analyses.map((analysis) => (
              <li
                key={analysis._id.toString()}
                className="border-b border-border/60 last:border-b-0 md:overflow-hidden md:rounded-2xl md:border md:border-border/70 md:bg-card md:shadow-sm md:transition-colors md:hover:border-brand/35"
              >
                <Link
                  href={`/analyze/game-film/${analysis._id}`}
                  className="press flex h-full items-center gap-3.5 px-4 py-3.5 transition-colors outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset md:py-4"
                >
                  <span
                    aria-hidden
                    className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-info-soft text-info-soft-foreground"
                  >
                    <Video className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-heading font-semibold tracking-tight">
                      Game Film - {analysis.uploadedAt.toLocaleDateString()}
                    </p>
                    <p className="mt-0.5 truncate text-[0.8125rem] text-muted-foreground">
                      {analysis.status === "completed"
                        ? `${analysis.weaknesses.length} to work on - ${analysis.recommendedWorkoutIds.length} workout(s) ready`
                        : analysis.status === "failed"
                          ? "Review didn't finish"
                          : "Review in progress"}
                    </p>
                  </div>
                  <Badge
                    variant={
                      analysis.status === "completed"
                        ? "success"
                        : analysis.status === "failed"
                          ? "destructive"
                          : "info"
                    }
                    className="shrink-0"
                  >
                    {analysis.status === "completed"
                      ? "Reviewed"
                      : analysis.status === "failed"
                        ? "Failed"
                        : "Reviewing"}
                  </Badge>
                  <ChevronRight
                    aria-hidden
                    className="size-4 shrink-0 text-muted-foreground/60"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
