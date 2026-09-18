"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Target, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ChipGroup } from "@/components/ui/chip-group";
import { DateField } from "@/components/ui/date-field";
import { parseDateInputValue, toDateInputValue } from "@/lib/age";

/** Today at UTC midnight - the same day boundary `@/lib/age` uses. */
function startOfToday(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}
import {
  GOAL_TEMPLATES,
  goalCadenceFor,
  goalProgressPercent,
  goalTemplateFor,
  isGoalMet,
  type GoalTypeId,
} from "@/lib/goal-types";
import {
  abandonGoalAction,
  createGoalAction,
  deleteGoalAction,
  reactivateGoalAction,
} from "@/server/actions/goalActions";

export interface GoalView {
  id: string;
  type: string;
  title: string;
  targetValue: number;
  currentValue: number;
  unit: string;
  status: "active" | "completed" | "abandoned";
  targetDate?: string;
}

export function GoalsTab({ goals }: { goals: GoalView[] }) {
  const [isPending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [type, setType] = useState<GoalTypeId>(GOAL_TEMPLATES[0].type);
  const [targetValue, setTargetValue] = useState<number>(
    GOAL_TEMPLATES[0].defaultTarget,
  );
  const [targetDate, setTargetDate] = useState("");

  const template = goalTemplateFor(type) ?? GOAL_TEMPLATES[0];

  // ChipGroup's onChange is typed for both single and multi select; this
  // group is single-select, so only the string branch can occur.
  function handleTypeChange(next: string | string[]) {
    const nextTemplate = goalTemplateFor(Array.isArray(next) ? next[0] : next);
    if (!nextTemplate) return;
    setType(nextTemplate.type);
    setTargetValue(nextTemplate.defaultTarget);
    if (!nextTemplate.supportsTargetDate) setTargetDate("");
  }

  function handleCreate() {
    startTransition(async () => {
      try {
        await createGoalAction({
          type,
          targetValue,
          targetDate: targetDate || undefined,
        });
        toast.success("Goal set. It'll update itself as you train.");
        setAdding(false);
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Couldn't set that goal.",
        );
      }
    });
  }

  function runGoalAction(fn: () => Promise<unknown>, failure: string) {
    startTransition(async () => {
      try {
        await fn();
      } catch {
        toast.error(failure);
      }
    });
  }

  const active = goals.filter((g) => g.status === "active");
  const finished = goals.filter((g) => g.status !== "active");

  return (
    <div className="space-y-3">
      {!adding && (
        <Button className="w-full" onClick={() => setAdding(true)}>
          <Plus className="size-4" />
          Set a goal
        </Button>
      )}

      {adding && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">New goal</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>What do you want to work toward?</Label>
              <ChipGroup
                options={GOAL_TEMPLATES.map((t) => ({
                  value: t.type,
                  label: t.label,
                }))}
                value={type}
                onChange={handleTypeChange}
              />
              <p className="text-xs text-muted-foreground">
                {template.description}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="goal-target">Target ({template.unit})</Label>
              <Input
                id="goal-target"
                type="number"
                min={template.minTarget}
                max={template.maxTarget}
                value={targetValue}
                onChange={(e) => setTargetValue(e.target.valueAsNumber)}
              />
            </div>

            {template.supportsTargetDate && (
              <div className="space-y-1.5">
                <Label htmlFor="goal-date">Target date (optional)</Label>
                {/* Held as the `YYYY-MM-DD` the action already expects; the
                    picker just deals in Dates on the way in and out. */}
                <DateField
                  id="goal-date"
                  value={parseDateInputValue(targetDate)}
                  onChange={(date) =>
                    setTargetDate(date ? toDateInputValue(date) : "")
                  }
                  // A deadline that has already passed isn't a goal.
                  min={startOfToday()}
                />
              </div>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                disabled={isPending}
                onClick={() => setAdding(false)}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                disabled={isPending || !Number.isFinite(targetValue)}
                onClick={handleCreate}
              >
                {isPending ? "Saving..." : "Set goal"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {goals.length === 0 && !adding && (
        <Card>
          <CardContent className="pt-6 text-center">
            <Target className="mx-auto mb-2 size-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No goals yet. Set one and it updates automatically from your real
              workouts and shooting sessions - no checking off by hand.
            </p>
          </CardContent>
        </Card>
      )}

      {active.map((goal) => (
        <GoalCard
          key={goal.id}
          goal={goal}
          disabled={isPending}
          onAbandon={() =>
            runGoalAction(
              () => abandonGoalAction(goal.id),
              "Couldn't update that goal.",
            )
          }
          onDelete={() =>
            runGoalAction(
              () => deleteGoalAction(goal.id),
              "Couldn't delete that goal.",
            )
          }
        />
      ))}

      {finished.length > 0 && (
        <>
          <p className="pt-2 text-xs font-medium text-muted-foreground">
            Completed &amp; archived
          </p>
          {finished.map((goal) => (
            <GoalCard
              key={goal.id}
              goal={goal}
              disabled={isPending}
              onReactivate={
                goal.status === "abandoned"
                  ? () =>
                      runGoalAction(
                        () => reactivateGoalAction(goal.id),
                        "Couldn't reopen that goal.",
                      )
                  : undefined
              }
              onDelete={() =>
                runGoalAction(
                  () => deleteGoalAction(goal.id),
                  "Couldn't delete that goal.",
                )
              }
            />
          ))}
        </>
      )}

      {goals.length > 0 && (
        <p className="pt-1 text-center text-xs text-muted-foreground">
          Goals recalculate from your real activity every time you finish a
          workout or a shooting session.
        </p>
      )}
    </div>
  );
}

function GoalCard({
  goal,
  disabled,
  onAbandon,
  onReactivate,
  onDelete,
}: {
  goal: GoalView;
  disabled: boolean;
  onAbandon?: () => void;
  onReactivate?: () => void;
  onDelete: () => void;
}) {
  const pct = goalProgressPercent(goal.currentValue, goal.targetValue);
  // The catalog is the display authority for units: goals seeded before the
  // templates settled carry raw metric keys ("sessions_per_week") that read
  // as database internals next to a number.
  const unit = goalTemplateFor(goal.type)?.unit ?? goal.unit;
  // A weekly goal is a habit, not a milestone - it reports "met this week"
  // off its current rolling value rather than latching to "completed".
  const isWeekly = goalCadenceFor(goal.type) === "weekly";
  const metThisWeek = isWeekly && isGoalMet(goal.currentValue, goal.targetValue);

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-medium">{goal.title}</p>
            <p className="text-sm text-muted-foreground">
              {goal.currentValue} / {goal.targetValue} {unit}
            </p>
          </div>
          {metThisWeek && <Badge className="shrink-0">Met this week</Badge>}
          {!isWeekly && goal.status === "completed" && (
            <Badge className="shrink-0">Complete</Badge>
          )}
          {goal.status === "abandoned" && (
            <Badge variant="outline" className="shrink-0">
              Archived
            </Badge>
          )}
        </div>

        <Progress value={pct} />

        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            {pct}%
            {isWeekly
              ? " - last 7 days"
              : goal.targetDate
                ? ` - by ${goal.targetDate}`
                : ""}
          </p>
          <div className="flex gap-1">
            {onAbandon && (
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={onAbandon}
              >
                Archive
              </Button>
            )}
            {onReactivate && (
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={onReactivate}
              >
                Reopen
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              disabled={disabled}
              onClick={onDelete}
              aria-label={`Delete goal: ${goal.title}`}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
