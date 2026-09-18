import { ObjectId } from "mongodb";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Target, ThumbsUp } from "lucide-react";
import { getPlayerProfile } from "@/server/services/nbaPlayerService";
import { formatHeight } from "@/lib/format";
import { SKILL_LABELS } from "@/lib/onboarding-options";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { PlayerCardImage } from "@/components/players/player-card-image";
import { SignatureMoveCard } from "@/components/players/signature-move-card";
import { StudyClipPlayer } from "@/components/players/study-clip-player";
import { GeneratePlayerWorkoutButton } from "@/components/players/generate-player-workout-button";
import { AskCoachButton } from "@/components/coach/ask-coach-button";
import { askCoachAboutPlayerAction } from "@/server/actions/nbaPlayerActions";

const SKILL_RATING_LABELS: Record<string, string> = {
  shooting: SKILL_LABELS.shooting,
  finishing: SKILL_LABELS.finishing,
  ballHandling: SKILL_LABELS.ball_handling,
  playmaking: SKILL_LABELS.playmaking,
  defense: SKILL_LABELS.defense,
  athleticism: SKILL_LABELS.athletic_development,
};

function BioRow({ label, value }: { label: string; value?: string | number }) {
  if (value === undefined || value === "" || value === null) return null;
  return (
    <p>
      <span className="font-medium">{label}:</span> {value}
    </p>
  );
}

export default async function PlayerProfilePage({
  params,
}: {
  params: Promise<{ playerId: string }>;
}) {
  const { playerId } = await params;
  if (!/^[0-9a-fA-F]{24}$/.test(playerId)) {
    notFound();
  }

  const profile = await getPlayerProfile(new ObjectId(playerId));
  if (!profile) {
    notFound();
  }

  const { player, editorial } = profile;
  const isArchetype = editorial.provenance === "archetype";

  const draft =
    player.draftYear && player.draftRound && player.draftNumber
      ? `${player.draftYear} - Round ${player.draftRound}, Pick ${player.draftNumber}`
      : player.draftYear
        ? String(player.draftYear)
        : undefined;

  return (
    <div>
      <Link
        href="/players"
        className={buttonVariants({
          variant: "ghost",
          size: "sm",
          className: "-ml-2 mb-3 text-muted-foreground",
        })}
      >
        <ArrowLeft className="size-4" />
        All players
      </Link>

      {/* The identity block is a hero, not a row: it carries the one piece of
          this page that is unambiguously real - the synced roster facts - so
          it gets the ink surface and the largest type on the screen. */}
      <section className="relative mb-4 overflow-hidden rounded-2xl bg-hero px-5 py-6 text-hero-foreground shadow-lg sm:px-7">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-20 -right-12 size-56 rounded-full bg-brand/25 blur-3xl"
        />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-5">
          <PlayerCardImage
            size="lg"
            name={player.name}
            team={player.team}
            jerseyNumber={player.jerseyNumber}
            playerImageUrl={player.playerImageUrl}
            className="ring-2 ring-hero-foreground/15"
          />
          <div className="min-w-0 flex-1">
            <h1 className="font-heading text-2xl leading-tight font-bold tracking-tight text-balance sm:text-3xl">
              {player.name}
            </h1>
            <p className="mt-1 text-sm text-hero-foreground/70">
              {player.position} - {player.team}
              {player.jerseyNumber ? ` - #${player.jerseyNumber}` : ""}
            </p>
            {player.syncStatus === "pending_sync" && (
              <span className="mt-2 inline-flex rounded-full bg-hero-foreground/12 px-2.5 py-1 text-[0.6875rem] font-semibold text-hero-foreground/90 ring-1 ring-hero-foreground/10">
                Pending roster sync
              </span>
            )}
          </div>
        </div>
      </section>

      {/*
        The honesty contract (CLAUDE.md / BRD v1.1 §5): a profile backed by an
        archetype pack describes a *role*, not this individual. Saying so
        plainly is what makes full-roster coverage legitimate rather than
        fabricated scouting. It is tinted and sits above the tabs so it cannot
        be mistaken for one more content card.
      */}
      {isArchetype && editorial.archetype && (
        <Card className="mb-4 border-brand/25 bg-brand-soft/30">
          <CardContent className="space-y-1.5 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="brand">{editorial.archetype.label}</Badge>
              <span className="text-xs font-medium text-muted-foreground">
                Archetype-based coaching content
              </span>
            </div>
            <p className="leading-relaxed text-muted-foreground text-pretty">
              {editorial.archetype.summary}
            </p>
            <p className="text-xs leading-relaxed text-muted-foreground italic text-pretty">
              The Learn, Skills and Signature Move content below describes how
              this <em>type</em> of player scores and defends - it is HoopSync
              coaching material matched to {player.name}&apos;s listed position
              and size, not film study of them specifically, and not NBA
              statistics. Their name, team, position, jersey number and bio
              facts are real and synced.
            </p>
          </CardContent>
        </Card>
      )}

      <Tabs defaultValue="learn">
        <TabsList className="w-full sm:w-auto sm:min-w-80">
          <TabsTrigger value="learn">Learn</TabsTrigger>
          <TabsTrigger value="skills">Skills</TabsTrigger>
          <TabsTrigger value="bio">Bio</TabsTrigger>
        </TabsList>

        {/* On a desktop the write-up and the film sit side by side - you read
            the cue and watch for it without scrolling between the two. The
            signature moves then run full width underneath, since each is a
            long card in its own right. */}
        <TabsContent value="learn" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
            <Card>
              <CardHeader>
                <CardTitle>What they do well</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5 text-sm leading-relaxed text-muted-foreground">
                <p className="text-pretty">{editorial.learn.whatTheyDoWell}</p>
                <p className="text-pretty">
                  <span className="font-semibold text-foreground">
                    How they play:
                  </span>{" "}
                  {editorial.learn.howTheyPlay}
                </p>
                <p className="text-pretty">
                  <span className="font-semibold text-foreground">
                    What to watch for:
                  </span>{" "}
                  {editorial.learn.whatToWatchFor}
                </p>
              </CardContent>
            </Card>

            {editorial.studyClip && (
              <StudyClipPlayer
                callouts={editorial.studyClip.callouts}
                media={editorial.studyClip.media}
              />
            )}
          </div>

          {editorial.signatureMoves.map((move) => (
            <SignatureMoveCard
              key={move.id}
              playerId={player._id.toString()}
              move={{
                id: move.id,
                name: move.name,
                whatItIs: move.whatItIs,
                whenUsed: move.whenUsed,
                whatMakesItEffective: move.whatMakesItEffective,
                keyMechanics: move.keyMechanics,
                commonMistakes: move.commonMistakes,
                drill: {
                  name: move.drill.name,
                  description: move.drill.description,
                  equipmentNeeded: move.drill.equipmentNeeded,
                },
              }}
            />
          ))}
        </TabsContent>

        <TabsContent value="skills" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
            <Card>
              <CardHeader>
                <CardTitle>Skill emphasis</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {Object.entries(editorial.skills).map(([key, value]) => (
                  <div key={key} className="space-y-1.5">
                    <div className="flex justify-between text-sm">
                      <span className="font-medium">
                        {SKILL_RATING_LABELS[key] ?? key}
                      </span>
                      <span className="tabular text-muted-foreground">
                        {value}
                      </span>
                    </div>
                    <Progress value={value} />
                  </div>
                ))}
                <p className="border-t border-border/60 pt-3 text-xs leading-relaxed text-muted-foreground italic text-pretty">
                  {isArchetype
                    ? "Skill emphasis typical of this player type - a coaching profile, not this player's statistics."
                    : "HoopSync editorial scouting profile - written by our coaching staff, not official NBA statistics."}
                </p>
              </CardContent>
            </Card>

            <div className="space-y-4">
              {editorial.strengths.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="inline-flex size-7 items-center justify-center rounded-lg bg-success-soft text-success-soft-foreground"
                      >
                        <ThumbsUp className="size-3.5" />
                      </span>
                      Strengths
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2 text-sm">
                      {editorial.strengths.map((s) => (
                        <li key={s} className="flex gap-2.5">
                          <span
                            aria-hidden
                            className="mt-1.5 size-1.5 shrink-0 rounded-full bg-success"
                          />
                          <span className="text-pretty">{s}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {editorial.weaknesses.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className="inline-flex size-7 items-center justify-center rounded-lg bg-brand-soft text-brand-soft-foreground"
                      >
                        <Target className="size-3.5" />
                      </span>
                      Weaknesses
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2 text-sm">
                      {editorial.weaknesses.map((w) => (
                        <li key={w} className="flex gap-2.5">
                          <span
                            aria-hidden
                            className="mt-1.5 size-1.5 shrink-0 rounded-full bg-brand"
                          />
                          <span className="text-pretty">{w}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>

          {/* Train it, or talk it through (BRD 7.9: Coach must be able to
              discuss player-study content). The Coach hand-off carries this
              profile's provenance with it, so an archetype-backed profile is
              discussed as a role rather than as film study of this person. */}
          <div className="flex flex-wrap items-center gap-2">
            <GeneratePlayerWorkoutButton
              playerId={player._id.toString()}
              playerName={player.name}
            />
            <AskCoachButton
              action={askCoachAboutPlayerAction}
              targetId={player._id.toString()}
              label="Ask Coach"
            />
          </div>
        </TabsContent>

        <TabsContent value="bio">
          <Card className="lg:max-w-xl">
            <CardContent className="space-y-2 text-sm">
              <BioRow label="Position" value={player.position} />
              <BioRow label="Team" value={player.team} />
              <BioRow
                label="Jersey"
                value={player.jerseyNumber ? `#${player.jerseyNumber}` : undefined}
              />
              <BioRow label="Height" value={formatHeight(player.heightInches)} />
              <BioRow
                label="Weight"
                value={player.weightPounds ? `${player.weightPounds} lbs` : undefined}
              />
              <BioRow label="College" value={player.college} />
              <BioRow label="Country" value={player.country} />
              <BioRow label="Draft" value={draft} />
              {editorial.bio.careerInfo && (
                <p className="pt-1 text-muted-foreground">
                  {editorial.bio.careerInfo}
                </p>
              )}
              {player.lastSyncedAt && (
                <p className="border-t pt-2 text-xs text-muted-foreground">
                  Roster data synced from balldontlie.io on{" "}
                  {player.lastSyncedAt.toLocaleDateString()}.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
