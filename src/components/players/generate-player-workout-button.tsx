"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { generateWorkoutFromPlayerAction } from "@/server/actions/nbaPlayerActions";

export function GeneratePlayerWorkoutButton({
  playerId,
  playerName,
}: {
  playerId: string;
  playerName: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      try {
        const { workoutId } = await generateWorkoutFromPlayerAction(playerId);
        router.push(`/train/${workoutId}`);
      } catch (err) {
        // The server's message is the actionable one ("try adding equipment
        // in your profile"); a generic toast threw it away.
        toast.error(
          err instanceof Error
            ? err.message
            : "Couldn't generate a workout right now.",
        );
      }
    });
  }

  return (
    <Button className="w-full" disabled={isPending} onClick={handleClick}>
      <Sparkles className="size-4" />
      {isPending ? "Generating..." : `Generate Workout Modeled After ${playerName}`}
    </Button>
  );
}
