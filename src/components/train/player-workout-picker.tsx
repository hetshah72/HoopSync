"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Search, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { generateWorkoutAction } from "@/server/actions/workoutActions";
import { searchPlayersForWorkoutAction } from "@/server/actions/nbaPlayerActions";

interface PlayerOption {
  id: string;
  name: string;
  team: string;
  position: string;
}

const SEARCH_DEBOUNCE_MS = 250;

/**
 * "I want to play more like Paul George" (BRD 7.3) from inside Train.
 *
 * Player-modelled generation already existed, but only on a player's own
 * profile page - so the BRD's "select a skill, or a player" choice was never
 * actually offered at the point where a player decides what to train. This
 * reuses the same action and the same engine rather than adding a second path.
 */
export function PlayerWorkoutPicker() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [players, setPlayers] = useState<PlayerOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<PlayerOption | null>(null);
  const [isPending, startTransition] = useTransition();

  const trimmedQuery = query.trim();
  const isSearchable = trimmedQuery.length >= 2;

  useEffect(() => {
    if (!isSearchable) return;

    let cancelled = false;
    // Every state update happens inside the debounce callback rather than in
    // the effect body, so typing doesn't trigger a cascading render per
    // keystroke.
    const timer = setTimeout(async () => {
      if (cancelled) return;
      setSearching(true);
      try {
        const results = await searchPlayersForWorkoutAction(trimmedQuery);
        if (!cancelled) setPlayers(results);
      } catch {
        if (!cancelled) setPlayers([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmedQuery, isSearchable]);

  // Derived rather than stored: a query too short to search has no results by
  // definition, so clearing them in an effect would be redundant state.
  const visiblePlayers = isSearchable ? players : [];

  function handleGenerate() {
    if (!selected) return;
    startTransition(async () => {
      const result = await generateWorkoutAction({
        mode: "player",
        playerId: selected.id,
      });
      if (!result.ok) {
        // Surfaces the real reason - e.g. we don't know enough about this
        // player yet - instead of a generic failure (audit Bug NBA-5).
        toast.error(result.message);
        return;
      }
      router.push(`/train/${result.workoutId}`);
    });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="player-search">Who do you want to train like?</Label>
        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            id="player-search"
            className="pl-9"
            placeholder="Search NBA players"
            value={selected ? selected.name : query}
            onChange={(e) => {
              setSelected(null);
              setQuery(e.target.value);
            }}
          />
        </div>
      </div>

      {!selected && isSearchable && searching && (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}

      {!selected && !searching && isSearchable && visiblePlayers.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No players match “{trimmedQuery}”.
        </p>
      )}

      {!selected && visiblePlayers.length > 0 && (
        <ul className="max-h-56 space-y-1 overflow-y-auto">
          {visiblePlayers.map((player) => (
            <li key={player.id}>
              <button
                type="button"
                onClick={() => setSelected(player)}
                className="w-full rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
              >
                <span className="font-medium">{player.name}</span>
                <span className="block text-xs text-muted-foreground">
                  {player.team} - {player.position}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Button
        className="w-full"
        disabled={!selected || isPending}
        onClick={handleGenerate}
      >
        <Sparkles className="size-4" />
        {isPending
          ? "Generating..."
          : selected
            ? `Model a workout on ${selected.name}`
            : "Pick a player first"}
      </Button>
    </div>
  );
}
