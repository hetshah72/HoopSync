import { describe, expect, it } from "vitest";
import {
  buildRosterSyncOperations,
  buildSyncedFields,
  parseHeightToInches,
  parsePositiveInt,
  playerFullName,
  type BalldontliePlayer,
} from "@/lib/nba-roster";

const SYNCED_AT = new Date("2026-09-14T00:00:00.000Z");

function mockPlayer(overrides: Partial<BalldontliePlayer> = {}): BalldontliePlayer {
  return {
    id: 1,
    first_name: "Test",
    last_name: "Player",
    position: "G",
    jersey_number: "30",
    height: "6-2",
    weight: "185",
    college: "Test University",
    country: "USA",
    draft_year: 2009,
    draft_round: 1,
    draft_number: 7,
    team: { id: 1, full_name: "Test Team", abbreviation: "TT" },
    ...overrides,
  };
}

describe("parseHeightToInches", () => {
  it("parses the feet-inches wire format", () => {
    expect(parseHeightToInches("6-6")).toBe(78);
    expect(parseHeightToInches("5-11")).toBe(71);
    expect(parseHeightToInches(" 7-0 ")).toBe(84);
  });

  it("returns undefined for anything it can't trust", () => {
    expect(parseHeightToInches(null)).toBeUndefined();
    expect(parseHeightToInches("")).toBeUndefined();
    expect(parseHeightToInches("6'6\"")).toBeUndefined();
    expect(parseHeightToInches("six-six")).toBeUndefined();
  });
});

describe("parsePositiveInt", () => {
  it("parses the numeric-string fields balldontlie returns", () => {
    expect(parsePositiveInt("185")).toBe(185);
    expect(parsePositiveInt(2009)).toBe(2009);
    expect(parsePositiveInt(" 7 ")).toBe(7);
  });

  it("drops empty, zero, negative and non-numeric values", () => {
    expect(parsePositiveInt(null)).toBeUndefined();
    expect(parsePositiveInt("")).toBeUndefined();
    expect(parsePositiveInt("0")).toBeUndefined();
    expect(parsePositiveInt("-5")).toBeUndefined();
    expect(parsePositiveInt("undrafted")).toBeUndefined();
  });
});

describe("playerFullName", () => {
  it("joins and trims", () => {
    expect(playerFullName(mockPlayer())).toBe("Test Player");
    expect(
      playerFullName(mockPlayer({ first_name: "Cher", last_name: "" })),
    ).toBe("Cher");
  });
});

describe("buildSyncedFields", () => {
  it("maps every roster and bio field balldontlie provides", () => {
    const fields = buildSyncedFields(mockPlayer(), SYNCED_AT);

    expect(fields).toMatchObject({
      externalId: "1",
      syncStatus: "synced",
      name: "Test Player",
      team: "Test Team",
      position: "G",
      jerseyNumber: "30",
      heightInches: 74,
      weightPounds: 185,
      college: "Test University",
      country: "USA",
      draftYear: 2009,
      draftRound: 1,
      draftNumber: 7,
      lastSyncedAt: SYNCED_AT,
    });
  });

  it("classifies an archetype from position and height", () => {
    expect(
      buildSyncedFields(mockPlayer({ position: "G", height: "6-1" }), SYNCED_AT)
        .archetypeKey,
    ).toBe("lead_guard");
    expect(
      buildSyncedFields(mockPlayer({ position: "C", height: "7-0" }), SYNCED_AT)
        .archetypeKey,
    ).toBe("interior_big");
  });

  it("omits unknown values instead of writing them as nulls", () => {
    // A $set of `undefined` would clobber a previously-known college with
    // nothing; a player missing a field this sync keeps what we already had.
    const fields = buildSyncedFields(
      mockPlayer({
        college: null,
        country: null,
        draft_year: null,
        draft_round: null,
        draft_number: null,
        weight: null,
        height: null,
        jersey_number: null,
      }),
      SYNCED_AT,
    );

    expect("college" in fields).toBe(false);
    expect("country" in fields).toBe(false);
    expect("draftYear" in fields).toBe(false);
    expect("weightPounds" in fields).toBe(false);
    expect("heightInches" in fields).toBe(false);
    expect("jerseyNumber" in fields).toBe(false);
  });

  it("falls back to readable placeholders for a missing team or position", () => {
    const fields = buildSyncedFields(
      mockPlayer({ team: null, position: null }),
      SYNCED_AT,
    );
    expect(fields.team).toBe("Unassigned");
    expect(fields.position).toBe("Unknown");
    expect(fields.archetypeKey).toBe("all_around");
  });
});

describe("buildRosterSyncOperations", () => {
  it("counts a player already in the collection as matched, not created", () => {
    const result = buildRosterSyncOperations(
      [mockPlayer({ first_name: "Stephen", last_name: "Curry" })],
      new Set(["stephen curry"]),
      SYNCED_AT,
    );

    expect(result.matched).toBe(1);
    expect(result.created).toBe(0);
    expect(result.operations).toHaveLength(1);
  });

  it("matches case-insensitively, so an editorial-seeded player is adopted not duplicated", () => {
    const result = buildRosterSyncOperations(
      [mockPlayer({ first_name: "STEPHEN", last_name: "CURRY" })],
      new Set(["stephen curry"]),
      SYNCED_AT,
    );
    expect(result.matched).toBe(1);
    expect(result.created).toBe(0);
  });

  it("never writes editorial for an existing player", () => {
    // The whole point of the sync: hand-authored Learn/Skills/Signature-Move
    // content survives every roster refresh.
    const { operations } = buildRosterSyncOperations(
      [mockPlayer()],
      new Set(["test player"]),
      SYNCED_AT,
    );

    const op = operations[0] as {
      updateOne: { update: Record<string, Record<string, unknown>> };
    };
    expect(op.updateOne.update.$set).not.toHaveProperty("editorial");
    // Only ever on insert, and only as an empty shell.
    expect(op.updateOne.update.$setOnInsert).toHaveProperty("editorial");
  });

  it("seeds an empty editorial shell for a brand-new player", () => {
    const { operations, created } = buildRosterSyncOperations(
      [mockPlayer()],
      new Set(),
      SYNCED_AT,
    );
    expect(created).toBe(1);

    const op = operations[0] as unknown as {
      updateOne: { update: { $setOnInsert: { editorial: { signatureMoves: [] } } } };
    };
    expect(op.updateOne.update.$setOnInsert.editorial.signatureMoves).toEqual([]);
  });

  it("skips a nameless record rather than creating a blank player", () => {
    const result = buildRosterSyncOperations(
      [mockPlayer({ first_name: "", last_name: "" })],
      new Set(),
      SYNCED_AT,
    );
    expect(result.operations).toHaveLength(0);
    expect(result.skipped).toBe(1);
    expect(result.created).toBe(0);
  });

  it("dedupes a player returned on two pages", () => {
    // Two ops targeting the same document in one unordered bulkWrite is a
    // conflict, not a no-op - so the duplicate has to be dropped here.
    const result = buildRosterSyncOperations(
      [mockPlayer({ id: 1 }), mockPlayer({ id: 1 })],
      new Set(),
      SYNCED_AT,
    );
    expect(result.operations).toHaveLength(1);
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(1);
  });

  it("upserts, so a first-ever sync creates rather than silently no-ops", () => {
    const { operations } = buildRosterSyncOperations(
      [mockPlayer()],
      new Set(),
      SYNCED_AT,
    );
    const op = operations[0] as { updateOne: { upsert: boolean } };
    expect(op.updateOne.upsert).toBe(true);
  });

  it("returns no operations for an empty roster", () => {
    const result = buildRosterSyncOperations([], new Set(), SYNCED_AT);
    expect(result).toMatchObject({
      operations: [],
      created: 0,
      matched: 0,
      skipped: 0,
    });
  });
});
