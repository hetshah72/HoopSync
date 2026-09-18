import { test, expect, type Page } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import { MongoClient, ObjectId } from "mongodb";
import { signInAsDemoPlayer } from "./helpers/auth";

/**
 * Browser coverage for the half of NBA Player Mode that no seeded data can
 * reach: a player who came from the balldontlie roster sync and has **no**
 * hand-authored content.
 *
 * BRD 7.4 requires every profile across the full roster to carry at least one
 * Signature Move with a matching drill, and that is satisfied by the authored
 * archetype packs (src/lib/player-archetypes.ts). The service layer is covered
 * by integration tests, but until now nothing had ever *rendered* that path -
 * and `npm run db:seed` deliberately creates no synced players, because the
 * roster is supposed to come from the real sync. So this spec inserts one
 * directly, exactly as a sync would.
 *
 * It also covers the study clip's guided call-outs, which are the most
 * interactive thing in the feature and cannot be asserted anywhere but a real
 * browser: tapping a call-out has to actually seek the video.
 *
 * Signs in as the seeded demo account, which is already onboarded - this spec
 * is about the player profile, not the wizard (founder-loop.spec.ts covers
 * that).
 */
loadEnv({ path: ".env", quiet: true });
loadEnv({ path: ".env.local", override: true, quiet: true });

const MONGODB_URI = process.env.MONGODB_URI ?? "mongodb://127.0.0.1:27017";
const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME || "hoopsync";

/** A 7-footer with an empty editorial shell - what syncRoster actually writes. */
const SYNCED_PLAYER_NAME = "E2E Archetype Big";

let client: MongoClient;
let playerId: string;

test.beforeAll(async () => {
  client = new MongoClient(MONGODB_URI);
  await client.connect();
  const db = client.db(MONGODB_DB_NAME);

  const result = await db.collection("nbaPlayers").findOneAndUpdate(
    { name: SYNCED_PLAYER_NAME },
    {
      $set: {
        externalId: "e2e-archetype-big",
        syncStatus: "synced",
        name: SYNCED_PLAYER_NAME,
        team: "Test City Testers",
        position: "C",
        jerseyNumber: "77",
        heightInches: 85,
        weightPounds: 250,
        college: "Test University",
        country: "Testland",
        draftYear: 2022,
        draftRound: 1,
        draftNumber: 3,
        archetypeKey: "interior_big",
        lastSyncedAt: new Date(),
        // The empty shell a real sync inserts - no authored content at all.
        editorial: {
          learn: { whatTheyDoWell: "", howTheyPlay: "", whatToWatchFor: "" },
          skills: {
            shooting: 0,
            finishing: 0,
            ballHandling: 0,
            playmaking: 0,
            defense: 0,
            athleticism: 0,
          },
          strengths: [],
          weaknesses: [],
          bio: { careerInfo: "" },
          signatureMoves: [],
        },
      },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true, returnDocument: "after" },
  );

  playerId = (result!._id as ObjectId).toString();
});

test.afterAll(async () => {
  // This is a throwaway fixture in the shared dev database, unlike the
  // founder loop's accounts which are deliberately left behind as history.
  await client
    .db(MONGODB_DB_NAME)
    .collection("nbaPlayers")
    .deleteOne({ name: SYNCED_PLAYER_NAME });
  await client.close();
});


test.describe.serial("Roster-synced player with no authored content (BRD 7.4)", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await signInAsDemoPlayer(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test("discloses that the content is archetype-based rather than film study", async () => {
    await page.goto(`/players/${playerId}`);

    await expect(page.getByRole("heading", { name: SYNCED_PLAYER_NAME })).toBeVisible();
    // Roster facts are real and must read as real.
    await expect(page.getByText("Test City Testers")).toBeVisible();

    // The honesty contract: this must never read as a scouting report on an
    // individual (CLAUDE.md labeling rule / BRD v1.1 §5).
    await expect(page.getByText("Archetype-based coaching content")).toBeVisible();
    await expect(page.getByText("Interior Big").first()).toBeVisible();
    await expect(
      page.getByText(/not film study of them specifically, and not NBA statistics/),
    ).toBeVisible();
  });

  test("still carries a signature move with a real, named drill", async () => {
    // The BRD 7.4 guarantee that the archetype system exists to deliver: the
    // move write-up, and the real drill that practises it, are distinct - the
    // card is not just a button with a name on it.
    await expect(page.getByText("Rim Run And Seal", { exact: true })).toBeVisible();
    await expect(page.getByText("Rim Run And Seal Finish")).toBeVisible();
    // The Interior Big pack carries two moves, and each names its own drill -
    // one per signature move, never a shared or missing one.
    await expect(page.getByText("Drill to practise it")).toHaveCount(2);
    await expect(
      page.getByRole("button", { name: "Start Matching Workout", exact: true }).first(),
    ).toBeVisible();
  });

  test("labels the skill bars as a role profile, not this player's statistics", async () => {
    await page.getByRole("tab", { name: "Skills" }).click();
    await expect(
      page.getByText(
        "Skill emphasis typical of this player type - a coaching profile, not this player's statistics.",
      ),
    ).toBeVisible();
  });

  test("shows the real synced bio facts, including the fields the sync used to discard", async () => {
    await page.getByRole("tab", { name: "Bio" }).click();
    await expect(page.getByText("Test University")).toBeVisible();
    await expect(page.getByText("Testland")).toBeVisible();
    await expect(page.getByText("2022 - Round 1, Pick 3")).toBeVisible();
    await expect(page.getByText("7'1\"")).toBeVisible();
    await expect(page.getByText("250 lbs")).toBeVisible();
  });

  test("tapping a study-clip call-out actually seeks the video to that timestamp", async () => {
    await page.getByRole("tab", { name: "Learn" }).click();

    const video = page.locator("video");
    await expect(video).toBeVisible();
    await expect(page.getByText("What to watch for - tap to jump to that moment")).toBeVisible();

    // Wait for metadata so currentTime is actually settable.
    await page.waitForFunction(
      () => {
        const el = document.querySelector("video");
        return !!el && el.readyState >= 1;
      },
      undefined,
      { timeout: 30_000 },
    );

    const before = await video.evaluate((el: HTMLVideoElement) => el.currentTime);

    // "Seal early" is the interior_big pack's second call-out, at 8s.
    await page.getByRole("button", { name: /Seal early/ }).click();

    await expect
      .poll(async () => video.evaluate((el: HTMLVideoElement) => el.currentTime), {
        timeout: 10_000,
      })
      .toBeGreaterThan(before + 5);

    // And the footage disclosure is present, since no league film is licensed
    // (BRD 6.4 / 7.14).
    await expect(page.getByText(/Placeholder footage/)).toBeVisible();
  });

  test("starts a real workout from the archetype signature move", async () => {
    await page
      .getByRole("button", { name: "Start Matching Workout", exact: true })
      .first()
      .click();
    await page.waitForURL(/\/train\/[0-9a-f]{24}$/);
    await expect(
      page.getByRole("button", { name: "Start Workout", exact: true }),
    ).toBeVisible();
  });
});
