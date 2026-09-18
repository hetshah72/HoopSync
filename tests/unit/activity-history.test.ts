import { describe, expect, it } from "vitest";
import {
  mergeActivityHistory,
  type ActivityEntry,
} from "@/lib/activity-history";

function entry(
  id: string,
  kind: ActivityEntry["kind"],
  iso: string,
): ActivityEntry {
  return {
    id,
    kind,
    occurredAt: new Date(iso),
    label: `${kind} ${id}`,
    href: `/${kind}/${id}`,
  };
}

describe("mergeActivityHistory", () => {
  it("interleaves all three activity kinds by date, newest first", () => {
    const merged = mergeActivityHistory(
      [
        entry("w1", "workout", "2026-09-10T10:00:00Z"),
        entry("f1", "game_film", "2026-09-12T10:00:00Z"),
        entry("s1", "shot_session", "2026-09-11T10:00:00Z"),
      ],
      10,
    );

    expect(merged.map((e) => e.id)).toEqual(["f1", "s1", "w1"]);
  });

  it("truncates to the limit, keeping the most recent", () => {
    const merged = mergeActivityHistory(
      [
        entry("old", "workout", "2026-09-01T10:00:00Z"),
        entry("mid", "workout", "2026-09-05T10:00:00Z"),
        entry("new", "workout", "2026-09-09T10:00:00Z"),
      ],
      2,
    );

    expect(merged.map((e) => e.id)).toEqual(["new", "mid"]);
  });

  it("orders same-instant activities stably rather than arbitrarily", () => {
    const sameMoment = "2026-09-14T12:00:00Z";
    const first = mergeActivityHistory(
      [
        entry("b", "shot_session", sameMoment),
        entry("a", "workout", sameMoment),
      ],
      10,
    );
    const reversed = mergeActivityHistory(
      [
        entry("a", "workout", sameMoment),
        entry("b", "shot_session", sameMoment),
      ],
      10,
    );

    expect(first.map((e) => e.id)).toEqual(reversed.map((e) => e.id));
  });

  it("returns an empty list for a player with no activity", () => {
    expect(mergeActivityHistory([], 10)).toEqual([]);
  });

  it("does not mutate the caller's array", () => {
    const entries = [
      entry("w1", "workout", "2026-09-01T10:00:00Z"),
      entry("w2", "workout", "2026-09-09T10:00:00Z"),
    ];
    mergeActivityHistory(entries, 10);
    expect(entries.map((e) => e.id)).toEqual(["w1", "w2"]);
  });
});
