import { getContentStatus } from "@/server/services/adminService";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatTile } from "@/components/ui/stat-tile";
import { RosterSyncButton } from "@/components/admin/roster-sync-button";
import { SKILL_LABELS } from "@/lib/onboarding-options";
import type { SkillCategory } from "@/types/db";

export const metadata = { title: "Admin - content" };

function formatDateTime(date?: Date): string {
  if (!date) return "never";
  return new Date(date).toLocaleString();
}

/** Content management (BRD 6.2): the drill library, the roster, and media rights. */
export default async function AdminContentPage() {
  const { drills, roster, media } = await getContentStatus();

  const placeholderCount =
    media.find((m) => m.source === "placeholder")?.count ?? 0;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Admin"
        title="Content"
        description="The drill library, the NBA roster, and what rights the media sits under."
      />

      <Card>
        <CardContent>
          <h2 className="font-heading text-sm font-semibold tracking-tight">
            Drill library
          </h2>
          {/* Both halves, never just the headline. The ~1,000 figure is only
              meaningful next to how much of it is authored. */}
          <p className="mt-1 text-xs text-muted-foreground">
            {drills.authored.toLocaleString()} hand-authored drills, plus{" "}
            {drills.variants.toLocaleString()} variants generated from them by
            crossing real coaching constraints. Variants carry the drill they
            descend from, so the total is never presented as {drills.total}{" "}
            independently written drills.
          </p>

          <div className="mt-4 grid grid-cols-3 gap-3">
            <StatTile
              value={drills.total.toLocaleString()}
              label="Total drills"
              tone="brand"
            />
            <StatTile value={drills.authored.toLocaleString()} label="Authored" />
            <StatTile value={drills.variants.toLocaleString()} label="Variants" />
          </div>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground">
                By skill
              </h3>
              <ul className="mt-2 space-y-1 text-sm">
                {drills.bySkill.map((row) => (
                  <li key={row.skill} className="flex justify-between gap-3">
                    <span>
                      {SKILL_LABELS[row.skill as SkillCategory] ?? row.skill}
                    </span>
                    <span className="tabular text-muted-foreground">
                      {row.count.toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div>
              <h3 className="text-xs font-semibold text-muted-foreground">
                By difficulty
              </h3>
              <ul className="mt-2 space-y-1 text-sm">
                {drills.byDifficulty.map((row) => (
                  <li key={row.difficulty} className="flex justify-between gap-3">
                    <span className="capitalize">{row.difficulty}</span>
                    <span className="tabular text-muted-foreground">
                      {row.count.toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-heading text-sm font-semibold tracking-tight">
                NBA roster
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Last synced {formatDateTime(roster.lastSyncedAt)}.
              </p>
            </div>
            <RosterSyncButton />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile value={roster.total.toLocaleString()} label="Players" />
            <StatTile
              value={roster.synced.toLocaleString()}
              label="Synced"
              tone="success"
            />
            <StatTile
              value={roster.pendingSync.toLocaleString()}
              label="Pending sync"
            />
            <StatTile
              value={roster.withAuthoredEditorial.toLocaleString()}
              label="With editorial"
            />
          </div>

          {roster.total === 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              Nothing synced yet. The sync needs{" "}
              <code className="rounded bg-muted px-1">BALLDONTLIE_API_KEY</code>
              , and a current-roster pull requires their ALL-STAR tier.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <h2 className="font-heading text-sm font-semibold tracking-tight">
            Media rights
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Every asset&apos;s rights basis (BRD 7.14). Placeholder is the
            backlog standing between the app and real footage.
          </p>

          <ul className="mt-3 flex flex-wrap gap-2">
            {media.length === 0 && (
              <li className="text-sm text-muted-foreground">No media yet.</li>
            )}
            {media.map((row) => (
              <li key={row.source}>
                <Badge variant={row.source === "placeholder" ? "warning" : "outline"}>
                  {row.source}: {row.count.toLocaleString()}
                </Badge>
              </li>
            ))}
          </ul>

          {placeholderCount > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              {placeholderCount.toLocaleString()} placeholder{" "}
              {placeholderCount === 1 ? "asset is" : "assets are"} standing in
              for licensed footage. They stay labelled as placeholders in the
              player-facing UI until a league licence exists (BRD 6.4).
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
