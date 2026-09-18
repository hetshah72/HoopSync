import { describe, expect, it } from "vitest";
import {
  MIN_ATTEMPTS_FOR_CALLOUT,
  computeZoneBreakdown,
  fgPercent,
  findBestAndWeakestZones,
  poolZoneBreakdowns,
  resolveStandingZoneSignals,
  totalAttemptsIn,
  zoneFromLocation,
} from "@/lib/shot-zones";
import { SHOT_ZONES } from "@/types/db";

/** A session summary shaped just enough for the pooling helpers. */
function session(zoneBreakdown: Record<string, { attempts: number; makes: number }>) {
  return { zoneBreakdown } as Parameters<typeof poolZoneBreakdowns>[0][number];
}

describe("zoneFromLocation", () => {
  it("classifies a tap directly under the hoop as the paint", () => {
    expect(zoneFromLocation(50, 10)).toBe("paint");
  });

  it("classifies corner taps near the baseline as corner threes", () => {
    expect(zoneFromLocation(5, 10)).toBe("left_corner_3");
    expect(zoneFromLocation(95, 10)).toBe("right_corner_3");
  });

  it("classifies a top-of-key tap far from the hoop as top_of_key_3", () => {
    expect(zoneFromLocation(50, 80)).toBe("top_of_key_3");
  });

  it("classifies free-throw-line taps as free_throw_mid", () => {
    expect(zoneFromLocation(50, 45)).toBe("free_throw_mid");
  });

  it("clamps out-of-range coordinates instead of throwing", () => {
    expect(() => zoneFromLocation(-20, 150)).not.toThrow();
    expect(zoneFromLocation(-20, 150)).toBe(zoneFromLocation(0, 100));
  });

  it("always returns one of the 9 canonical zones for a grid of points", () => {
    for (let x = 0; x <= 100; x += 10) {
      for (let y = 0; y <= 100; y += 10) {
        expect(SHOT_ZONES).toContain(zoneFromLocation(x, y));
      }
    }
  });
});

describe("fgPercent", () => {
  it("returns 0 for no attempts instead of NaN", () => {
    expect(fgPercent(0, 0)).toBe(0);
  });

  it("rounds to one decimal place", () => {
    expect(fgPercent(1, 3)).toBe(33.3);
  });

  it("computes an exact 50%", () => {
    expect(fgPercent(5, 10)).toBe(50);
  });
});

describe("computeZoneBreakdown", () => {
  it("tallies attempts and makes per zone from real shot records", () => {
    const breakdown = computeZoneBreakdown([
      { zone: "paint", made: true },
      { zone: "paint", made: false },
      { zone: "top_of_key_3", made: true },
    ]);

    expect(breakdown.paint).toEqual({ attempts: 2, makes: 1 });
    expect(breakdown.top_of_key_3).toEqual({ attempts: 1, makes: 1 });
    expect(breakdown.left_corner_3).toBeUndefined();
  });
});

describe("findBestAndWeakestZones", () => {
  it("picks the highest and lowest FG% zones, not a random pair", () => {
    const breakdown = computeZoneBreakdown([
      { zone: "paint", made: true },
      { zone: "paint", made: true },
      { zone: "left_corner_3", made: false },
      { zone: "left_corner_3", made: false },
    ]);

    const { bestZone, weakestZone } = findBestAndWeakestZones(breakdown);
    expect(bestZone).toBe("paint");
    expect(weakestZone).toBe("left_corner_3");
  });

  it("relaxes the threshold rather than refusing to call a short session", () => {
    // Deliberate: for a single session's report, naming the zone the player
    // actually shot worst in beats "log more shots". The caller inspects the
    // zone's own `attempts` to decide how confidently to present it - and a
    // *standing* claim about the player goes through
    // resolveStandingZoneSignals, which does enforce a hard floor.
    const breakdown = computeZoneBreakdown([{ zone: "paint", made: true }]);
    expect(findBestAndWeakestZones(breakdown, 2)).toEqual({
      weakestZone: "paint",
    });
  });

  it("returns nothing at all when there are no shots", () => {
    expect(findBestAndWeakestZones({}, 2)).toEqual({});
  });

  it("is deterministic given the same input", () => {
    const breakdown = computeZoneBreakdown([
      { zone: "paint", made: true },
      { zone: "right_mid", made: false },
      { zone: "right_mid", made: true },
    ]);
    expect(findBestAndWeakestZones(breakdown)).toEqual(findBestAndWeakestZones(breakdown));
  });

  it("never reports one zone as both the strength and the weakness", () => {
    // A single-zone session used to return the same zone for both, which
    // rendered it under STRENGTH *and* NEEDS WORK and made the mechanical
    // narrative compare the zone against itself.
    const breakdown = computeZoneBreakdown([
      { zone: "right_wing_3", made: true },
      { zone: "right_wing_3", made: false },
      { zone: "right_wing_3", made: false },
    ]);

    const { bestZone, weakestZone } = findBestAndWeakestZones(breakdown);
    expect(weakestZone).toBe("right_wing_3");
    expect(bestZone).toBeUndefined();
    expect(bestZone).not.toBe(weakestZone);
  });

  it("still reports both when two zones were logged", () => {
    const breakdown = computeZoneBreakdown([
      { zone: "paint", made: true },
      { zone: "top_of_key_3", made: false },
    ]);

    const { bestZone, weakestZone } = findBestAndWeakestZones(breakdown);
    expect(bestZone).toBe("paint");
    expect(weakestZone).toBe("top_of_key_3");
  });
});

describe("poolZoneBreakdowns", () => {
  it("sums attempts and makes for the same zone across sessions", () => {
    const pooled = poolZoneBreakdowns([
      session({ paint: { attempts: 4, makes: 3 } }),
      session({ paint: { attempts: 6, makes: 2 } }),
    ]);
    expect(pooled.paint).toEqual({ attempts: 10, makes: 5 });
  });

  it("keeps zones from different sessions side by side", () => {
    const pooled = poolZoneBreakdowns([
      session({ paint: { attempts: 2, makes: 2 } }),
      session({ left_corner_3: { attempts: 3, makes: 0 } }),
    ]);
    expect(pooled.paint).toEqual({ attempts: 2, makes: 2 });
    expect(pooled.left_corner_3).toEqual({ attempts: 3, makes: 0 });
    expect(totalAttemptsIn(pooled)).toBe(5);
  });

  it("ignores sessions with no breakdown", () => {
    expect(poolZoneBreakdowns([session({}), {}])).toEqual({});
  });
});

describe("resolveStandingZoneSignals", () => {
  it("names a strength and a weakness once both clear the evidence bar", () => {
    const { best, weakest, totalAttempts } = resolveStandingZoneSignals([
      session({
        paint: { attempts: 10, makes: 8 },
        left_corner_3: { attempts: 10, makes: 2 },
      }),
    ]);

    expect(best?.zone).toBe("paint");
    expect(best?.fgPercent).toBe(80);
    expect(weakest?.zone).toBe("left_corner_3");
    expect(weakest?.fgPercent).toBe(20);
    expect(totalAttempts).toBe(20);
  });

  it("refuses to name a zone below MIN_ATTEMPTS_FOR_CALLOUT, even though findBestAndWeakestZones would", () => {
    const thin = [
      session({
        paint: { attempts: 1, makes: 1 },
        left_corner_3: { attempts: 2, makes: 0 },
      }),
    ];

    // The picker relaxes its threshold and does return a pair...
    const picked = findBestAndWeakestZones(
      poolZoneBreakdowns(thin),
      MIN_ATTEMPTS_FOR_CALLOUT,
    );
    expect(picked.weakestZone).toBe("left_corner_3");

    // ...but a standing claim about the player must not be made on 2 attempts.
    const { best, weakest } = resolveStandingZoneSignals(thin);
    expect(best).toBeNull();
    expect(weakest).toBeNull();
  });

  it("pools across sessions so a zone qualifies on combined volume", () => {
    // 3 + 3 attempts in the same zone clears a bar neither session clears alone.
    const { weakest } = resolveStandingZoneSignals([
      session({
        left_wing_3: { attempts: 3, makes: 0 },
        paint: { attempts: 5, makes: 5 },
      }),
      session({ left_wing_3: { attempts: 3, makes: 1 } }),
    ]);

    expect(weakest?.zone).toBe("left_wing_3");
    expect(weakest?.attempts).toBe(6);
  });

  it("is empty for a player who has never logged a shot", () => {
    const { best, weakest, totalAttempts } = resolveStandingZoneSignals([]);
    expect(best).toBeNull();
    expect(weakest).toBeNull();
    expect(totalAttempts).toBe(0);
  });
});
