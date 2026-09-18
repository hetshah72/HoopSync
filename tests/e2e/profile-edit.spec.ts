import { test, expect, type Locator, type Page } from "@playwright/test";
import { signUpNewPlayer } from "./helpers/auth";

/**
 * BRD 7.1 FR3: "persist profile data so it can be edited later **and is
 * available to every other module**".
 *
 * Onboarding shipped one-shot - there was no route anywhere that let a player
 * change an answer afterwards (audit ONB-08), which also left workout
 * generation's "try adding equipment in your profile" error pointing at a
 * screen that didn't exist. This walks the real flow: onboard, open /profile
 * from the header, change answers, save, and confirm another module actually
 * reflects the change rather than the edit only surviving on its own page.
 *
 * Like the founder-loop suite, this creates a real throwaway account in the
 * dev database and does not clean it up.
 */

function button(scope: Page | Locator, name: string) {
  return scope.getByRole("button", { name, exact: true });
}

/** A real 1x1 PNG - the upload is validated by its bytes, not its filename. */
const ONE_PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test.describe.serial("Profile editing (BRD 7.1 FR3)", () => {
  let page: Page;
  const email = `e2e-profile-${Math.random().toString(36).slice(2)}@hoopsync.dev`;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });

  test.afterAll(async () => {
    await page.close();
  });

  test("onboard a fresh account", async () => {
    await signUpNewPlayer(page, { email, name: "Sam" });

    await page.getByLabel("Date of birth").fill("2008-01-01");
    await page.getByLabel("Height in feet").fill("6");
    await page.getByLabel("Height in inches").fill("2");
    await page.getByLabel("Weight (lbs)").fill("175");
    await button(page, "High School").click();
    await page.getByLabel("Expected graduation year").fill("2028");
    await button(page, "Continue").click();

    await button(page, "Small Forward").click();
    await button(page, "High School").click();
    await button(page, "Continue").click();

    await button(page, "Prepare for tryouts").click();
    await button(page, "Shooting").click();
    await button(page, "Continue").click();

    await page.getByLabel("Games per week").fill("1");
    await page.getByLabel("Practices per week").fill("2");
    await button(page, "Hoop").click();
    await button(page, "Ball").click();
    await button(page, "Continue").click();

    await page.locator("button", { hasText: "Direct" }).first().click();
    await button(page, "Finish").click();
    await page.waitForURL("**/home");
    await expect(page.getByText("Your goal: Prepare for tryouts")).toBeVisible();
  });

  /**
   * The six bottom-nav tabs are fixed by BRD v1.1 §4, so the entry point is
   * the header avatar rather than a seventh tab.
   */
  test("the header opens the profile screen, prefilled with the real answers", async () => {
    await page.getByRole("link", { name: "Your profile", exact: true }).click();
    await page.waitForURL("**/profile");

    await expect(page.getByLabel("What should we call you?")).toHaveValue("Sam");
    await expect(page.getByLabel("Height in feet")).toHaveValue("6");
    await expect(page.getByLabel("Height in inches")).toHaveValue("2");
    await expect(page.getByLabel("Weight (lbs)")).toHaveValue("175");
    await expect(page.getByLabel("Expected graduation year")).toHaveValue("2028");
    // A chip that was chosen during onboarding is shown as selected.
    await expect(button(page, "Small Forward")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("an edit saves and is visible to another module", async () => {
    // Change the goal and swap the focus area.
    await button(page, "Become a better all-around player").click();
    await button(page, "Shooting").click(); // deselect
    await button(page, "Defense").click(); // select
    await button(page, "Save changes").click();

    await expect(page.getByText("Profile updated.")).toBeVisible();

    // Home is a separate module reading the same profile server-side.
    await page.goto("/home");
    await expect(
      page.getByText("Your goal: Become a better all-around player"),
    ).toBeVisible();
    await expect(page.getByText("Defense", { exact: true }).first()).toBeVisible();
  });

  test("the edit survives a reload rather than living in client state", async () => {
    await page.goto("/profile");
    await expect(button(page, "Defense")).toHaveAttribute("aria-pressed", "true");
    await expect(button(page, "Shooting")).toHaveAttribute("aria-pressed", "false");
  });

  /**
   * BRD 7.1 Account: the profile carries a photo the player uploads
   * themselves. Password sign-up supplies no image at all, so without this
   * every account in the app is a coloured initial forever.
   *
   * The interesting part isn't the POST - it's that the photo reaches the
   * app shell's header avatar, which renders from the profile on the server
   * rather than from the JWT's frozen `session.user.image`.
   */
  test("a profile photo uploads and reaches the app shell", async () => {
    await page.goto("/profile");

    // Nothing uploaded yet, so the card is showing the initial.
    await expect(page.locator('[data-slot="avatar-image"]')).toHaveCount(0);

    await page.getByLabel("Upload a profile photo").setInputFiles({
      name: "headshot.png",
      mimeType: "image/png",
      buffer: ONE_PIXEL_PNG,
    });

    await expect(page.getByText("Profile photo updated.")).toBeVisible();
    // GCS isn't configured in dev, so this is the local fallback path.
    await expect(page.locator('[data-slot="avatar-image"]').first()).toHaveAttribute(
      "src",
      /\/uploads\/avatars\/.+\.png$/,
    );

    // A different module, rendered from the same profile on the server.
    await page.goto("/home");
    await expect(
      page.getByRole("link", { name: "Your profile", exact: true })
        .locator('[data-slot="avatar-image"]'),
    ).toHaveAttribute("src", /\/uploads\/avatars\/.+\.png$/);
  });

  test("the photo survives a reload, and Remove puts the initial back", async () => {
    await page.goto("/profile");
    await expect(page.locator('[data-slot="avatar-image"]').first()).toHaveAttribute(
      "src",
      /\/uploads\/avatars\/.+\.png$/,
    );

    await button(page, "Remove").click();
    await expect(page.getByText("Profile photo removed.")).toBeVisible();

    await page.goto("/profile");
    await expect(page.locator('[data-slot="avatar-image"]')).toHaveCount(0);
  });

  test("a file that only claims to be an image is refused", async () => {
    await page.goto("/profile");

    await page.getByLabel("Upload a profile photo").setInputFiles({
      name: "not-really.png",
      mimeType: "image/png",
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
    });

    await expect(
      page.getByText("Profile photos need to be a JPEG, PNG or WebP image."),
    ).toBeVisible();
    // The preview is rolled back rather than left showing a photo that was
    // never saved.
    await expect(page.locator('[data-slot="avatar-image"]')).toHaveCount(0);
  });
});
