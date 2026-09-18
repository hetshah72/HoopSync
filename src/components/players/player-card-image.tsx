import Image from "next/image";
import { cn } from "@/lib/utils";
import { initials } from "@/lib/format";

/**
 * Player imagery, per BRD 7.4:
 *
 *   "the MVP/prototype may use visually representative player cards;
 *    production must use properly licensed player imagery (or a licensed
 *    image/data provider) and must not be built around scraped images -
 *    images should be swappable via a field such as playerImageUrl"
 *
 * So: when `playerImageUrl` is set (a licensed provider, later), render it.
 * Otherwise generate a deterministic card from the player's own name, team
 * and jersey number. Nothing is scraped, nothing 404s, and swapping in a
 * licensed provider is a matter of populating one field during the roster
 * sync - no component changes.
 *
 * Remote URLs need a matching entry in next.config.ts's
 * `images.remotePatterns` or next/image will 400 them.
 */
const GRADIENTS = [
  "from-orange-500/25 to-amber-500/10",
  "from-sky-500/25 to-indigo-500/10",
  "from-emerald-500/25 to-teal-500/10",
  "from-rose-500/25 to-pink-500/10",
  "from-violet-500/25 to-purple-500/10",
  "from-amber-500/25 to-yellow-500/10",
  "from-cyan-500/25 to-blue-500/10",
  "from-lime-500/25 to-green-500/10",
] as const;

/**
 * Stable across renders and servers - the same player always gets the same
 * card, so it reads as identity rather than noise. Team is part of the key
 * so a traded player's card changes with their jersey, which is the point.
 */
function gradientFor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length];
}

export function PlayerCardImage({
  name,
  team,
  jerseyNumber,
  playerImageUrl,
  className,
  size = "sm",
}: {
  name: string;
  team: string;
  jerseyNumber?: string;
  playerImageUrl?: string;
  className?: string;
  size?: "sm" | "lg";
}) {
  const dimension = size === "lg" ? 96 : 48;

  if (playerImageUrl) {
    return (
      <Image
        src={playerImageUrl}
        alt={name}
        width={dimension}
        height={dimension}
        className={cn(
          "shrink-0 rounded-full object-cover",
          size === "lg" ? "size-24" : "size-12",
          className,
        )}
      />
    );
  }

  return (
    <div
      // Decorative: the player's name is always rendered as real text next
      // to this, so a screen reader announcing the initials again is noise.
      aria-hidden="true"
      className={cn(
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-full border bg-gradient-to-br",
        gradientFor(`${name}|${team}`),
        size === "lg" ? "size-24" : "size-12",
        className,
      )}
    >
      <span
        className={cn(
          "font-semibold tracking-tight text-foreground/70",
          size === "lg" ? "text-2xl" : "text-sm",
        )}
      >
        {initials(name)}
      </span>
      {jerseyNumber && (
        <span
          className={cn(
            "absolute right-0 bottom-0 rounded-full bg-background/90 px-1 font-mono leading-tight text-muted-foreground tabular-nums",
            size === "lg" ? "text-xs" : "text-[10px]",
          )}
        >
          {jerseyNumber}
        </span>
      )}
    </div>
  );
}
