import { CheckCircle2, Flame, Layers, Target, Trophy } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  ACHIEVEMENT_FAMILY_LABELS,
  type AchievementFamily,
  type AchievementProgress,
} from "@/lib/achievements";
import type {
  AchievementState,
  UnlockedAchievement,
} from "@/server/services/achievementService";

/**
 * Achievements and XP (BRD 7.13), rendered under Progress.
 *
 * Server Components, like skill-breakdown.tsx: nothing here is interactive, so
 * none of it needs to ship as client JavaScript.
 *
 * The founder's one stated requirement for this feature is that it "never
 * becomes more prominent than the app's actual development/coaching value", and
 * that constraint drives the visual decisions rather than being bolted on:
 * - `TrainingTierSummary` is a single quiet row, deliberately *not* a fourth
 *   StatTile, so the three measured stats keep the largest type on the screen.
 * - No `text-ember` and no icon tiles on the tier bar. globals.css warns the
 *   ember accent "marks state ... it is never wallpaper".
 * - Locked rows show real progress ("18 of 25 drills") rather than a padlock, so
 *   the screen gives direction instead of dopamine.
 * - No animation on mount. `--animate-pop` is reserved for the moment something
 *   actually happens, which is the toast, not this list.
 */

const FAMILY_ICONS: Record<AchievementFamily, LucideIcon> = {
  volume: CheckCircle2,
  streak: Flame,
  skill: Layers,
  milestone: Target,
};

const FAMILY_ORDER: AchievementFamily[] = [
  "volume",
  "streak",
  "skill",
  "milestone",
];

function formatEarnedAt(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * The Progress Overview line.
 *
 * One row, muted, below the three real stat tiles. It names the tier, the XP and
 * how many milestones are earned - and nothing else, because everything worth
 * exploring is one tap away on the Achievements tab.
 */
export function TrainingTierSummary({ state }: { state: AchievementState }) {
  const { tier, xp, unlockedCount, totalCount } = state;

  return (
    <div className="rounded-2xl border border-border/70 bg-card px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium">{tier.tier.label}</p>
        <p className="shrink-0 text-xs text-muted-foreground tabular">
          {xp.toLocaleString("en-US")} XP &middot; {unlockedCount} of {totalCount}{" "}
          milestones
        </p>
      </div>
      <Progress value={tier.percent} className="mt-2.5" />
      <p className="mt-2 text-xs text-muted-foreground">
        {tier.nextTier
          ? `${tier.xpToNextTier.toLocaleString("en-US")} XP to ${tier.nextTier.label}.`
          : "Top tier - earned by training, not by opening the app."}
      </p>
    </div>
  );
}

function UnlockedRow({ entry }: { entry: UnlockedAchievement }) {
  return (
    <li className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-sm font-medium">{entry.definition.label}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {entry.definition.description}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <Badge variant="success">Earned</Badge>
        {/* A date only when we actually know it. A backfilled stamp records
            when we first noticed, not when the work was done, so showing it
            would date the milestone wrongly. */}
        {entry.earnedAt && (
          <span className="text-[0.6875rem] text-muted-foreground tabular">
            {formatEarnedAt(entry.earnedAt)}
          </span>
        )}
      </div>
    </li>
  );
}

function LockedRow({ entry }: { entry: AchievementProgress }) {
  return (
    <li className="space-y-1.5 py-2.5 first:pt-0 last:pb-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">
            {entry.definition.label}
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {entry.definition.description}
          </p>
        </div>
        <span className="shrink-0 text-xs text-muted-foreground tabular">
          {entry.current} / {entry.target}
        </span>
      </div>
      <Progress value={entry.percent} />
    </li>
  );
}

function FamilySection({
  family,
  unlocked,
  locked,
}: {
  family: AchievementFamily;
  unlocked: UnlockedAchievement[];
  locked: AchievementProgress[];
}) {
  if (unlocked.length === 0 && locked.length === 0) return null;
  const Icon = FAMILY_ICONS[family];

  return (
    <Card>
      <CardContent className="space-y-3 pt-6">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"
          >
            <Icon className="size-4" />
          </span>
          <div>
            <p className="text-sm font-medium">
              {ACHIEVEMENT_FAMILY_LABELS[family]}
            </p>
            <p className="text-xs text-muted-foreground">
              {unlocked.length} of {unlocked.length + locked.length} earned
            </p>
          </div>
        </div>

        <ul className="divide-y divide-border/60">
          {unlocked.map((entry) => (
            <UnlockedRow key={entry.key} entry={entry} />
          ))}
          {locked.map((entry) => (
            <LockedRow key={entry.key} entry={entry} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

export function AchievementsTab({ state }: { state: AchievementState }) {
  const { tier, xp, unlockedCount, totalCount, next } = state;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 pt-6">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <p className="font-heading text-lg font-semibold tracking-tight">
                {tier.tier.label}
              </p>
              <p className="text-xs text-muted-foreground">
                {xp.toLocaleString("en-US")} training XP from work you&apos;ve
                logged
              </p>
            </div>
            <Badge variant="outline">
              {unlockedCount} / {totalCount}
            </Badge>
          </div>

          <Progress value={tier.percent} />

          <p className="text-xs text-muted-foreground">
            {tier.nextTier
              ? `${tier.xpToNextTier.toLocaleString("en-US")} XP to ${tier.nextTier.label}.`
              : "You're at the top tier. There is no further ladder here on purpose."}
            {next &&
              ` Closest milestone: ${next.definition.label} (${next.current} of ${next.target}).`}
          </p>
        </CardContent>
      </Card>

      {FAMILY_ORDER.map((family) => (
        <FamilySection
          key={family}
          family={family}
          unlocked={state.unlocked.filter((e) => e.definition.family === family)}
          locked={state.locked.filter((e) => e.definition.family === family)}
        />
      ))}

      {/* The same disclaimer skill-breakdown.tsx carries, for the same reason:
          nothing here is a measurement of ability. */}
      <p className="text-center text-xs text-muted-foreground">
        Every milestone here comes from work you actually logged. Skill
        milestones count reps put in, not how good you are at a skill.
      </p>
    </div>
  );
}

/** Icon for the tab's own empty state, re-exported so the page needn't guess. */
export const ACHIEVEMENTS_EMPTY_ICON = Trophy;
