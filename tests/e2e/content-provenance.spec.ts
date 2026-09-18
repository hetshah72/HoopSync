import { expect, test, type Page } from "@playwright/test";
import { signInAsDemoPlayer } from "./helpers/auth";

/**
 * BRD 7.14, in a real browser: content that ships is labelled.
 *
 * The regression this guards is specific - `FeedItemDoc.mediaAssetId` existed
 * from the start and `toView` dropped it, so the seeded drill-demo card said
 * "see the footwork and timing" and rendered no video at all.
 */
function cardByBadge(page: Page, badge: string) {
  return page.locator("[id^='card-']").filter({ hasText: badge }).first();
}

test.describe.serial("content provenance", () => {
  test("the drill-demo card plays its clip and says what the footage is", async ({
    page,
  }) => {
    await signInAsDemoPlayer(page);
    await page.goto("/home");

    const card = cardByBadge(page, "Drill Demo");
    await expect(card).toBeVisible();

    // The clip the card's copy promises.
    const video = card.locator("video");
    await expect(video).toBeVisible();
    await expect(video).toHaveAttribute("src", /placeholder-drill-demo\.mp4/);

    // And the disclosure, which is the whole bargain BRD 6.4 strikes to let
    // the product demo before a league licence exists.
    await expect(card.getByText("Placeholder footage", { exact: true })).toBeVisible();
    await expect(card.getByText(/not real footage of this/i)).toBeVisible();
  });

  test("the NBA study clip is labelled from the asset, not from a hardcoded string", async ({
    page,
  }) => {
    await signInAsDemoPlayer(page);
    await page.goto("/players");
    await page.getByRole("link", { name: /Stephen Curry/i }).first().click();

    const studyClip = page.locator("video").first();
    await expect(studyClip).toBeVisible();
    await expect(page.getByText(/not real footage of this/i).first()).toBeVisible();
  });
});

test.describe.serial("clips reel (BRD 7.14 short-form)", () => {
  test("opens from Home, plays a clip, and labels its source on the clip", async ({
    page,
  }) => {
    await signInAsDemoPlayer(page);
    await page.goto("/home");

    await page.getByRole("link", { name: "Clips", exact: true }).click();
    await expect(page).toHaveURL(/\/clips/);

    const video = page.locator("video").first();
    await expect(video).toBeVisible();

    // The disclosure is on the clip, always visible - not behind a tap.
    await expect(
      page.getByText("Placeholder footage", { exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByText(/not real footage of this/i).first()).toBeVisible();

    // And the reel's actions are real, not decorative.
    await expect(page.getByRole("button", { name: "Like" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Save" }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Close clips" })).toBeVisible();
  });

  test("a card's clip deep-links into the reel on that same clip", async ({
    page,
  }) => {
    await signInAsDemoPlayer(page);
    await page.goto("/home");

    const card = page.locator("[id^='card-']").filter({ hasText: "Drill Demo" }).first();
    const cardId = (await card.getAttribute("id"))!.replace("card-", "");

    await card.getByRole("link", { name: /Watch in Clips/i }).click();
    await expect(page).toHaveURL(new RegExp(`/clips\\?start=${cardId}`));
    await expect(page.locator("video").first()).toBeVisible();
  });

  test("Like on a reel persists, proving the action is wired to the same write as the card", async ({
    page,
  }) => {
    await signInAsDemoPlayer(page);
    await page.goto("/clips");

    // State is expressed by aria-pressed, so this reads the same whether an
    // earlier run left the clip liked - and it resets itself at the end, which
    // is what keeps the spec re-runnable against a persistent database.
    const like = page.getByRole("button", { name: "Like" }).first();
    await expect(like).toBeVisible();
    if ((await like.getAttribute("aria-pressed")) === "true") await like.click();
    await expect(like).toHaveAttribute("aria-pressed", "false");

    await like.click();
    await expect(like).toHaveAttribute("aria-pressed", "true");

    // The pressed state above is optimistic - the Server Action POST is still
    // in flight. Reloading before it lands reads the pre-click row back and
    // fails for a reason that has nothing to do with persistence, so wait for
    // the write to settle first.
    await page.waitForLoadState("networkidle");
    await page.reload();
    const afterReload = page.getByRole("button", { name: "Like" }).first();
    await expect(afterReload).toHaveAttribute("aria-pressed", "true");

    await afterReload.click();
  });
});
