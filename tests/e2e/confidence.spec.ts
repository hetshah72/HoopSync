import { test, expect, type Locator, type Page } from "@playwright/test";
import { signInAsDemoPlayer } from "./helpers/auth";

/**
 * BRD 7.10's two success criteria, in a real browser:
 *
 *   1. "A 'Nervous' pre-game check-in returns a specific routine, not a
 *      generic pep talk."
 *   2. "A post-poor-game flow references real data from that game or session."
 *
 * Runs against the seeded demo account, which has a real completed shooting
 * session behind it - so the recovery plan has genuine numbers to cite rather
 * than falling into its own honest "not enough logged activity" branch. Run
 * `npm run db:seed` first.
 *
 * OPENAI_API_KEY is intentionally unset in this environment, which is the
 * point of the Coach step: the opener is composed in code from the stored
 * plan, so it still names the player's real figures with no model available.
 *
 * Every getByRole match uses `exact: true` - in dev mode Next.js overlays its
 * own "Close Next.js Dev Tools" button on every page, which substring-matches
 * short accessible names under Playwright's default matching.
 */

function button(scope: Page | Locator, name: string) {
  return scope.getByRole("button", { name, exact: true });
}
function link(scope: Page | Locator, name: string) {
  return scope.getByRole("link", { name, exact: true });
}

/** Phrases BRD 7.10 rules out. Mirrors the unit suite's banned list. */
const PEP_TALK = [
  "believe in yourself",
  "you've got this",
  "stay positive",
  "trust the process",
  "never give up",
];

test.describe.serial("Confidence / Mental Game (BRD 7.10)", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await signInAsDemoPlayer(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test("Home routes into Confidence without a seventh nav tab", async () => {
    await page.goto("/home");

    // The nav is fixed at six by BRD v1.1 §4 - Confidence is reached from a
    // card, and a regression here would mean someone added a tab.
    const nav = page.getByRole("navigation").first();
    await expect(nav.getByRole("link", { name: "Confidence" })).toHaveCount(0);

    await page.getByRole("link", { name: /Game today\?/ }).click();
    await page.waitForURL("**/confidence");
    await expect(page.getByText("Mental game")).toBeVisible();
  });

  test("SC1: 'Nervous' returns a specific routine, not a pep talk", async () => {
    await page.goto("/confidence");
    await button(page, "Nervous").click();

    const card = page.getByText("Do this now").locator("..");

    // Concrete and countable - the distinction the BRD is drawing.
    await expect(card).toContainText("Box breathing");
    await expect(card).toContainText("free throws");
    await expect(card).toContainText(/\d/);

    // And an in-game cue that tells them what to actually do first.
    await expect(page.getByText("In-game cue")).toBeVisible();

    const body = (await page.locator("main").innerText()).toLowerCase();
    for (const phrase of PEP_TALK) {
      expect(body).not.toContain(phrase);
    }
  });

  test("re-picking a feeling revises the check-in rather than stacking rows", async () => {
    await page.goto("/confidence");
    await button(page, "Confident").click();
    await button(page, "Nervous").click();

    // The routine follows the latest answer...
    await expect(page.getByText("Do this now").locator("..")).toContainText(
      "Box breathing",
    );

    // ...and Progress shows one entry for today, not one per tap.
    await page.goto("/progress");
    const mentalCard = page
      .locator('[data-slot="card"]')
      .filter({ hasText: "Mental game" });
    await expect(mentalCard).toContainText("Before a game - Nervous");
    await expect(mentalCard.getByText(/^Before a game/)).toHaveCount(1);
  });

  test("SC2: the recovery plan cites the session's real numbers", async () => {
    await page.goto("/confidence");

    const build = button(page, "Build my recovery plan");
    if (await build.isVisible().catch(() => false)) {
      await build.click();
    } else {
      await button(page, "Rebuild from my latest data").click();
    }

    await expect(page.getByText("Your next steps")).toBeVisible();

    // The seeded demo session is deliberately skewed so Right Wing 3 is the
    // weakest zone - the plan must name that spot and quote a real figure,
    // not offer generic advice.
    const main = page.locator("main");
    await expect(main).toContainText("Right Wing 3");
    await expect(main).toContainText(/\d+(\.\d+)?%/);
    await expect(main).toContainText("from your logged sessions and workouts");
  });

  test("the plan's links go somewhere real - no dead buttons", async () => {
    await page.goto("/confidence");

    await link(page, "Review that session").click();
    await page.waitForURL(/\/analyze\/shooting\/[0-9a-f]{24}/);
    await expect(page.getByText("Attempts")).toBeVisible();

    await page.goBack();

    // Only rendered when the cited session actually generated a workout, so
    // its presence and its destination have to agree.
    const startWorkout = link(page, "Start that workout");
    if (await startWorkout.isVisible().catch(() => false)) {
      await startWorkout.click();
      await page.waitForURL(/\/train\/[0-9a-f]{24}/);
    }
  });

  test("Coach picks the plan up with those same real numbers, with no API key", async () => {
    await page.goto("/confidence");
    // The plan's own hand-off, not the page-level pre-game one - those are
    // different check-ins and only this one carries the recovery plan.
    await button(page, "Talk to Coach about this plan").click();
    await page.waitForURL(/\/coach\/[0-9a-f]{24}/);

    // BRD 7.8's bar, applied to 7.10: not a generic greeting.
    const transcript = page.locator("main");
    await expect(transcript).toContainText(/\d+ of \d+/);
    await expect(transcript).toContainText(/\d+(\.\d+)?%/);

    const opener = (await transcript.innerText()).toLowerCase();
    for (const phrase of PEP_TALK) {
      expect(opener).not.toContain(phrase);
    }
  });
});
