import { ObjectId } from "mongodb";
import { notFound } from "next/navigation";
import { auth } from "@/server/auth/auth";
import { getWorkoutForUser } from "@/server/services/workoutService";
import { ActiveWorkout } from "@/components/train/active-workout";

export default async function ActiveWorkoutPage({
  params,
}: {
  params: Promise<{ workoutId: string }>;
}) {
  const { workoutId } = await params;
  if (!/^[0-9a-fA-F]{24}$/.test(workoutId)) {
    notFound();
  }

  const session = await auth();
  if (!session?.user?.id) {
    notFound();
  }

  const workout = await getWorkoutForUser(
    new ObjectId(session.user.id),
    new ObjectId(workoutId),
  );
  if (!workout) {
    notFound();
  }

  // A workout with no drills can't be stepped through at all. It isn't
  // reachable from any current creation path, but rendering the drill flow
  // against an empty array would crash on `drills[0]`, so fail cleanly.
  if (workout.drills.length === 0) {
    notFound();
  }

  return (
    <ActiveWorkout
      workout={{
        id: workout._id.toString(),
        label: workout.source.label,
        status: workout.status,
        difficulty: workout.difficulty,
        estimatedDurationMinutes: workout.estimatedDurationMinutes,
        actualDurationSeconds: workout.actualDurationSeconds,
        coverageNote: workout.coverageNote,
        drills: workout.drills.map((drill) => ({
          drillId: drill.drillId.toString(),
          order: drill.order,
          name: drill.name,
          description: drill.description,
          videoUrl: drill.videoUrl,
          videoSource: drill.videoSource,
          coachingCues: drill.coachingCues,
          difficulty: drill.difficulty,
          sets: drill.sets,
          reps: drill.reps,
          durationSeconds: drill.durationSeconds,
          completed: drill.completed,
          skipped: drill.skipped ?? false,
          elapsedSeconds: drill.elapsedSeconds ?? 0,
        })),
      }}
    />
  );
}
