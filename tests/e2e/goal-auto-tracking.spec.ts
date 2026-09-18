import { test, expect, type Locator, type Page } from "@playwright/test";
import { signUpNewPlayer } from "./helpers/auth";

/**
 * BRD 7.12's success criterion, end to end:
 *
 *   "At least one goal type updates automatically from real activity,
 *    without the player manually marking progress."
 *
 * The load-bearing word is *without*. So this spec never touches a progress
 * control - there deliberately isn't one - and the only thing it does between
 * reading the goal at 0 and reading it at 1 is complete a real workout in
 * Train. It also covers the two ways that promise used to break:
 *
 *  - a "from creation" goal opening already finished, because progress was
 *    seeded from the player's lifetime totals rather than from the day they
 *    set the goal;
 *  - a weekly goal latching to "Complete" the first time it was met and never
 *    moving again, which turns a habit into a one-off.
 *
 * Every getByRole name match uses `exact: true` - in dev mode Next.js overlays
 * a "Close Next.js Dev Tools" button on every page, which substring-matches
 * short names like "Next" under Playwright's default matching.
 */

const OBJECT_ID = /[0-9a-f]{24}/;

function button(scope: Page | Locator, name: string) {
  return scope.getByRole("button", { name, exact: true });
}
function link(scope: Page | Locator, name: string) {
  return scope.getByRole("link", { name, exact: true });
}
function nav(page: Page) {
  return page.getByRole("navigation");
}
/**
 * The whole card for one goal, scoped by its title so sibling goals never
 * match. The title <p> sits two divs deep inside CardContent, so this climbs
 * to the card body that also holds the badge and the footer line.
 */
function goalCard(page: Page, title: string) {
  return page
    .locator("p", { hasText: new RegExp(`^${title}$`) })
    .locator("../../..");
}

async function openGoalsTab(page: Page) {
  await link(nav(page), "Progress").click();
  await page.waitForURL("**/progress");
  await page.getByRole("tab", { name: "Goals", exact: true }).click();
}

test.describe.serial("Goals track themselves from real activity (BRD 7.12)", () => {
  let page: Page;
  const email = `e2e-goals-${Math.random().toString(36).slice(2)}@hoopsync.dev`;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });

  test.afterAll(async () => {
    await page.close();
  });

  test("onboard a brand-new player", async () => {
    await signUpNewPlayer(page, { email, name: "Sam" });

    await page.getByLabel("Date of birth").fill("2008-01-01");
    await page.getByLabel("Height in feet").fill("6");
    await page.getByLabel("Height in inches").fill("1");
    await page.getByLabel("Weight (lbs)").fill("175");
    await button(page, "High School").click();
    await page.getByLabel("Expected graduation year").fill("2028");
    await button(page, "Continue").click();

    await button(page, "Point Guard").click();
    await button(page, "High School").click();
    await button(page, "Continue").click();

    await button(page, "Become a better all-around player").click();
    await button(page, "Shooting").click();
    await button(page, "Continue").click();

    await page.getByLabel("Games per week").fill("2");
    await page.getByLabel("Practices per week").fill("3");
    await button(page, "Hoop").click();
    await button(page, "Ball").click();
    await button(page, "Continue").click();

    await page.locator("button", { hasText: "Balanced" }).click();
    await button(page, "Finish").click();
    await page.waitForURL("**/home");
  });

  test("a tryout-prep goal opens at zero, counting the work still ahead", async () => {
    await openGoalsTab(page);

    await button(page, "Set a goal").click();
    await button(page, "Prepare for tryouts").click();
    await page.getByRole("spinbutton", { name: /^Target \(/ }).fill("2");
    await button(page, "Set goal").click();

    const card = goalCard(page, "Complete 2 workouts before tryouts");
    await expect(card).toBeVisible();
    // Not "2 / 2" from a lifetime count, and not already Complete.
    await expect(card).toContainText("0 / 2 workouts");
    await expect(card.getByText("Complete", { exact: true })).toHaveCount(0);
  });

  test("a weekly goal reads in workouts/week, not a raw metric key", async () => {
    await button(page, "Set a goal").click();
    await button(page, "Train more often").click();
    await page.getByRole("spinbutton", { name: /^Target \(/ }).fill("1");
    await button(page, "Set goal").click();

    const card = goalCard(page, "Train 1x per week");
    await expect(card).toBeVisible();
    await expect(card).toContainText("0 / 1 workouts/week");
    await expect(card).toContainText("last 7 days");
  });

  test("completing a real workout is the only thing that moves them", async () => {
    await link(nav(page), "Players").click();
    await page.waitForURL("**/players");
    await page.getByRole("link", { name: /Stephen Curry/ }).click();
    await page.waitForURL(new RegExp(`/players/${OBJECT_ID.source}$`));

    await button(page, "Start Matching Workout").click();
    await page.waitForURL(new RegExp(`/train/${OBJECT_ID.source}$`));

    await button(page, "Start Workout").click();
    await expect(page.getByText(/Drill 1 of \d+/)).toBeVisible();
    while (await button(page, "Next").isEnabled().catch(() => false)) {
      await button(page, "Next").click();
    }
    await button(page, "Complete Workout").click();
    await page.waitForURL("**/train");
  });

  test("both goals advanced on their own, with no progress ever marked by hand", async () => {
    await openGoalsTab(page);

    await expect(
      goalCard(page, "Complete 2 workouts before tryouts"),
    ).toContainText("1 / 2 workouts");

    // The weekly goal hit its target - but as "Met this week", and it stays
    // in the active list rather than being archived as finished forever.
    const weekly = goalCard(page, "Train 1x per week");
    await expect(weekly).toContainText("1 / 1 workouts/week");
    await expect(weekly.getByText("Met this week", { exact: true })).toBeVisible();

    // The promise being tested: nothing on this screen lets a player claim
    // progress by hand, so the numbers above can only have come from the
    // workout they actually completed.
    await expect(page.getByText(/recalculate from your real activity/i)).toBeVisible();
    await expect(button(page, "Mark progress")).toHaveCount(0);
  });
});
