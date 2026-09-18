"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { ChipGroup } from "@/components/ui/chip-group";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PlayerWorkoutPicker } from "@/components/train/player-workout-picker";
import { SKILL_LABELS } from "@/lib/onboarding-options";
import { SKILL_CATEGORIES, type OnboardingInput } from "@/lib/validation/onboarding";
import { generateWorkoutAction } from "@/server/actions/workoutActions";
import type { SkillCategory } from "@/types/db";

/**
 * BRD 7.3's two entry points: "Select a skill, or a player to model a workout
 * after." Both run the same deterministic engine - the player tab resolves the
 * player's real tendencies into target skills and hands them to it - so there
 * is one generation path, not two.
 */
export function GenerateWorkoutForm({
  suggestedSkills,
  drillsPerSkill,
}: {
  suggestedSkills: OnboardingInput["focusAreas"];
  /**
   * How many drills this player could actually be given per skill. Lets a
   * skill with no usable drills be marked *before* the tap rather than
   * failing after it (BRD v1.1 §8, no dead buttons).
   */
  drillsPerSkill?: Partial<Record<SkillCategory, number>>;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(suggestedSkills);
  const [isPending, startTransition] = useTransition();

  function handleGenerate() {
    if (selected.length === 0) {
      toast.error("Pick at least one skill to focus on.");
      return;
    }
    startTransition(async () => {
      const result = await generateWorkoutAction({
        mode: "skill",
        targetSkills: selected,
      });
      if (!result.ok) {
        // The server's message is the actionable one ("add a hoop in your
        // profile"), so it is shown rather than replaced with a generic line.
        toast.error(result.message);
        return;
      }
      router.push(`/train/${result.workoutId}`);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">What do you want to work on?</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="skill" className="gap-4">
          <TabsList className="w-full">
            <TabsTrigger value="skill">By skill</TabsTrigger>
            <TabsTrigger value="player">Model a player</TabsTrigger>
          </TabsList>

          <TabsContent value="skill" className="space-y-4">
            <ChipGroup
              multiple
              options={SKILL_CATEGORIES.map((skill) => {
                const count = drillsPerSkill?.[skill];
                return {
                  value: skill,
                  label: SKILL_LABELS[skill],
                  description:
                    count === 0
                      ? "No drills yet for your equipment"
                      : undefined,
                };
              })}
              value={selected}
              onChange={(value) =>
                setSelected(Array.isArray(value) ? value : [value])
              }
            />
            <Button
              className="w-full"
              disabled={isPending}
              onClick={handleGenerate}
            >
              <Sparkles className="size-4" />
              {isPending ? "Generating..." : "Generate Workout"}
            </Button>
          </TabsContent>

          <TabsContent value="player">
            <PlayerWorkoutPicker />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
