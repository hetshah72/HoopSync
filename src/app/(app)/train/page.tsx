import { ObjectId } from "mongodb";
import Link from "next/link";
import { ChevronRight, Clock, Dumbbell } from "lucide-react";
import { auth } from "@/server/auth/auth";
import { getProfileByUserId } from "@/server/services/profileService";
import { listWorkoutsForUser } from "@/server/services/workoutService";
import { countDrillsBySkill } from "@/server/repositories/drillRepository";
import { GenerateWorkoutForm } from "@/components/train/generate-workout-form";
import { Badge } from "@/components/ui/badge";
import { PageHeader, SectionHeading } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { SKILL_CATEGORIES } from "@/lib/validation/onboarding";
import type { WorkoutStatus } from "@/types/db";

const STATUS_VARIANT: Record<
  WorkoutStatus,
  "outline" | "brand" | "success"
> = {
  pending: "outline",
  in_progress: "brand",
  completed: "success",
};

export default async function TrainPage() {
  const session = await auth();
  const userId = session?.user?.id ? new ObjectId(session.user.id) : null;

  const [profile, workouts] = userId
    ? await Promise.all([getProfileByUserId(userId), listWorkoutsForUser(userId)])
    : [null, []];

  // Counted against the player's real equipment so a skill they can't
  // currently train is marked before they tap it, not after it fails.
  const drillsPerSkill = profile
    ? await countDrillsBySkill([...SKILL_CATEGORIES], profile.equipment ?? [])
    : {};

  return (
    <div>
      <PageHeader
        eyebrow="Train"
        title="Build today's session"
        description="Pick the skills you want to work on and we'll assemble a workout from drills your equipment actually supports."
      />

      <GenerateWorkoutForm
        suggestedSkills={profile?.focusAreas ?? []}
        drillsPerSkill={drillsPerSkill}
      />

      {workouts.length === 0 ? (
        <EmptyState
          className="mt-5"
          icon={Dumbbell}
          title="No workouts yet"
          description="Generate one above, or start one from an NBA player's profile or a Home feed card."
        />
      ) : (
        <>
          <SectionHeading
            title="Your workouts"
            count={workouts.length}
            className="mt-7 mb-3"
          />
          <ul className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm md:grid md:grid-cols-2 md:gap-3 md:overflow-visible md:rounded-none md:border-0 md:bg-transparent md:shadow-none">
            {workouts.map((workout) => (
              <li
                key={workout._id.toString()}
                className="border-b border-border/60 last:border-b-0 md:overflow-hidden md:rounded-2xl md:border md:border-border/70 md:bg-card md:shadow-sm md:transition-colors md:hover:border-brand/35"
              >
                <Link
                  href={`/train/${workout._id}`}
                  className="press flex h-full items-center gap-3.5 px-4 py-3.5 transition-colors outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset md:py-4"
                >
                  <span
                    aria-hidden
                    className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"
                  >
                    <Dumbbell className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-heading font-semibold tracking-tight">
                      {workout.source.label}
                    </p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[0.8125rem] text-muted-foreground">
                      <Clock aria-hidden className="size-3.5" />
                      <span className="tabular">
                        {workout.drills.length} drill
                        {workout.drills.length === 1 ? "" : "s"} &middot; ~
                        {workout.estimatedDurationMinutes} min
                      </span>
                    </p>
                  </div>
                  <Badge
                    variant={STATUS_VARIANT[workout.status]}
                    className="shrink-0 capitalize"
                  >
                    {workout.status.replace("_", " ")}
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
