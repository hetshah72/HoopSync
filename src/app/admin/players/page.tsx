import { listPlayers } from "@/server/services/adminService";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/layout/empty-state";
import { Users } from "lucide-react";
import { RoleControl } from "@/components/admin/role-control";

export const metadata = { title: "Admin - players" };

function formatDate(date?: Date): string {
  if (!date) return "-";
  return new Date(date).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/**
 * Player and user management (BRD 6.2).
 *
 * The columns are deliberately operational - who they are, whether they
 * finished onboarding, whether they are actually training, what role they
 * hold. The profile behind each of these rows also carries date of birth,
 * height and weight for a userbase that is mostly minors, and none of that is
 * shown: this is a screen for running the product, not for reading children's
 * personal details. Anyone who genuinely needs those fields should be going
 * through a deliberate, logged path rather than a list view.
 */
export default async function AdminPlayersPage() {
  const players = await listPlayers();

  return (
    <div>
      <PageHeader
        eyebrow="Admin"
        title="Players"
        description={`${players.length} most recent accounts.`}
      />

      {players.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No accounts yet"
          description="Sign-ups will appear here as they happen."
        />
      ) : (
        <Card>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="border-b border-border/70 text-left">
                  <th className="pb-2 font-medium text-muted-foreground">
                    Player
                  </th>
                  <th className="pb-2 font-medium text-muted-foreground">
                    Onboarded
                  </th>
                  <th className="pb-2 text-right font-medium text-muted-foreground">
                    Workouts
                  </th>
                  <th className="pb-2 text-right font-medium text-muted-foreground">
                    Streak
                  </th>
                  <th className="pb-2 font-medium text-muted-foreground">
                    Last active
                  </th>
                  <th className="pb-2 font-medium text-muted-foreground">
                    Role
                  </th>
                </tr>
              </thead>
              <tbody>
                {players.map((player) => (
                  <tr
                    key={player.id}
                    className="border-b border-border/40 last:border-0"
                  >
                    <td className="py-2.5 pr-3">
                      <span className="block font-medium">
                        {player.displayName ?? player.name ?? "Unnamed"}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {player.email}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-muted-foreground">
                      {player.onboardingCompletedAt
                        ? formatDate(player.onboardingCompletedAt)
                        : "Not finished"}
                    </td>
                    <td className="tabular py-2.5 pr-3 text-right">
                      {player.totalWorkoutsCompleted ?? 0}
                    </td>
                    <td className="tabular py-2.5 pr-3 text-right">
                      {player.currentStreak ?? 0}
                    </td>
                    <td className="py-2.5 pr-3 text-muted-foreground">
                      {formatDate(player.lastActivityDate)}
                    </td>
                    <td className="py-2.5">
                      <RoleControl
                        userId={player.id}
                        role={player.role}
                        label={player.displayName ?? player.email}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <p className="mt-3 text-xs text-muted-foreground">
        A role change is written immediately but takes effect at that
        person&apos;s <strong>next sign-in</strong> - sessions are JWTs and the
        role is stamped into the token when it is issued. The{" "}
        <code className="rounded bg-muted px-1">ADMIN_EMAILS</code> environment
        list also overrides this field, so demoting an address that appears
        there will not hold.
      </p>
    </div>
  );
}
