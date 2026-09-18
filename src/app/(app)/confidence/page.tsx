import { ObjectId } from "mongodb";
import { auth } from "@/server/auth/auth";
import {
  getLatestPreGameCheckin,
  getLatestRecoveryCheckin,
} from "@/server/services/confidenceService";
import { toDayStamp, todayStamp } from "@/lib/day-stamp";
import { PageHeader } from "@/components/layout/page-header";
import { PreGameCheckin } from "@/components/confidence/pre-game-checkin";
import { RecoveryPlanCard } from "@/components/confidence/recovery-plan-card";
import { AskCoachButton } from "@/components/coach/ask-coach-button";
import { talkToCoachAboutCheckinAction } from "@/server/actions/confidenceActions";
import type { ConfidenceFeeling } from "@/types/db";

/**
 * Confidence / Mental Game (BRD 7.10), reached from Home rather than the
 * bottom nav - that is fixed at six tabs by BRD v1.1 §4.
 */
export default async function ConfidencePage() {
  const session = await auth();
  const userId = session?.user?.id ? new ObjectId(session.user.id) : null;

  const [latestPreGame, latestRecovery] = userId
    ? await Promise.all([
        getLatestPreGameCheckin(userId),
        getLatestRecoveryCheckin(userId),
      ])
    : [null, null];

  // A pre-game feeling is only useful on the day it was given - reopening
  // this a week later shouldn't preselect how you felt before the last game.
  // Same day-stamp helper the write path uses, so both agree on what a day is.
  const isFromToday =
    latestPreGame && toDayStamp(latestPreGame.createdAt) === todayStamp();

  return (
    <div>
      <PageHeader
        back={{ href: "/home", label: "Back to Home" }}
        eyebrow="Mental game"
        title="Confidence"
        description="Routines for before a game, and a plan built from your own numbers for after a rough one."
      />

      <div className="space-y-4">
        <PreGameCheckin
          initialFeeling={
            isFromToday
              ? (latestPreGame.feeling as ConfidenceFeeling)
              : undefined
          }
        />

        <RecoveryPlanCard
          plan={
            latestRecovery?.recoveryPlan
              ? {
                  id: latestRecovery._id.toString(),
                  positives: latestRecovery.recoveryPlan.positives,
                  areasToImprove: latestRecovery.recoveryPlan.areasToImprove,
                  planSteps: latestRecovery.recoveryPlan.planSteps,
                  isDataBacked: latestRecovery.recoveryPlan.isDataBacked,
                  relatedSessionId: latestRecovery.relatedSessionId?.toString(),
                  relatedWorkoutId: latestRecovery.relatedWorkoutId?.toString(),
                  createdAt: latestRecovery.createdAt.toDateString(),
                }
              : undefined
          }
        />

        {/*
          BRD 7.9 lists confidence/mental-game support as a Coach requirement
          and points at 7.10 for it, but the two were built with no link in
          either direction - a player could say they were nervous, read the
          routine, open Coach, and find it knew nothing about any of it. This
          carries the check-in across, so Coach picks the thread up mid-thought.

          Scoped to today's pre-game feeling. The recovery plan has its own
          hand-off inside its card: one shared button had to choose between
          them, which meant checking in before a game silently took the plan's
          route to Coach away.
        */}
        {isFromToday && (
          <div className="flex justify-center pt-1">
            <AskCoachButton
              action={talkToCoachAboutCheckinAction}
              targetId={latestPreGame._id.toString()}
              label="Talk to Coach about this"
            />
          </div>
        )}
      </div>
    </div>
  );
}
