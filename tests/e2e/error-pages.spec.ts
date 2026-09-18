import { expect, test } from "@playwright/test";
import { signInAsDemoPlayer } from "./helpers/auth";

/**
 * The branded failure surfaces: Auth.js's error page and the in-app 404.
 *
 * The auth cases deliberately never sign in. That absence *is* the assertion -
 * `/auth/error` has to be reachable signed out, because a player whose sign-in
 * just failed is by definition signed out. If the proxy ever gates it, Auth.js
 * sees a callbackUrl pointing back at its own error page, logs ErrorPageLoop
 * and falls back to the unbranded built-in screen this replaces.
 */
test.describe("Auth error page", () => {
  test("Auth.js failures land on the branded page, not the built-in one", async ({
    page,
  }) => {
    // Going through /api/auth/error proves the redirect Auth.js itself
    // performs, not just that the route renders.
    await page.goto("/api/auth/error?error=Configuration");

    await expect(page).toHaveURL(/\/auth\/error\?error=Configuration/);
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(
      "That sign-in didn't finish",
    );
    await expect(page.locator("body")).not.toContainText(
      "There is a problem with the server configuration",
    );
  });

  test("it renders while signed out", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/auth/error?error=AccessDenied");

    await expect(page).toHaveURL(/\/auth\/error/);
    await expect(page.getByRole("heading", { level: 2 })).toHaveText(
      "That account can't sign in",
    );
  });

  test("it never echoes the error parameter", async ({ page }) => {
    // React would escape this, so the risk isn't script injection - it's
    // putting an attacker's sentence on a real HoopSync URL.
    const hostile = "Your account is suspended, call 1-800-555-0100";
    await page.goto(`/auth/error?error=${encodeURIComponent(hostile)}`);

    await expect(page.getByRole("heading", { level: 2 })).toHaveText(
      "Something went wrong",
    );
    await expect(page.locator("body")).not.toContainText("1-800-555-0100");
  });

  test("the way out actually goes somewhere", async ({ page }) => {
    await page.goto("/auth/error?error=Configuration");
    await page
      .getByRole("link", { name: "Back to sign in", exact: true })
      .click();
    await page.waitForURL("**/sign-in");
  });

  test("sign-in failures still land on the form, not here", async ({
    page,
  }) => {
    // Routing is by Auth.js's `error.kind`, so setting `pages.error` must not
    // pull the retryable failures off the sign-in screen.
    await page.goto("/sign-in?error=CredentialsSignin");

    await expect(page).toHaveURL(/\/sign-in/);
    // Filtered by text on purpose: Next injects its own permanently-empty
    // `role="alert"` route announcer once the client router has hydrated, so a
    // bare getByRole("alert") is a strict-mode violation the moment anything
    // else on the page has navigated.
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "Incorrect email or password." }),
    ).toBeVisible();
  });
});

test.describe("Not found", () => {
  test("a missing record shows the branded 404 with the nav intact", async ({
    page,
  }) => {
    await signInAsDemoPlayer(page);
    // Well-formed ObjectId, no such player - so this reaches notFound() rather
    // than failing the id regex.
    await page.goto("/players/ffffffffffffffffffffffff");

    await expect(
      page.getByRole("heading", { level: 1, name: "We couldn't find that" }),
    ).toBeVisible();
    // The point of putting this inside the (app) group: a dead link doesn't
    // cost the player the rest of the app. Two navs exist (rail + tab bar),
    // toggled by breakpoint.
    await expect(
      page.getByRole("navigation", { name: "Main" }).first(),
    ).toBeVisible();

    await page.getByRole("link", { name: "Back to Home", exact: true }).click();
    await page.waitForURL("**/home");
  });

  test("an unmatched URL shows the branded 404", async ({ page }) => {
    await signInAsDemoPlayer(page);
    await page.goto("/definitely-not-a-route");

    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "There's nothing at that address",
      }),
    ).toBeVisible();
  });
});
