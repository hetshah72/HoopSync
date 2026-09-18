import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { SKILL_LABELS } from "@/lib/onboarding-options";
import { relativeDay } from "@/lib/format";
import { rankSkillsByVolume, type SkillMetrics } from "@/lib/skill-metrics";
import type { SkillCategory } from "@/types/db";

/**
 * BRD 7.3's "relevant skill metrics" and 7.11's "skill development", made
 * visible.
 *
 * Shows training *volume* - drills actually completed per skill - and not a
 * synthesized 0-100 skill rating. HoopSync has no way to measure how good a
 * player is at defense; a number implying otherwise would read as measured
 * when it is not. The bars are explicitly relative to the player's own
 * busiest skill, which is a real comparison rather than an invented scale.
 */
export function SkillBreakdown({
  skillMetrics,
}: {
  skillMetrics?: SkillMetrics;
}) {
  const ranked = rankSkillsByVolume(skillMetrics ?? {});
  if (ranked.length === 0) return null;

  const busiest = ranked[0].metric.drillsCompleted;

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div>
          <p className="text-sm font-medium">Where your work has gone</p>
          <p className="text-xs text-muted-foreground">
            Drills you&apos;ve actually completed, by skill.
          </p>
        </div>

        <ul className="space-y-2.5">
          {ranked.map(({ skill, metric }) => (
            <li key={skill} className="space-y-1">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span>{SKILL_LABELS[skill as SkillCategory]}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {metric.drillsCompleted} drill
                  {metric.drillsCompleted === 1 ? "" : "s"}
                  {metric.lastTrainedAt &&
                    ` - ${relativeDay(new Date(metric.lastTrainedAt))}`}
                </span>
              </div>
              <Progress value={(metric.drillsCompleted / busiest) * 100} />
            </li>
          ))}
        </ul>

        <p className="text-xs text-muted-foreground">
          Bars compare your skills to each other, not to any outside standard.
        </p>
      </CardContent>
    </Card>
  );
}
