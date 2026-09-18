import { expect, test } from "@playwright/test";
import { config as loadEnv } from "dotenv";
import { MongoClient } from "mongodb";
import { signInAsDemoPlayer, signInWithPassword } from "./helpers/auth";

// The admin role is resolved from ADMIN_EMAILS per request, and that lives in
// .env.local - which Next loads for the dev server but the Playwright runner
// does not. Same reason and same pattern as player-archetype.spec.ts.
loadEnv({ path: ".env", quiet: true });
loadEnv({ path: ".env.local", override: true, quiet: true });

/**
 * The content pipeline, end to end in a real browser (BRD 7.14: "MVP for the
 * content pipeline itself", "Production content must have cleared rights
 * before use").
 *
 * Skipped unless ADMIN_EMAILS names the seeded admin - the role is resolved
 * from that allow-list per request, so without it this account is an ordinary
 * player and the surface correctly refuses.
 */
const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@hoopsync.dev";
const ADMIN_PASSWORD = process.env.SEED_DEMO_USER_PASSWORD || "demo-player-1";
const ADMIN_ENABLED = (process.env.ADMIN_EMAILS ?? "")
  .toLowerCase()
  .includes(ADMIN_EMAIL.toLowerCase());

/**
 * These specs run against the real development database, so anything a test
 * publishes is removed rather than left to accumulate in the library on every
 * run.
 */
async function cleanUp(title: string): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) return;
  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DB_NAME || "hoopsync");
    const card = await db.collection("feedItems").findOne({ title });
    if (card?.mediaAssetId) {
      await db.collection("mediaAssets").deleteOne({ _id: card.mediaAssetId });
    }
    await db.collection("feedItems").deleteOne({ title });
  } finally {
    await client.close();
  }
}

test.describe("admin content pipeline", () => {
  test.skip(
    !ADMIN_ENABLED,
    "Set ADMIN_EMAILS to the seeded admin address to run these.",
  );

  test("an ordinary player is told plainly that the area isn't theirs", async ({
    page,
  }) => {
    await signInAsDemoPlayer(page);
    await page.goto("/admin/library");
    // Not a redirect to sign-in: bouncing them to a form they will pass and be
    // rejected by again is a loop rather than an explanation.
    await expect(page.getByText(/don't have access to this area/i)).toBeVisible();
  });

  test("the ingest form asks for the rights before it will take the file", async ({
    page,
  }) => {
    await signInWithPassword(page, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    await page.goto("/admin/library");

    await expect(page.getByRole("heading", { name: "Library" })).toBeVisible();
    await expect(page.getByLabel("Rights basis")).toBeVisible();
    await expect(page.getByLabel("Who supplied it")).toBeVisible();
    await expect(page.getByLabel("Rights holder")).toBeVisible();
  });

  test("choosing a licensed basis makes the licence terms mandatory", async ({
    page,
  }) => {
    await signInWithPassword(page, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    await page.goto("/admin/library");

    await page.getByLabel("Rights basis").selectOption("licensed");
    // A licensed asset with no record of its licence is exactly the
    // untraceable content BRD 7.14 exists to prevent.
    await expect(page.getByLabel("Licence terms")).toHaveAttribute("required", "");
  });

  test("a coach's clip is taken in, blocked, and only publishable once cleared", async ({
    page,
  }) => {
    const title = `E2E coach clip ${Date.now()}`;

    await signInWithPassword(page, { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    await page.goto("/admin/library");

    await page.setInputFiles("#clip", "tests/e2e/fixtures/sample-clip.mp4");
    await page.getByLabel("Rights basis").selectOption("licensed");
    await page.getByLabel("Who supplied it").selectOption("coach_trainer");
    await page.getByLabel("Rights holder").fill("Coach Dana Reyes");
    await page.getByLabel("Licence terms").fill("Signed release on file, 2026-09.");
    await page.getByLabel("Card title").fill(title);
    await page.getByLabel("What the clip shows").fill("A hesitation into drive.");
    await page.getByRole("button", { name: /Add clip/ }).click();

    try {
      // Taken in, but not cleared: a coach's footage needs a human to confirm
      // a release exists before anyone sees it.
      await expect(page.getByText("Awaiting clearance").first()).toBeVisible({
        timeout: 20_000,
      });
      await expect(
        page.getByRole("button", { name: /^Publish$/ }).first(),
      ).toBeDisabled();

      await page.getByRole("button", { name: /Clear rights/ }).first().click();
      await expect(page.getByText("Rights cleared").first()).toBeVisible({
        timeout: 20_000,
      });
    } finally {
      await cleanUp(title);
    }
  });
});
