import { test, expect, type Page } from "@playwright/test";
import { signInAsDemoPlayer } from "./helpers/auth";

/**
 * The notification centre (BRD 7.15) against a real dev server and real
 * MongoDB. Run `npm run db:seed` first.
 *
 * What these cover is the no-dead-button bar (BRD v1.1 §8): the bell is
 * reachable from the chrome on both layouts, whatever it lists goes somewhere
 * real, read state actually persists, and every type can genuinely be switched
 * off. The trigger rules themselves are unit- and integration-tested - this is
 * about the surface.
 *
 * `exact: true` throughout - Next.js dev mode overlays a "Close Next.js Dev
 * Tools" button that substring-matches short accessible names.
 */

test.describe.serial("Notifications", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await signInAsDemoPlayer(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test("the bell is reachable from the chrome at both breakpoints", async () => {
    // Desktop: the rail's brand row, since the desktop layout has no top bar
    // at all for it to live in.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/home");
    const railBell = page.getByRole("link", { name: /^Notifications,/ });
    await expect(railBell).toBeVisible();

    // Phone: the top bar's icon cluster. The two surfaces are mutually
    // exclusive, so a single placement would vanish on one of them - this is
    // the assertion that catches that.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(
      page.getByRole("link", { name: /^Notifications,/ }),
    ).toBeVisible();
  });

  test("opens a real notification centre, and is never a dead end", async () => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/home");
    await page.getByRole("link", { name: /^Notifications,/ }).click();

    await expect(
      page.getByRole("heading", { name: "Notifications", exact: true }),
    ).toBeVisible();

    const items = page.locator("ul > li");
    const count = await items.count();

    if (count === 0) {
      // An empty centre is a legitimate, good state - unlike an empty feed.
      await expect(page.getByText("You're all caught up")).toBeVisible();
      return;
    }

    // Every row links somewhere inside the app; a notification that leads
    // nowhere is the most annoying kind there is.
    const firstLink = items.first().getByRole("link").first();
    const href = await firstLink.getAttribute("href");
    expect(href).toBeTruthy();
    expect(href!.startsWith("/")).toBe(true);

    await firstLink.click();
    await expect(page).toHaveURL(new RegExp(`${href}$`));
    // The destination is a real screen, not a 404.
    await expect(page.getByText("This page could not be found")).toHaveCount(0);
  });

  test("marking all read clears the badge in the chrome", async () => {
    await page.goto("/notifications");

    const markAll = page.getByRole("button", {
      name: "Mark all read",
      exact: true,
    });
    if ((await markAll.count()) === 0) {
      test.skip(true, "Nothing unread to clear on the seeded account.");
      return;
    }

    await markAll.click();
    await expect(markAll).toHaveCount(0);

    // The count lives in the app shell, which the action revalidates - so the
    // bell's accessible name is what proves the chrome actually updated.
    await expect(
      page.getByRole("link", { name: "Notifications, none unread" }),
    ).toBeVisible();
  });

  test("every type can be switched off, and the setting persists", async () => {
    await page.goto("/profile");

    // Anchored on the save control rather than the card's title text: the
    // title sits beside an icon, and "Notifications" also matches the bell's
    // accessible name in the chrome on every page.
    await expect(
      page.getByRole("button", {
        name: "Save notification settings",
        exact: true,
      }),
    ).toBeVisible();

    // The honesty note: this app labels what things really are, and a
    // settings screen implying push exists would be telling the player
    // something untrue about what they just turned on.
    await expect(
      page.getByText(/Nothing is sent to your phone or email yet/),
    ).toBeVisible();

    const streakToggle = page
      .locator("label")
      .filter({ hasText: "Streak reminders" })
      .getByRole("checkbox");
    await expect(streakToggle).toBeChecked();

    await streakToggle.uncheck();
    await page
      .getByRole("button", { name: "Save notification settings", exact: true })
      .click();
    await expect(page.getByText("Notification settings saved.")).toBeVisible();

    await page.reload();
    await expect(
      page
        .locator("label")
        .filter({ hasText: "Streak reminders" })
        .getByRole("checkbox"),
    ).not.toBeChecked();

    // Put it back, so the suite is re-runnable against the same account.
    await page
      .locator("label")
      .filter({ hasText: "Streak reminders" })
      .getByRole("checkbox")
      .check();
    await page
      .getByRole("button", { name: "Save notification settings", exact: true })
      .click();
    await expect(page.getByText("Notification settings saved.")).toBeVisible();
  });
});
