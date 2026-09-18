import { SHOT_ZONES, type ShotZone } from "@/types/db";

export { SHOT_ZONES };
export type { ShotZone };

/** The five three-point zones of the fixed 9-zone taxonomy (BRD v1.1 §6.4). */
export const THREE_POINT_ZONES = [
  "top_of_key_3",
  "right_wing_3",
  "right_corner_3",
  "left_wing_3",
  "left_corner_3",
] as const satisfies readonly ShotZone[];

export const ZONE_LABELS: Record<ShotZone, string> = {
  top_of_key_3: "Top of Key 3",
  right_wing_3: "Right Wing 3",
  right_mid: "Right Mid",
  right_corner_3: "Right Corner 3",
  left_wing_3: "Left Wing 3",
  left_mid: "Left Mid",
  free_throw_mid: "Free-Throw Mid",
  paint: "Paint",
  left_corner_3: "Left Corner 3",
};

/**
 * The player taps an exact point on the court diagram (not just a zone
 * button) - this derives the zone from that point, so `location` is a real,
 * primary data point and `zone` isn't a separate, looser input. Coordinates
 * are percentages (0-100) of the court diagram's width/height, with (0,0)
 * at the top-left and the hoop at the top-center - matching
 * CourtDiagram's viewBox.
 *
 * These bands are a reasonable visual approximation, not regulation court
 * geometry - good enough for classifying a tap into one of the 9 zones.
 */
export function zoneFromLocation(xPct: number, yPct: number): ShotZone {
  const x = Math.min(100, Math.max(0, xPct));
  const y = Math.min(100, Math.max(0, yPct));

  if (y < 35) {
    if (x >= 35 && x <= 65) return "paint";
    if (x < 20) return "left_corner_3";
    if (x > 80) return "right_corner_3";
    if (x < 35) return "left_mid";
    return "right_mid";
  }

  if (y < 55) {
    if (x >= 30 && x <= 70) return "free_throw_mid";
    if (x < 30) return "left_wing_3";
    return "right_wing_3";
  }

  if (x >= 25 && x <= 75) return "top_of_key_3";
  return x < 25 ? "left_wing_3" : "right_wing_3";
}

export function fgPercent(makes: number, attempts: number): number {
  if (attempts === 0) return 0;
  return Math.round((makes / attempts) * 1000) / 10;
}

export type ZoneBreakdown = Partial<Record<ShotZone, { attempts: number; makes: number }>>;

export function computeZoneBreakdown(
  shots: { zone: ShotZone; made: boolean }[],
): ZoneBreakdown {
  const breakdown: ZoneBreakdown = {};
  for (const shot of shots) {
    const entry = breakdown[shot.zone] ?? { attempts: 0, makes: 0 };
    entry.attempts += 1;
    if (shot.made) entry.makes += 1;
    breakdown[shot.zone] = entry;
  }
  return breakdown;
}

/**
 * How many attempts a zone needs before its FG% is treated as a real signal.
 *
 * Without a floor, one lucky 1-for-1 zone outranks a 9-for-10 zone as the
 * session's STRENGTH, and a single 0-for-1 zone becomes the WEAKNESS that
 * drives the mechanical breakdown *and* the recommended workout. BRD 7.5's
 * success criterion is that the analysis "correctly identifies" these, so the
 * sample size has to matter.
 */
export const MIN_ZONE_ATTEMPTS_FOR_CALLOUT = 3;

/**
 * Best/weakest by FG%, preferring zones with a meaningful sample.
 *
 * Tiered rather than a hard cutoff: a short session would otherwise get no
 * call-outs at all, and "log more shots" is a worse answer than "here's the
 * read, with the sample size shown". So it tries `minAttempts` first and
 * relaxes only as far as it must to find two comparable zones. Callers can
 * check the winning zone's own `attempts` to decide how confidently to
 * present the result.
 */
export function findBestAndWeakestZones(
  breakdown: ZoneBreakdown,
  minAttempts = MIN_ZONE_ATTEMPTS_FOR_CALLOUT,
): { bestZone?: ShotZone; weakestZone?: ShotZone } {
  const all = (Object.entries(breakdown) as [ShotZone, { attempts: number; makes: number }][])
    .filter(([, stats]) => stats.attempts > 0)
    .map(([zone, stats]) => ({
      zone,
      attempts: stats.attempts,
      pct: fgPercent(stats.makes, stats.attempts),
    }));

  if (all.length === 0) return {};

  // Step the threshold down until two zones qualify (or we run out of room).
  let entries = all.filter((e) => e.attempts >= minAttempts);
  for (let threshold = minAttempts - 1; entries.length < 2 && threshold >= 1; threshold--) {
    entries = all.filter((e) => e.attempts >= threshold);
  }
  if (entries.length === 0) entries = all;

  // Ties on percentage break toward the bigger sample at both ends: the
  // better-evidenced zone is the more useful thing to name, and sorting on a
  // second key makes the result independent of object key order.
  const sorted = [...entries].sort((a, b) => b.pct - a.pct || b.attempts - a.attempts);

  // With only one zone logged there is no comparative strength to claim.
  // Returning the same zone as both would render it under STRENGTH *and*
  // NEEDS WORK, and would make the mechanical narrative compare the zone
  // against itself. The single zone is still the one to work on.
  if (sorted.length === 1) return { weakestZone: sorted[0].zone };

  return { bestZone: sorted[0].zone, weakestZone: sorted[sorted.length - 1].zone };
}

/*
 * Standing claims about a player - "this zone is your weakness" as a fact
 * about them, rather than about one session - are made in two places now:
 * the Feed's callout cards and the Progress page. They must agree, so the
 * sample size and the evidence bar live here rather than in either caller.
 */

/** How many recent sessions are pooled before calling a zone a weakness. */
export const SESSIONS_IN_SAMPLE = 5;

/**
 * Minimum attempts in a zone before it can be named as a standing strength or
 * weakness of the *player*.
 *
 * Higher than `MIN_ZONE_ATTEMPTS_FOR_CALLOUT` on purpose. That one governs a
 * single session's report, where naming the zone you actually shot worst in
 * today is useful even on a thin sample. This one governs a claim that
 * outlives the session, where one missed shot must never become a headline
 * weakness.
 *
 * Note this is NOT enforceable by passing it as `findBestAndWeakestZones`'s
 * `minAttempts`: that function deliberately *relaxes* its threshold until two
 * zones qualify, so a thin sample still yields a pair. Use
 * `resolveStandingZoneSignals`, which applies this floor after the fact.
 */
export const MIN_ATTEMPTS_FOR_CALLOUT = 5;

/** A zone named as a strength or weakness, carrying the evidence for it. */
export interface ZoneSignal {
  zone: ShotZone;
  label: string;
  attempts: number;
  makes: number;
  fgPercent: number;
}

/** Sums zone attempts/makes across several sessions into one breakdown. */
export function poolZoneBreakdowns(
  sessions: { zoneBreakdown?: ZoneBreakdown }[],
): ZoneBreakdown {
  const pooled: ZoneBreakdown = {};
  for (const session of sessions) {
    for (const [zone, stats] of Object.entries(session.zoneBreakdown ?? {})) {
      if (!stats) continue;
      const entry = pooled[zone as ShotZone] ?? { attempts: 0, makes: 0 };
      entry.attempts += stats.attempts;
      entry.makes += stats.makes;
      pooled[zone as ShotZone] = entry;
    }
  }
  return pooled;
}

export function toZoneSignal(
  zone: ShotZone | undefined,
  pooled: ZoneBreakdown,
): ZoneSignal | null {
  if (!zone) return null;
  const stats = pooled[zone];
  if (!stats) return null;
  return {
    zone,
    label: ZONE_LABELS[zone],
    attempts: stats.attempts,
    makes: stats.makes,
    fgPercent: fgPercent(stats.makes, stats.attempts),
  };
}

/** Total attempts across a pooled breakdown - the sample behind a callout. */
export function totalAttemptsIn(pooled: ZoneBreakdown): number {
  return Object.values(pooled).reduce(
    (sum, stats) => sum + (stats?.attempts ?? 0),
    0,
  );
}

/**
 * The player's standing strength/weakness across several sessions - the one
 * derivation both the Feed's callout cards and the Progress page use, so they
 * can never name different zones for the same player.
 *
 * Applies `MIN_ATTEMPTS_FOR_CALLOUT` as a hard floor *after*
 * `findBestAndWeakestZones` has picked the pair. That ordering matters: the
 * picker relaxes its own threshold to guarantee a result, which is right for a
 * single-session report but would let a 1-attempt zone become a standing claim
 * about the player. Returning null here is the honest answer - the caller is
 * expected to say "not enough shots yet" rather than guess.
 */
export function resolveStandingZoneSignals(
  sessions: { zoneBreakdown?: ZoneBreakdown }[],
): {
  pooled: ZoneBreakdown;
  best: ZoneSignal | null;
  weakest: ZoneSignal | null;
  totalAttempts: number;
} {
  const pooled = poolZoneBreakdowns(sessions);
  const { bestZone, weakestZone } = findBestAndWeakestZones(
    pooled,
    MIN_ATTEMPTS_FOR_CALLOUT,
  );

  const qualified = (signal: ZoneSignal | null): ZoneSignal | null =>
    signal && signal.attempts >= MIN_ATTEMPTS_FOR_CALLOUT ? signal : null;

  return {
    pooled,
    best: qualified(toZoneSignal(bestZone, pooled)),
    weakest: qualified(toZoneSignal(weakestZone, pooled)),
    totalAttempts: totalAttemptsIn(pooled),
  };
}
