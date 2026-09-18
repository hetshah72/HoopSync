import Link from "next/link";
import { ChevronRight, Search, SearchX, Users } from "lucide-react";
import {
  PLAYERS_PAGE_SIZE,
  listPlayers,
  listTeams,
  playerCount,
} from "@/server/services/nbaPlayerService";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader, SectionHeading } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { PlayerCardImage } from "@/components/players/player-card-image";
import type { PositionGroup } from "@/lib/player-archetypes";

const POSITION_FILTERS: { value: PositionGroup; label: string }[] = [
  { value: "guard", label: "Guards" },
  { value: "wing", label: "Wings" },
  { value: "big", label: "Bigs" },
];

function isPositionGroup(value?: string): value is PositionGroup {
  return POSITION_FILTERS.some((filter) => filter.value === value);
}

/**
 * Browse/search across the full current roster (BRD 7.4). The roster itself
 * comes from the balldontlie sync (`npm run db:sync-roster`), never a
 * hardcoded list - so this page has to work at ~570 players, which means
 * real filters and paging rather than the previous flat limit of 200.
 *
 * Search stays URL-driven through a plain <form>, matching the rest of the
 * app and working without JavaScript.
 */
export default async function PlayersPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    team?: string;
    position?: string;
    show?: string;
  }>;
}) {
  const { q, team, position, show } = await searchParams;

  const positionGroup = isPositionGroup(position) ? position : undefined;
  // `show` accumulates rather than paginating away from what's on screen -
  // a "load more" on a phone shouldn't drop the rows already being read.
  const parsedShow = Number(show);
  const limit =
    Number.isFinite(parsedShow) && parsedShow > 0
      ? Math.min(parsedShow, 600)
      : PLAYERS_PAGE_SIZE;

  const [{ players, total }, totalPlayers, teams] = await Promise.all([
    listPlayers({ search: q, team, positionGroup, limit }),
    playerCount(),
    listTeams(),
  ]);

  const hasFilters = Boolean(q || team || positionGroup);

  function hrefWith(overrides: Record<string, string | undefined>): string {
    const params = new URLSearchParams();
    const merged = { q, team, position, show, ...overrides };
    for (const [key, value] of Object.entries(merged)) {
      if (value) params.set(key, value);
    }
    const query = params.toString();
    return query ? `/players?${query}` : "/players";
  }

  return (
    <div>
      <PageHeader
        eyebrow="Player Mode"
        title="Study the pros"
        description="Pick a player, learn one of their signature moves, and turn it into a workout built for you."
      />

      {/* The filter bar is the first thing on the screen, so it gets a surface
          of its own rather than floating as three loose controls. */}
      {/* The filter bar is the first thing on the screen, so it gets a surface
          of its own rather than floating as three loose controls. It stacks on
          a phone and becomes a single row once there is width for one. */}
      <form className="mb-5 flex flex-col gap-2.5 rounded-2xl border border-border/70 bg-card p-3 shadow-sm sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 gap-2">
          <div className="relative min-w-0 flex-1">
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              name="q"
              defaultValue={q ?? ""}
              placeholder="Search players (e.g. Curry, George)"
              aria-label="Search players"
              className="pl-9"
            />
          </div>
          <Button type="submit" aria-label="Search" size="icon-lg">
            <Search className="size-4" />
          </Button>
        </div>

        <div className="flex min-w-0 flex-wrap gap-2 sm:w-[22rem] sm:shrink-0 sm:flex-nowrap">
          <NativeSelect
            name="position"
            defaultValue={positionGroup ?? ""}
            aria-label="Filter by position"
          >
            <option value="">All positions</option>
            {POSITION_FILTERS.map((filter) => (
              <option key={filter.value} value={filter.value}>
                {filter.label}
              </option>
            ))}
          </NativeSelect>

          <NativeSelect
            name="team"
            defaultValue={team ?? ""}
            aria-label="Filter by team"
          >
            <option value="">All teams</option>
            {teams.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </NativeSelect>
        </div>
      </form>

      {totalPlayers === 0 ? (
        <EmptyState
          icon={Users}
          title="The roster hasn't synced yet"
          description={
            <>
              The full current roster comes from balldontlie.io once someone
              runs <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">npm run db:sync-roster</code>{" "}
              (or POSTs to /api/nba-players/sync as an admin) - it isn&apos;t a
              hardcoded list. A couple of players with hand-authored Learn
              content are seeded for development in the meantime.
            </>
          }
        />
      ) : players.length === 0 ? (
        // Previously this rendered a blank page with no message (audit bug
        // NBA-4) - a search that finds nothing has to say so.
        <EmptyState
          icon={SearchX}
          title="No players match those filters"
          description={
            <>
              Nothing found{q ? ` for "${q}"` : ""}
              {team ? ` on the ${team}` : ""}
              {positionGroup
                ? ` at ${POSITION_FILTERS.find((f) => f.value === positionGroup)?.label.toLowerCase()}`
                : ""}
              . Try a broader search or clear what&apos;s set.
            </>
          }
          action={
            <Link
              href="/players"
              className={buttonVariants({ variant: "outline" })}
            >
              Clear filters
            </Link>
          }
        />
      ) : (
        <>
          <SectionHeading
            title={hasFilters ? "Matching players" : "All players"}
            count={hasFilters ? total : totalPlayers}
            className="mb-3"
            action={
              hasFilters ? (
                <Link
                  href="/players"
                  className={buttonVariants({ variant: "ghost", size: "sm" })}
                >
                  Clear
                </Link>
              ) : undefined
            }
          />

          {/* One divided list on a phone - at ~570 rows, detached cards in a
              narrow column turn the page into visual static. Given real width
              the same markup becomes a two-up card grid, which is the layout
              that actually uses a desktop screen. */}
          <ul className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm md:grid md:grid-cols-2 md:gap-3 md:overflow-visible md:rounded-none md:border-0 md:bg-transparent md:shadow-none">
            {players.map((player) => (
              <li
                key={player._id.toString()}
                className="border-b border-border/60 last:border-b-0 md:overflow-hidden md:rounded-2xl md:border md:border-border/70 md:bg-card md:shadow-sm md:transition-colors md:hover:border-brand/35"
              >
                <Link
                  href={`/players/${player._id}`}
                  className="press flex h-full items-center gap-3.5 px-4 py-3 transition-colors outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset md:py-4"
                >
                  <PlayerCardImage
                    name={player.name}
                    team={player.team}
                    jerseyNumber={player.jerseyNumber}
                    playerImageUrl={player.playerImageUrl}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-heading font-semibold tracking-tight">
                      {player.name}
                    </p>
                    <p className="truncate text-[0.8125rem] text-muted-foreground">
                      {player.position} &middot; {player.team}
                    </p>
                  </div>
                  {player.syncStatus === "pending_sync" && (
                    <Badge variant="warning" className="shrink-0">
                      Pending sync
                    </Badge>
                  )}
                  <ChevronRight
                    aria-hidden
                    className="size-4 shrink-0 text-muted-foreground/60"
                  />
                </Link>
              </li>
            ))}
          </ul>

          {players.length < total && (
            <Link
              href={hrefWith({ show: String(limit + PLAYERS_PAGE_SIZE) })}
              scroll={false}
              className={buttonVariants({
                variant: "outline",
                className: "mt-3 w-full",
              })}
            >
              Show more ({total - players.length} more)
            </Link>
          )}
        </>
      )}
    </div>
  );
}
