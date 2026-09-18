"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Dumbbell } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { startWorkoutFromSignatureMoveAction } from "@/server/actions/nbaPlayerActions";

// Deliberately not the full `SignatureMove` type: that includes `drillId`
// (a MongoDB ObjectId), and Next.js's Server->Client Component boundary
// rejects class instances with a toJSON method as props - only plain,
// serializable values are allowed. This component never needs the drill id
// itself anyway (the server action re-looks it up by signature move id).
export interface SignatureMoveView {
  id: string;
  name: string;
  whatItIs: string;
  whenUsed: string;
  whatMakesItEffective: string;
  keyMechanics: string[];
  commonMistakes: string[];
  /** BRD 7.4 requires every signature move to name the drill that practises it. */
  drill: {
    name: string;
    description: string;
    equipmentNeeded: string[];
  };
}

export function SignatureMoveCard({
  playerId,
  move,
}: {
  playerId: string;
  move: SignatureMoveView;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleStartWorkout() {
    startTransition(async () => {
      try {
        const { workoutId } = await startWorkoutFromSignatureMoveAction(
          playerId,
          move.id,
        );
        toast.success("Workout created from this signature move.");
        router.push(`/train/${workoutId}`);
      } catch (err) {
        // Surface the real server message (e.g. "No drills match your
        // available equipment yet") - a generic toast hid the one piece of
        // information that told the player how to fix it.
        toast.error(
          err instanceof Error
            ? err.message
            : "Couldn't start that workout right now.",
        );
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{move.name}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div>
          <p className="font-medium text-muted-foreground">What it is</p>
          <p>{move.whatItIs}</p>
        </div>
        <div>
          <p className="font-medium text-muted-foreground">When it&apos;s used</p>
          <p>{move.whenUsed}</p>
        </div>
        <div>
          <p className="font-medium text-muted-foreground">Why it works</p>
          <p>{move.whatMakesItEffective}</p>
        </div>
        <div>
          <p className="font-medium text-muted-foreground">Key mechanics</p>
          <ul className="list-inside list-disc">
            {move.keyMechanics.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="font-medium text-muted-foreground">Common mistakes</p>
          <ul className="list-inside list-disc">
            {move.commonMistakes.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="font-medium text-muted-foreground">Drill to practise it</p>
          <p className="font-medium">{move.drill.name}</p>
          <p className="text-muted-foreground">{move.drill.description}</p>
          {move.drill.equipmentNeeded.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {move.drill.equipmentNeeded.map((item) => (
                <Badge key={item} variant="outline" className="capitalize">
                  {item}
                </Badge>
              ))}
            </div>
          )}
        </div>

        <Button
          className="w-full"
          disabled={isPending}
          onClick={handleStartWorkout}
        >
          <Dumbbell className="size-4" />
          {isPending ? "Starting..." : "Start Matching Workout"}
        </Button>
      </CardContent>
    </Card>
  );
}
