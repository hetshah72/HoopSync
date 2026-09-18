import { test, expect, type Locator, type Page } from "@playwright/test";
import { signUpNewPlayer } from "./helpers/auth";

/**
 * BRD 7.1 success criterion: "a new player can complete onboarding without
 * abandoning it partway through."
 *
 * Nothing was persisted until "Finish", so closing the tab or refreshing on
 * step 4 lost every answer and restarted the wizard empty (audit ONB-12).
 * Answers are now drafted to localStorage as they're entered, scoped per
 * user, and cleared once onboarding completes.
 */

function button(scope: Page | Locator, name: string) {
  return scope.getByRole("button", { name, exact: true });
}

test.describe.serial("Onboarding draft resume (BRD 7.1 SC1)", () => {
  let page: Page;
  const email = `e2e-draft-${Math.random().toString(36).slice(2)}@hoopsync.dev`;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });

  test.afterAll(async () => {
    await page.close();
  });

  test("a reload partway through keeps every answer and the current step", async () => {
    await signUpNewPlayer(page, { email, name: "Riley" });

    await page.getByLabel("Date of birth").fill("2009-03-04");
    await page.getByLabel("Height in feet").fill("5");
    await page.getByLabel("Height in inches").fill("9");
    await page.getByLabel("Weight (lbs)").fill("160");
    await button(page, "High School").click();
    await page.getByLabel("Expected graduation year").fill("2027");
    await button(page, "Continue").click();

    await button(page, "Center").click();
    await button(page, "High School").click();
    await expect(page.getByText("Step 2 of 5")).toBeVisible();

    // The abandonment case: refresh mid-flow.
    await page.reload();

    await expect(page.getByText("Step 2 of 5")).toBeVisible();
    await expect(page.getByText("Your basketball background")).toBeVisible();
    await expect(button(page, "Center")).toHaveAttribute("aria-pressed", "true");

    // Step 1's answers survived too, including the date.
    await button(page, "Back").click();
    await expect(page.getByLabel("Date of birth")).toHaveValue("2009-03-04");
    await expect(page.getByLabel("Height in feet")).toHaveValue("5");
    await expect(page.getByLabel("Height in inches")).toHaveValue("9");
    await expect(page.getByLabel("Weight (lbs)")).toHaveValue("160");
  });

  test("the draft is cleared once onboarding completes", async () => {
    await button(page, "Continue").click();
    await button(page, "Continue").click(); // background already filled in

    await button(page, "Prepare for tryouts").click();
    await button(page, "Shooting").click();
    await button(page, "Continue").click();

    await page.getByLabel("Games per week").fill("0");
    await page.getByLabel("Practices per week").fill("3");
    await button(page, "Hoop").click();
    await button(page, "Ball").click();
    await button(page, "Continue").click();

    await page.locator("button", { hasText: "Balanced" }).first().click();
    await button(page, "Finish").click();
    await page.waitForURL("**/home");

    const leftovers = await page.evaluate(() =>
      Object.keys(window.localStorage).filter((k) =>
        k.startsWith("hoopsync:onboarding-draft:"),
      ),
    );
    expect(leftovers).toEqual([]);
  });
});
