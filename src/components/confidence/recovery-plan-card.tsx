"use client";

import { useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { RefreshCw, ThumbsUp, Target, ArrowRight } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  createRecoveryPlanAction,
  talkToCoachAboutCheckinAction,
} from "@/server/actions/confidenceActions";
import { AskCoachButton } from "@/components/coach/ask-coach-button";

export interface RecoveryPlanView {
  id: string;
  positives: string[];
  areasToImprove: string[];
  planSteps: string[];
  isDataBacked: boolean;
  /** The session these numbers came from, so the plan can point at it. */
  relatedSessionId?: string;
  /** The workout that session already generated, so "run that workout" is a
   * link rather than an instruction with nowhere to go. */
  relatedWorkoutId?: string;
  createdAt: string;
}

/**
 * "After a poor game" (BRD 7.10).
 *
 * Every line here is derived from the player's own stored records, which is
 * what the BRD's success criterion asks for - "a post-poor-game flow
 * references real data from that game or session". When there's no data yet
 * the card says exactly that instead of substituting encouragement.
 */
export function RecoveryPlanCard({ plan }: { plan?: RecoveryPlanView }) {
  const [isPending, startTransition] = useTransition();

  function handleGenerate() {
    startTransition(async () => {
      try {
        await createRecoveryPlanAction();
      } catch {
        toast.error("Couldn't build your plan right now.");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">After a rough game</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!plan ? (
          <>
            <p className="text-sm text-muted-foreground">
              Build a recovery plan from your actual numbers - what went well,
              what to fix, and what to do next.
            </p>
            <Button
              className="w-full"
              disabled={isPending}
              onClick={handleGenerate}
            >
              {isPending ? "Building..." : "Build my recovery plan"}
            </Button>
          </>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">
              Built {plan.createdAt}
              {plan.isDataBacked
                ? " from your logged sessions and workouts."
                : " - not enough logged activity yet to use your own numbers."}
            </p>

            {plan.positives.length > 0 && (
              <div>
                <p className="flex items-center gap-2 text-sm font-medium">
                  <ThumbsUp className="size-4" />
                  What went well
                </p>
                <ul className="mt-1 list-inside list-disc space-y-1 text-sm text-muted-foreground">
                  {plan.positives.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {plan.areasToImprove.length > 0 && (
              <div>
                <p className="flex items-center gap-2 text-sm font-medium">
                  <Target className="size-4" />
                  What to fix
                </p>
                <ul className="mt-1 list-inside list-disc space-y-1 text-sm text-muted-foreground">
                  {plan.areasToImprove.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <p className="text-sm font-medium">Your next steps</p>
              {/* A real ordered list, matching the pre-game routine's steps -
                  this is the same shape of content and should read the same. */}
              <ol className="mt-1 list-inside list-decimal space-y-1.5 text-sm text-muted-foreground">
                {plan.planSteps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>

            {/* BRD 7.10: "can recommend reviewing the last session". */}
            {plan.relatedSessionId && (
              <Link
                href={`/analyze/shooting/${plan.relatedSessionId}`}
                className={buttonVariants({
                  variant: "outline",
                  className: "w-full justify-between",
                })}
              >
                Review that session
                <ArrowRight className="size-4" />
              </Link>
            )}

            {/* The plan's "run the workout built from that session" step only
                appears when this exists, so the two stay in step. */}
            {plan.relatedWorkoutId && (
              <Link
                href={`/train/${plan.relatedWorkoutId}`}
                className={buttonVariants({
                  variant: "outline",
                  className: "w-full justify-between",
                })}
              >
                Start that workout
                <ArrowRight className="size-4" />
              </Link>
            )}

            {/* BRD 7.10 frames the recovery plan as Coach's work ("Coach
                analyzes the player's actual data"). This is that hand-off, on
                the plan itself - the page-level button follows today's
                pre-game feeling, so without this the plan loses its route to
                Coach the moment a player checks in before a game. */}
            <AskCoachButton
              action={talkToCoachAboutCheckinAction}
              targetId={plan.id}
              label="Talk to Coach about this plan"
              className="w-full"
            />

            <Button
              variant="ghost"
              className="w-full"
              disabled={isPending}
              onClick={handleGenerate}
            >
              <RefreshCw className="size-4" />
              {isPending ? "Rebuilding..." : "Rebuild from my latest data"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
