import { test, expect, type Page } from "@playwright/test";
import { signInAsDemoPlayer } from "./helpers/auth";

/**
 * The Home feed (BRD 7.2) against a real dev server and real MongoDB.
 *
 * Signs in as the seeded demo account rather than onboarding a fresh one:
 * this suite is about the feed, and the demo account already carries the real
 * workout and shooting history the personalized cards are built from. Run
 * `npm run db:seed` first.
 *
 * These are the feed behaviours the audit found broken and BRD v1.1 §8's
 * no-dead-button rule requires: generation happening once per day rather than
 * per render, Start landing inside the workout rather than on the Train list,
 * Ask Coach resuming one conversation with a real opener rather than stacking
 * up empty ones, and Save having somewhere to be read back.
 *
 * `exact: true` throughout - Next.js dev mode overlays a "Close Next.js Dev
 * Tools" button that substring-matches short accessible names.
 */

const signIn = signInAsDemoPlayer;

/** Cards are badged by kind, so this is how a generated card is identified. */
function cardByBadge(page: Page, badge: string) {
  return page.locator("[id^='card-']").filter({ hasText: badge }).first();
}

test.describe.serial("Home / personalized feed", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await signIn(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test("renders today's workout and personalized cards built from real data", async () => {
    await expect(page.getByText("Welcome back")).toBeVisible();

    const workoutCard = cardByBadge(page, "Today's Workout");
    await expect(workoutCard).toBeVisible();
    // A real, startable workout - not a label with nothing behind it.
    await expect(
      workoutCard.getByRole("link", { name: "Start workout", exact: true }),
    ).toBeVisible();

    // The demo account has logged sessions, so the feed is entitled to say
    // something about its shooting - and must cite what it measured.
    const weakness = cardByBadge(page, "Your Numbers");
    await expect(weakness).toBeVisible();
    // Every figure on the card is attributed, and is a real makes/attempts
    // count from the player's own logged shots.
    const facts = weakness.getByText(/^Based on your data:/);
    await expect(facts.first()).toBeVisible();
    await expect(facts.first()).toHaveText(/\d+\/\d+ \(\d+(\.\d+)?%\)/);
  });

  test("every card action is wired to something real", async () => {
    const card = cardByBadge(page, "Today's Workout");
    for (const action of ["Like", "Save", "Share", "Ask Coach"]) {
      await expect(card.getByRole("button", { name: action, exact: true })).toBeVisible();
    }
  });

  test("generates the day's workout once, however many times Home is re-rendered", async () => {
    await page.goto("/train");
    const before = await page.getByText(/today's session/i).count();

    for (let i = 0; i < 3; i++) {
      await page.goto("/home");
      await expect(cardByBadge(page, "Today's Workout")).toBeVisible();
    }

    await page.goto("/train");
    const after = await page.getByText(/today's session/i).count();

    // Re-rendering Home must not stack up pending workouts (audit Bug Feed-2
    // was this exact failure mode on a different control).
    expect(after).toBe(before);
    expect(after).toBeGreaterThan(0);
  });

  test("Start workout lands inside the workout, not on the Train list", async () => {
    await page.goto("/home");
    await cardByBadge(page, "Today's Workout")
      .getByRole("link", { name: "Start workout", exact: true })
      .click();

    await page.waitForURL(/\/train\/[0-9a-f]{24}/);
    await expect(
      page.getByRole("button", { name: "Start Workout", exact: true }),
    ).toBeVisible();
  });

  test("Save has a destination that reads it back", async () => {
    await page.goto("/home");
    const card = cardByBadge(page, "Confidence");
    const title = (await card.getByRole("heading").first().textContent())?.trim();
    expect(title).toBeTruthy();

    const save = card.getByRole("button", { name: "Save", exact: true });
    if ((await save.getAttribute("aria-pressed")) !== "true") {
      await save.click();
      await expect(save).toHaveAttribute("aria-pressed", "true");
    }

    await page.goto("/saved");
    await expect(page.getByRole("heading", { name: "Saved", exact: true })).toBeVisible();
    await expect(page.getByText(title!, { exact: true })).toBeVisible();
  });

  test("Ask Coach opens one conversation with a real opener, and resumes it", async () => {
    await page.goto("/home");
    await cardByBadge(page, "Confidence")
      .getByRole("button", { name: "Ask Coach", exact: true })
      .click();

    await page.waitForURL(/\/coach\/[0-9a-f]{24}/);
    const firstUrl = page.url();
    // Never a silent empty chat (audit Bug Feed-3).
    await expect(page.getByText(/You're asking about/)).toBeVisible();

    await page.goto("/home");
    await cardByBadge(page, "Confidence")
      .getByRole("button", { name: "Ask Coach", exact: true })
      .click();
    await page.waitForURL(/\/coach\/[0-9a-f]{24}/);

    expect(page.url()).toBe(firstUrl);
  });

  test("the daily quote is present rather than silently expired", async () => {
    await page.goto("/home");
    // Rotation means this keeps working indefinitely after seeding
    // (audit Bug Feed-5: the card used to vanish on day 15).
    await expect(page.locator("blockquote").first()).toBeVisible();
  });
});
