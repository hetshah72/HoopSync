import { ObjectId } from "mongodb";
import { CheckCircle2, Flame, TrendingUp, Trophy } from "lucide-react";
import { auth } from "@/server/auth/auth";
import { getProgressOverview } from "@/server/services/progressService";
import { listGoalsForUser } from "@/server/services/goalService";
import { getAchievementStateForUser } from "@/server/services/achievementService";
import { listCheckinsForUser } from "@/server/services/confidenceService";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { StatTile } from "@/components/ui/stat-tile";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { GoalsTab } from "@/components/progress/goals-tab";
import { SkillBreakdown } from "@/components/progress/skill-breakdown";
import { MentalGameHistory } from "@/components/progress/mental-game-history";
import { ShootingStats } from "@/components/progress/shooting-stats";
import { StrengthsAndWeaknesses } from "@/components/progress/strengths-and-weaknesses";
import { ActivityHistory } from "@/components/progress/activity-history";
import {
  AchievementsTab,
  TrainingTierSummary,
} from "@/components/progress/achievements-tab";

export default async function ProgressPage() {
  const session = await auth();
  const userId = session?.user?.id ? new ObjectId(session.user.id) : null;

  const [overview, goals, achievements, checkins] = userId
    ? await Promise.all([
        getProgressOverview(userId),
        listGoalsForUser(userId),
        getAchievementStateForUser(userId),
        listCheckinsForUser(userId),
      ])
    : [null, [], null, []];

  const stats = overview?.stats ?? null;

  return (
    <div>
      <PageHeader
        eyebrow="Progress"
        title="What you've actually done"
        description="Goals live here too, rather than taking a seventh slot in the nav."
      />

      <Tabs defaultValue="overview" className="gap-4">
        <TabsList className="w-full sm:w-auto sm:min-w-72">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="goals">Goals</TabsTrigger>
          <TabsTrigger value="achievements">Achievements</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          {stats && overview ? (
            <>
              <div className="grid grid-cols-3 gap-3">
                <StatTile
                  value={stats.totalWorkoutsCompleted}
                  label="Workouts completed"
                  icon={CheckCircle2}
                  tone="success"
                />
                <StatTile
                  value={stats.currentStreak}
                  label="Current streak"
                  icon={Flame}
                  tone="brand"
                />
                <StatTile
                  value={stats.longestStreak}
                  label="Longest streak"
                  icon={Trophy}
                />
              </div>

              {/* One quiet row, not a fourth StatTile: the measured stats above
                  must stay the most prominent thing on Progress (BRD 7.13's
                  founder guidance). Everything else lives on the tab. */}
              {achievements && <TrainingTierSummary state={achievements} />}

              <ShootingStats
                totalShotSessions={stats.totalShotSessions}
                totalShotAttempts={stats.totalShotAttempts ?? 0}
                totalShotMakes={stats.totalShotMakes ?? 0}
                lifetimeFgPercent={overview.lifetimeFgPercent}
                pooledZones={overview.pooledZones}
                sessionsInSample={overview.sessionsInSample}
              />

              <StrengthsAndWeaknesses
                strength={overview.strength}
                weakness={overview.weakness}
                sessionsInSample={overview.sessionsInSample}
                totalAttemptsInSample={overview.totalAttemptsInSample}
                workoutsThisWeek={overview.workoutsThisWeek}
                workoutsLastWeek={overview.workoutsLastWeek}
                leastTrainedFocus={overview.leastTrainedFocus}
              />

              {/* Two columns once there is width: the skill breakdown is a
                  chart-shaped block and the history is a short column, so
                  side by side they fill a desktop screen instead of leaving a
                  half-empty page under the cards above. */}
              <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
                <SkillBreakdown skillMetrics={stats.skillMetrics} />
                <ActivityHistory entries={overview.history} />
              </div>

              {/* BRD 7.10. Renders nothing until there is a check-in, so an
                  account that has never used Confidence sees no empty shell. */}
              <MentalGameHistory
                entries={checkins.slice(0, 5).map((checkin) => ({
                  id: checkin._id.toString(),
                  type: checkin.type,
                  feeling: checkin.feeling,
                  date: checkin.createdAt.toDateString(),
                }))}
              />

              <p className="text-center text-xs text-muted-foreground">
                Every number here is real, driven by workouts and sessions
                you&apos;ve actually completed.
              </p>
            </>
          ) : (
            <EmptyState
              icon={TrendingUp}
              title="Nothing logged yet"
              description="Complete a workout in Train to see your stats appear here - all driven by real activity, never static."
            />
          )}
        </TabsContent>

        <TabsContent value="goals">
          <GoalsTab
            goals={goals.map((goal) => ({
              id: goal._id.toString(),
              type: goal.type,
              title: goal.title,
              targetValue: goal.targetValue,
              currentValue: goal.currentValue,
              unit: goal.unit,
              status: goal.status,
              targetDate: goal.targetDate
                ? goal.targetDate.toISOString().slice(0, 10)
                : undefined,
            }))}
          />
        </TabsContent>

        <TabsContent value="achievements">
          {achievements ? (
            <AchievementsTab state={achievements} />
          ) : (
            <EmptyState
              icon={Trophy}
              title="No milestones yet"
              description="Milestones come from real training - complete a workout or log a shooting session and they start filling in, including credit for anything you've already done."
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
