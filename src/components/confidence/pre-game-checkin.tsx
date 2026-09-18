"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChipGroup } from "@/components/ui/chip-group";
import {
  CONFIDENCE_FEELINGS,
  FEELING_LABELS,
  routineFor,
} from "@/lib/confidence-routines";
import { recordPreGameCheckinAction } from "@/server/actions/confidenceActions";
import type { ConfidenceFeeling } from "@/types/db";

/**
 * "Before the Game: ask 'How are you feeling?'" (BRD 7.10).
 *
 * The routine renders immediately on selection - it's derived from a fixed
 * table, not fetched - because a player opening this in a gym five minutes
 * before tip-off should not wait on a round-trip. The check-in is recorded in
 * the background so Progress and Coach can see it.
 */
export function PreGameCheckin({
  initialFeeling,
}: {
  initialFeeling?: ConfidenceFeeling;
}) {
  const [feeling, setFeeling] = useState<ConfidenceFeeling | undefined>(
    initialFeeling,
  );
  const [, startTransition] = useTransition();

  function handleSelect(next: ConfidenceFeeling) {
    // The chip group fires on every tap, including a re-tap of the chip that
    // is already selected. Nothing has changed in that case, so there is
    // nothing to record.
    if (next === feeling) return;
    setFeeling(next);
    startTransition(async () => {
      try {
        await recordPreGameCheckinAction(next);
      } catch {
        // The routine on screen is still correct and usable, so a failed
        // write is worth a quiet note rather than taking the routine away.
        toast.error("Couldn't save that check-in, but your routine is ready.");
      }
    });
  }

  const routine = feeling ? routineFor(feeling) : undefined;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Before the game</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">How are you feeling?</p>
          <ChipGroup
            options={CONFIDENCE_FEELINGS.map((value) => ({
              value,
              label: FEELING_LABELS[value],
            }))}
            value={feeling ?? ""}
            onChange={(value) =>
              handleSelect(
                (Array.isArray(value) ? value[0] : value) as ConfidenceFeeling,
              )
            }
          />
        </div>

        {routine && (
          <div className="space-y-3 border-t pt-4">
            <p className="text-sm text-muted-foreground">{routine.purpose}</p>

            <div>
              <p className="text-sm font-medium">Do this now</p>
              <ol className="mt-1 list-inside list-decimal space-y-1.5 text-sm text-muted-foreground">
                {routine.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>

            <div className="rounded-md bg-muted px-3 py-2">
              <p className="text-xs font-medium">In-game cue</p>
              <p className="text-sm">{routine.inGameCue}</p>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
